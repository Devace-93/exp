import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  API_URL,
  createFlag,
  createProject,
  envByKey,
  envKeyHeaders,
  jwtHeaders,
  registerAccount,
  rolloutBucket,
  type Account,
  type Project,
} from "../helpers";

interface Evaluated {
  kind: string;
  enabled: boolean;
  value: unknown;
}

/**
 * Evaluation API (SDK side): environment client keys, on/off semantics per
 * kind, deterministic rollouts (sha256 bucket), archived flags, key rotation
 * and metering. API only; the dashboard preview is covered in flags.spec.ts.
 */
test.describe("evaluation API", () => {
  let account: Account;
  let project: Project;
  let prodKey: string;
  let stagingKey: string;

  async function evaluateAll(request: APIRequestContext, key: string, distinctId?: string) {
    const url = `${API_URL}/eval/flags${distinctId !== undefined ? `?distinct_id=${encodeURIComponent(distinctId)}` : ""}`;
    const res = await request.get(url, { headers: envKeyHeaders(key) });
    expect(res.status(), await res.text()).toBe(200);
    return res.json() as Promise<{
      project: { id: string; key: string };
      environment: { id: string; key: string };
      distinct_id: string | null;
      evaluated_at?: string;
      flags: Record<string, Evaluated>;
    }>;
  }

  test.beforeAll(async ({ request }) => {
    account = await registerAccount(request);
    project = await createProject(request, account, { name: "Eval", key: "eval" });
    prodKey = envByKey(project, "production").client_key!;
    stagingKey = envByKey(project, "staging").client_key!;

    await createFlag(request, account, project.id, {
      key: "bool-on",
      states: { production: { enabled: true } },
    });
    await createFlag(request, account, project.id, { key: "bool-off" });
    await createFlag(request, account, project.id, {
      key: "greeting",
      kind: "string",
      default_value: "hi",
      states: { production: { enabled: true }, staging: { enabled: true, value: "hey" } },
    });
    await createFlag(request, account, project.id, {
      key: "max-items",
      kind: "number",
      default_value: 10,
      states: { production: { enabled: true, value: 25 } },
    });
    await createFlag(request, account, project.id, {
      key: "config",
      kind: "json",
      default_value: { theme: "violet" },
      states: { production: { enabled: true } },
    });
    await createFlag(request, account, project.id, {
      key: "half",
      states: { production: { enabled: true, rollout_percent: 50 } },
    });
    await createFlag(request, account, project.id, {
      key: "hidden",
      states: { production: { enabled: true } },
    });
    const archived = await request.patch(`${API_URL}/projects/${project.id}/flags/hidden`, {
      headers: jwtHeaders(account),
      data: { archived: true },
    });
    expect(archived.status()).toBe(200);
  });

  test("@critical environment key as header and as bearer; management keys and no key are refused", async ({ request }) => {
    const viaHeader = await evaluateAll(request, prodKey, "user-1");
    expect(viaHeader.project).toEqual({ id: project.id, key: "eval" });
    expect(viaHeader.environment.key).toBe("production");
    expect(viaHeader.distinct_id).toBe("user-1");
    expect(typeof viaHeader.evaluated_at).toBe("string");

    const viaBearer = await request.get(`${API_URL}/eval/flags?distinct_id=user-1`, {
      headers: { Authorization: `Bearer ${prodKey}` },
    });
    expect(viaBearer.status()).toBe(200);
    expect((await viaBearer.json()).flags).toEqual(viaHeader.flags);

    expect((await request.get(`${API_URL}/eval/flags`)).status()).toBe(401);
    expect((await request.get(`${API_URL}/eval/flags`, { headers: envKeyHeaders("exp_env_not_real") })).status()).toBe(401);
    // A JWT is not an environment key.
    expect((await request.get(`${API_URL}/eval/flags`, { headers: jwtHeaders(account) })).status()).toBe(401);
    // And an environment key cannot call the management API.
    const mgmt = await request.get(`${API_URL}/projects`, { headers: { "X-API-Key": prodKey } });
    expect(mgmt.status()).toBe(401);
  });

  test("@critical on/off semantics per kind", async ({ request }) => {
    const { flags } = await evaluateAll(request, prodKey, "user-1");
    expect(flags["bool-on"]).toEqual({ kind: "boolean", enabled: true, value: true });
    expect(flags["bool-off"]).toEqual({ kind: "boolean", enabled: false, value: false });
    // On with no state value → default_value.
    expect(flags["greeting"]).toEqual({ kind: "string", enabled: true, value: "hi" });
    // On with a state value → the state value.
    expect(flags["max-items"]).toEqual({ kind: "number", enabled: true, value: 25 });
    expect(flags["config"]).toEqual({ kind: "json", enabled: true, value: { theme: "violet" } });
    expect(flags["hidden"]).toBeUndefined();

    // Staging: different states for the same flags.
    const staging = await evaluateAll(request, stagingKey, "user-1");
    expect(staging.environment.key).toBe("staging");
    expect(staging.flags["bool-on"]).toEqual({ kind: "boolean", enabled: false, value: false });
    expect(staging.flags["greeting"]).toEqual({ kind: "string", enabled: true, value: "hey" });
    // Off for non-boolean kinds → null.
    expect(staging.flags["max-items"]).toEqual({ kind: "number", enabled: false, value: null });
    expect(staging.flags["config"]).toEqual({ kind: "json", enabled: false, value: null });
  });

  test("single-flag endpoint; unknown and archived keys are 404", async ({ request }) => {
    const one = await request.get(`${API_URL}/eval/flags/greeting?distinct_id=u`, { headers: envKeyHeaders(prodKey) });
    expect(one.status()).toBe(200);
    expect(await one.json()).toEqual({ key: "greeting", kind: "string", enabled: true, value: "hi" });

    for (const key of ["nope", "hidden"]) {
      const res = await request.get(`${API_URL}/eval/flags/${key}`, { headers: envKeyHeaders(prodKey) });
      expect(res.status(), key).toBe(404);
      expect((await res.json()).error.code).toBe("not_found");
    }
  });

  test("@critical rollout is deterministic and follows the sha256 bucket rule", async ({ request }) => {
    const ids = Array.from({ length: 12 }, (_, i) => `user-${i}`);
    const expected = ids.map((d) => rolloutBucket("half", d) < 50);
    expect(new Set(expected).size, "sample should contain both buckets").toBe(2);

    for (let i = 0; i < ids.length; i++) {
      const res = await request.get(`${API_URL}/eval/flags/half?distinct_id=${ids[i]}`, { headers: envKeyHeaders(prodKey) });
      expect(res.status()).toBe(200);
      const body: Evaluated = await res.json();
      expect(body.enabled, `${ids[i]} bucket=${rolloutBucket("half", ids[i])}`).toBe(expected[i]);
      expect(body.value).toBe(expected[i]);
    }
    // Same answer on a second request (stable per user).
    const again = await request.get(`${API_URL}/eval/flags/half?distinct_id=${ids[0]}`, { headers: envKeyHeaders(prodKey) });
    expect((await again.json()).enabled).toBe(expected[0]);

    // The bucket is per flag: 50% of one flag is not the same half of another.
    const set = await request.put(`${API_URL}/projects/${project.id}/flags/bool-on/states/production`, {
      headers: jwtHeaders(account),
      data: { rollout_percent: 50 },
    });
    expect(set.status()).toBe(200);
    const all = await evaluateAll(request, prodKey, ids[0]);
    expect(all.flags["bool-on"].enabled).toBe(rolloutBucket("bool-on", ids[0]) < 50);
    await request.put(`${API_URL}/projects/${project.id}/flags/bool-on/states/production`, {
      headers: jwtHeaders(account),
      data: { rollout_percent: 100 },
    });
  });

  test("without distinct_id a partial rollout is out, a full rollout is in", async ({ request }) => {
    const { flags, distinct_id } = await evaluateAll(request, prodKey);
    expect(distinct_id ?? null).toBeNull();
    expect(flags["half"]).toEqual({ kind: "boolean", enabled: false, value: false });
    expect(flags["bool-on"]).toEqual({ kind: "boolean", enabled: true, value: true });
    expect(flags["greeting"].value).toBe("hi");

    // 0% is always out, even with a distinct_id.
    await request.put(`${API_URL}/projects/${project.id}/flags/half/states/staging`, {
      headers: jwtHeaders(account),
      data: { enabled: true, rollout_percent: 0 },
    });
    const staging = await evaluateAll(request, stagingKey, "user-0");
    expect(staging.flags["half"].enabled).toBe(false);
  });

  test("@critical rotated key → old key 401, new key works", async ({ request }) => {
    const dev = envByKey(project, "development");
    const before = await request.get(`${API_URL}/eval/flags`, { headers: envKeyHeaders(dev.client_key!) });
    expect(before.status()).toBe(200);

    const rotate = await request.post(`${API_URL}/projects/${project.id}/environments/${dev.id}/rotate-key`, {
      headers: jwtHeaders(account),
    });
    expect(rotate.status(), await rotate.text()).toBe(200);
    const { client_key, client_key_prefix } = await rotate.json();
    expect(client_key).toMatch(/^exp_env_/);
    expect(client_key).not.toBe(dev.client_key);
    expect(client_key.startsWith(client_key_prefix)).toBe(true);

    const old = await request.get(`${API_URL}/eval/flags`, { headers: envKeyHeaders(dev.client_key!) });
    expect(old.status()).toBe(401);
    const fresh = await evaluateAll(request, client_key);
    expect(fresh.environment.key).toBe("development");
  });

  test("@critical usage counter increments once per evaluation request", async ({ request }) => {
    const usage = async () => (await request.get(`${API_URL}/account/usage`, { headers: jwtHeaders(account) })).json();
    const before = await usage();
    expect(typeof before.evaluations).toBe("number");
    expect(before.counts.projects).toBe(1);

    const n = 5;
    for (let i = 0; i < n; i++) {
      if (i % 2 === 0) await evaluateAll(request, prodKey, `u${i}`);
      else expect((await request.get(`${API_URL}/eval/flags/bool-on`, { headers: envKeyHeaders(stagingKey) })).status()).toBe(200);
    }
    // The dashboard preview is not metered.
    const preview = await request.get(`${API_URL}/projects/${project.id}/flags/evaluate?environment=production&distinct_id=x`, {
      headers: jwtHeaders(account),
    });
    expect(preview.status()).toBe(200);
    expect((await preview.json()).flags["bool-on"].enabled).toBe(true);

    await expect.poll(async () => (await usage()).evaluations, { timeout: 10_000 }).toBe(before.evaluations + n);

    // Unauthenticated / unknown-flag requests did not count either.
    const me = await (await request.get(`${API_URL}/auth/me`, { headers: jwtHeaders(account) })).json();
    expect(me.usage.evaluations).toBe(before.evaluations + n);
    expect(me.limits.evaluations_per_month).toBeDefined();
  });
});
