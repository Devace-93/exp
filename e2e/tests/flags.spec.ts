import { test, expect, type Page } from "@playwright/test";
import {
  API_URL,
  createFlag,
  createProject,
  getFlag,
  jwtHeaders,
  registerAccount,
  rolloutBucket,
  seedSession,
  type Account,
  type Flag,
  type Project,
} from "../helpers";

/**
 * Flags through the API and the dashboard: every kind, validation (reserved
 * keys, kind/value mismatch), per-environment toggles from the table, the
 * flag editor (rollout, value, preview), archive, delete and the copy-flags
 * dialog between two projects (skip vs overwrite).
 */
test.describe("flags", () => {
  let account: Account;
  let source: Project;
  let target: Project;
  /** Fixture flags created through the API before any test (one per kind). */
  const seeded: Record<string, Flag> = {};

  test.beforeAll(async ({ request }) => {
    account = await registerAccount(request);
    source = await createProject(request, account, { name: "Flags source", key: "flags-source" });
    target = await createProject(request, account, { name: "Flags target", key: "flags-target" });
    seeded.bool = await createFlag(request, account, source.id, { key: "bool-flag", name: "Bool", default_value: false });
    seeded.string = await createFlag(request, account, source.id, {
      key: "string-flag",
      kind: "string",
      default_value: "hello",
      tags: ["copy-me"],
      states: { production: { enabled: true, value: "prod-value" } },
    });
    seeded.number = await createFlag(request, account, source.id, { key: "number-flag", kind: "number", default_value: 42 });
    seeded.json = await createFlag(request, account, source.id, {
      key: "json-flag",
      kind: "json",
      default_value: { a: 1, b: ["x"] },
    });
  });

  test.beforeEach(async ({ page }) => {
    await seedSession(page, account);
  });

  /** Set a native <input type=range> and fire the input event Qwik listens to. */
  async function setRange(page: Page, selector: string, value: number) {
    await page.locator(selector).evaluate((el, v) => {
      const input = el as HTMLInputElement;
      input.value = String(v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
  }

  test("@critical API: create flags of each kind with default states", async ({ request }) => {
    const bool = seeded.bool;
    expect(bool.kind).toBe("boolean");
    expect(bool.default_value).toBe(true); // ignored for booleans, stored as true
    expect(Object.keys(bool.states).sort()).toEqual(["development", "production", "staging"]);
    for (const st of Object.values(bool.states)) {
      expect(st).toMatchObject({ enabled: false, value: null, rollout_percent: 100 });
    }

    const str = seeded.string;
    expect(str.default_value).toBe("hello");
    expect(str.tags).toEqual(["copy-me"]);
    expect(str.states.production).toMatchObject({ enabled: true, value: "prod-value", rollout_percent: 100 });
    expect(str.states.staging).toMatchObject({ enabled: false, value: null });

    const num = seeded.number;
    expect(num.default_value).toBe(42);

    const json = seeded.json;
    expect(json.default_value).toEqual({ a: 1, b: ["x"] });

    // Fetch by key or by id.
    expect((await getFlag(request, account, source.id, "json-flag")).id).toBe(json.id);
    expect((await getFlag(request, account, source.id, json.id)).key).toBe("json-flag");

    // Ordered by key.
    const list = await (await request.get(`${API_URL}/projects/${source.id}/flags`, { headers: jwtHeaders(account) })).json();
    expect(list.items.map((f: Flag) => f.key)).toEqual(["bool-flag", "json-flag", "number-flag", "string-flag"]);
    expect(list.total).toBe(4);
  });

  test("API: validation — reserved keys, bad values, duplicates, bad rollout", async ({ request }) => {
    const headers = jwtHeaders(account);
    for (const key of ["copy", "evaluate"]) {
      const res = await request.post(`${API_URL}/projects/${source.id}/flags`, { headers, data: { key } });
      expect(res.status(), key).toBe(400);
      expect((await res.json()).error.code).toBe("reserved_key");
    }
    const badValue = await request.post(`${API_URL}/projects/${source.id}/flags`, {
      headers,
      data: { key: "bad-number", kind: "number", default_value: "nope" },
    });
    expect(badValue.status()).toBe(400);
    expect((await badValue.json()).error.code).toBe("invalid_value");

    const dup = await request.post(`${API_URL}/projects/${source.id}/flags`, { headers, data: { key: "bool-flag" } });
    expect(dup.status()).toBe(409);
    expect((await dup.json()).error.code).toBe("key_taken");

    const badKey = await request.post(`${API_URL}/projects/${source.id}/flags`, { headers, data: { key: "Not Valid!" } });
    expect(badKey.status()).toBe(400);

    const badRollout = await request.put(`${API_URL}/projects/${source.id}/flags/bool-flag/states/production`, {
      headers,
      data: { rollout_percent: 150 },
    });
    expect(badRollout.status()).toBe(400);

    const badStateValue = await request.put(`${API_URL}/projects/${source.id}/flags/number-flag/states/production`, {
      headers,
      data: { value: "text" },
    });
    expect(badStateValue.status()).toBe(400);
    expect((await badStateValue.json()).error.code).toBe("invalid_value");
  });

  test("@critical UI: create a flag from the dialog; reserved keys are rejected", async ({ page, request }) => {
    await page.goto(`/dashboard/projects/${source.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "Flags source" })).toBeVisible();
    await page.getByRole("button", { name: "New flag" }).click();
    const dialog = page.getByRole("dialog", { name: "Create flag" });
    await expect(dialog).toBeVisible();

    // Reserved key is caught before the request.
    await dialog.getByLabel("Flag key").fill("evaluate");
    await dialog.getByRole("button", { name: "Create flag" }).click();
    await expect(dialog.getByText('The keys "copy" and "evaluate" are reserved.')).toBeVisible();

    await dialog.getByLabel("Flag key").fill("ui-string");
    await dialog.getByLabel("Name").fill("UI string");
    await dialog.locator("#fkind").selectOption("string");
    await dialog.getByLabel("Default value").fill("from-ui");
    await dialog.getByLabel("Tags").fill("ui, e2e");
    await dialog.getByRole("button", { name: "Create flag" }).click();
    await expect(dialog).toBeHidden();

    const row = page.getByRole("row").filter({ hasText: "ui-string" });
    await expect(row).toBeVisible();
    await expect(row).toContainText("UI string");
    await expect(row).toContainText("String");
    await expect(row).toContainText("from-ui");
    await expect(row).toContainText("e2e");
    await expect(page.getByText("5 flags")).toBeVisible();

    const flag = await getFlag(request, account, source.id, "ui-string");
    expect(flag).toMatchObject({ kind: "string", default_value: "from-ui", tags: ["ui", "e2e"], name: "UI string" });
  });

  test("@critical UI: toggle a state from the flags table", async ({ page, request }) => {
    await page.goto(`/dashboard/projects/${source.id}`);
    const row = page.getByRole("row").filter({ hasText: "bool-flag" });
    const prod = row.getByRole("switch", { name: "bool-flag in production" });
    const staging = row.getByRole("switch", { name: "bool-flag in staging" });
    await expect(prod).toHaveAttribute("aria-checked", "false");

    await prod.click();
    await expect(prod).toHaveAttribute("aria-checked", "true");
    await expect(staging).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(async () => (await getFlag(request, account, source.id, "bool-flag")).states.production.enabled)
      .toBe(true);
    expect((await getFlag(request, account, source.id, "bool-flag")).states.staging.enabled).toBe(false);

    await staging.click();
    await expect(staging).toHaveAttribute("aria-checked", "true");
    await expect
      .poll(async () => (await getFlag(request, account, source.id, "bool-flag")).states.staging.enabled)
      .toBe(true);

    await prod.click();
    await expect(prod).toHaveAttribute("aria-checked", "false");
    await expect
      .poll(async () => (await getFlag(request, account, source.id, "bool-flag")).states.production.enabled)
      .toBe(false);

    // Audit: one flag_state.update per toggle, with the environment in meta.
    const audit = await (
      await request.get(`${API_URL}/account/audit?limit=50&action=flag_state.update`, { headers: jwtHeaders(account) })
    ).json();
    const envs = audit.items.map((e: { meta: { environment: string } }) => e.meta.environment);
    expect(envs.slice(0, 3)).toEqual(["production", "staging", "production"]);
  });

  test("@critical UI: flag editor — rollout, value, preview evaluation", async ({ page, request }) => {
    const flag = await getFlag(request, account, source.id, "string-flag");
    await page.goto(`/dashboard/projects/${source.id}/flags/${flag.id}`);
    await expect(page.getByRole("heading", { level: 1, name: "string-flag" })).toBeVisible();

    // Staging card: enable, set a value and a 50% rollout, save.
    const stagingSwitch = page.getByRole("switch", { name: "string-flag in staging" });
    await expect(stagingSwitch).toHaveAttribute("aria-checked", "false");
    await stagingSwitch.click();
    await page.locator("#v-staging").fill("staging-value");
    await setRange(page, "#r-staging", 50);
    await expect(page.locator('label[for="r-staging"]')).toContainText("50%");
    await page.getByRole("button", { name: "Save staging" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    const saved = await getFlag(request, account, source.id, "string-flag");
    expect(saved.states.staging).toMatchObject({ enabled: true, value: "staging-value", rollout_percent: 50 });
    expect(saved.states.production).toMatchObject({ enabled: true, value: "prod-value", rollout_percent: 100 });

    // Preview: production (100%) is on for everyone, including without distinct_id.
    await page.locator("#penv").selectOption("production");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    const result = page.locator("section", { hasText: "Preview evaluation" });
    await expect(result.getByText("On", { exact: true })).toBeVisible();
    await expect(result.getByText('"prod-value"', { exact: true })).toBeVisible();

    // Staging at 50%: pick ids on both sides of the bucket rule.
    const inId = Array.from({ length: 200 }, (_, i) => `user-${i}`).find((d) => rolloutBucket("string-flag", d) < 50)!;
    const outId = Array.from({ length: 200 }, (_, i) => `user-${i}`).find((d) => rolloutBucket("string-flag", d) >= 50)!;
    await page.locator("#penv").selectOption("staging");
    await page.locator("#pdid").fill(inId);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(result.getByText('"staging-value"', { exact: true })).toBeVisible();
    await expect(result.getByText("On", { exact: true })).toBeVisible();

    await page.locator("#pdid").fill(outId);
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(result.getByText("Off", { exact: true })).toBeVisible();
    await expect(result.getByText("null", { exact: true })).toBeVisible();

    // Without a distinct_id a partial rollout is out.
    await page.locator("#pdid").fill("");
    await page.getByRole("button", { name: "Preview", exact: true }).click();
    await expect(result.getByText("Off", { exact: true })).toBeVisible();

    // The table shows the rollout under the staging switch.
    await page.goto(`/dashboard/projects/${source.id}`);
    const row = page.getByRole("row").filter({ hasText: "string-flag" });
    await expect(row.getByText("50%")).toBeVisible();
  });

  test("UI: edit the definition — name, tags, and changing the kind resets values", async ({ page, request }) => {
    const flag = await getFlag(request, account, source.id, "number-flag");
    await page.goto(`/dashboard/projects/${source.id}/flags/${flag.id}`);
    await page.getByLabel("Name").fill("Max items");
    await page.getByLabel("Default value").fill("7");
    await page.getByLabel("Tags").fill("limits");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    const updated = await getFlag(request, account, source.id, "number-flag");
    expect(updated).toMatchObject({ name: "Max items", default_value: 7, tags: ["limits"] });

    // Set a state value, then change the kind through the API: values reset to null.
    await request.put(`${API_URL}/projects/${source.id}/flags/number-flag/states/production`, {
      headers: jwtHeaders(account),
      data: { enabled: true, value: 9 },
    });
    const patched = await request.patch(`${API_URL}/projects/${source.id}/flags/number-flag`, {
      headers: jwtHeaders(account),
      data: { kind: "string", default_value: "seven" },
    });
    expect(patched.status(), await patched.text()).toBe(200);
    const asString: Flag = await patched.json();
    expect(asString.kind).toBe("string");
    expect(asString.states.production).toMatchObject({ enabled: true, value: null });
  });

  test("@critical UI: archive hides the flag from the table and the evaluation", async ({ page, request }) => {
    const flag = await getFlag(request, account, source.id, "json-flag");
    await page.goto(`/dashboard/projects/${source.id}/flags/${flag.id}`);
    await page.getByLabel("Archived (never returned by the evaluation API)").check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Saved.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "json-flag" }).locator("..").getByText("Archived")).toBeVisible();
    expect((await getFlag(request, account, source.id, "json-flag")).archived).toBe(true);

    await page.goto(`/dashboard/projects/${source.id}`);
    await expect(page.getByRole("row").filter({ hasText: "bool-flag" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "json-flag" })).toHaveCount(0);
    await page.getByLabel("Show archived").check();
    const row = page.getByRole("row").filter({ hasText: "json-flag" });
    await expect(row).toBeVisible();
    await expect(row.getByText("Archived")).toBeVisible();
    await expect(row.getByRole("switch", { name: "json-flag in production" })).toBeDisabled();

    // The preview never returns an archived flag.
    const preview = await (
      await request.get(`${API_URL}/projects/${source.id}/flags/evaluate?environment=production`, { headers: jwtHeaders(account) })
    ).json();
    expect(preview.flags["json-flag"]).toBeUndefined();
    expect(preview.flags["bool-flag"]).toBeTruthy();

    // Archived flags still count towards the list total with include_archived.
    const list = await (
      await request.get(`${API_URL}/projects/${source.id}/flags?include_archived=true`, { headers: jwtHeaders(account) })
    ).json();
    expect(list.items.map((f: Flag) => f.key)).toContain("json-flag");
    const listDefault = await (
      await request.get(`${API_URL}/projects/${source.id}/flags`, { headers: jwtHeaders(account) })
    ).json();
    expect(listDefault.items.map((f: Flag) => f.key)).not.toContain("json-flag");
  });

  test("@critical UI: copy flags to another project — skip, then overwrite", async ({ page, request }) => {
    // A per-environment state on the source, to check it lands on the same env key.
    const staged = await request.put(`${API_URL}/projects/${source.id}/flags/bool-flag/states/staging`, {
      headers: jwtHeaders(account),
      data: { enabled: true },
    });
    expect(staged.status()).toBe(200);
    // The target already has string-flag with its own definition: that is the conflict.
    await createFlag(request, account, target.id, {
      key: "string-flag",
      kind: "string",
      default_value: "target-original",
    });

    await page.goto(`/dashboard/projects/${source.id}`);
    await page.getByRole("button", { name: "Copy flags…" }).click();
    const dialog = page.getByRole("dialog", { name: "Copy flags to another project" });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("#ctarget")).toContainText("Flags target (flags-target)");
    await dialog.locator("#ctarget").selectOption(target.id);
    await expect(dialog.getByLabel("All non-archived flags")).toBeChecked();
    await expect(dialog.getByLabel("Include per-environment states")).toBeChecked();
    await expect(dialog.getByLabel("Skip it")).toBeChecked();
    await dialog.getByRole("button", { name: "Copy flags", exact: true }).click();

    // CopyResult: every non-archived source flag except the conflicting string-flag.
    const sourceFlags = await (
      await request.get(`${API_URL}/projects/${source.id}/flags`, { headers: jwtHeaders(account) })
    ).json();
    const expectedCopied = (sourceFlags.items as Flag[]).map((f) => f.key).filter((k) => k !== "string-flag");
    expect(expectedCopied.length).toBeGreaterThanOrEqual(2);
    await expect(dialog.getByText("Copy finished")).toBeVisible();
    await expect(dialog.getByText(`Copied: ${expectedCopied.length}`)).toBeVisible();
    await expect(dialog.getByText("Overwritten: 0")).toBeVisible();
    await expect(dialog.getByText("Skipped: 1")).toBeVisible();
    await expect(dialog.getByText(expectedCopied.join(", "))).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Open target project" })).toHaveAttribute(
      "href",
      new RegExp(`/dashboard/projects/${target.id}`),
    );
    await dialog.getByRole("button", { name: "Close" }).first().click();
    await expect(dialog).toBeHidden();

    let targetString = await getFlag(request, account, target.id, "string-flag");
    expect(targetString.default_value).toBe("target-original");
    const copiedBool = await getFlag(request, account, target.id, "bool-flag");
    expect(copiedBool.states.staging.enabled).toBe(true); // state copied by environment key
    expect(copiedBool.states.production.enabled).toBe(false);

    // Second run with overwrite, only the selected flag.
    await page.getByRole("row").filter({ hasText: "string-flag" }).getByRole("checkbox", { name: "string-flag" }).check();
    await page.getByRole("button", { name: "Copy flags…" }).click();
    await expect(dialog.getByLabel("Only the selected flags (1)")).toBeChecked();
    await dialog.getByLabel("Overwrite it").check();
    await dialog.getByRole("button", { name: "Copy flags", exact: true }).click();
    await expect(dialog.getByText("Copy finished")).toBeVisible();
    await expect(dialog.getByText("Copied: 0")).toBeVisible();
    await expect(dialog.getByText("Overwritten: 1")).toBeVisible();
    await expect(dialog.getByText("Skipped: 0")).toBeVisible();

    targetString = await getFlag(request, account, target.id, "string-flag");
    expect(targetString.default_value).toBe("hello");
    expect(targetString.tags).toEqual(["copy-me"]);
    expect(targetString.states.staging).toMatchObject({ enabled: true, value: "staging-value", rollout_percent: 50 });

    // The archived flag was never copied; the target's flag_count grew.
    const targetFlags = await (
      await request.get(`${API_URL}/projects/${target.id}/flags?include_archived=true`, { headers: jwtHeaders(account) })
    ).json();
    expect(targetFlags.items.map((f: Flag) => f.key).sort()).toEqual([...expectedCopied, "string-flag"].sort());
    expect(targetFlags.items.map((f: Flag) => f.key)).not.toContain("json-flag");

    // One flag.copy audit event per run.
    const audit = await (
      await request.get(`${API_URL}/account/audit?limit=10&action=flag.copy`, { headers: jwtHeaders(account) })
    ).json();
    expect(audit.items).toHaveLength(2);
    expect(audit.items[0].meta).toMatchObject({ source_project_id: source.id, overwritten: ["string-flag"] });
  });

  test("API: copy to a project of another account is a 404", async ({ request }) => {
    const other = await registerAccount(request);
    const foreign = await createProject(request, other, { name: "Foreign" });
    const res = await request.post(`${API_URL}/projects/${source.id}/flags/copy`, {
      headers: jwtHeaders(account),
      data: { target_project_id: foreign.id },
    });
    expect(res.status()).toBe(404);
  });

  test("@critical UI: delete a flag from the editor", async ({ page, request }) => {
    const flag = await createFlag(request, account, source.id, { key: "doomed-ui" });
    await page.goto(`/dashboard/projects/${source.id}/flags/${flag.id}`);
    const deleteButton = page.getByRole("button", { name: "Delete flag" });
    await expect(deleteButton).toBeDisabled();
    await page.getByLabel("Type the flag key to confirm").fill("doomed-ui");
    await expect(deleteButton).toBeEnabled();
    await deleteButton.click();
    await expect(page).toHaveURL(new RegExp(`/dashboard/projects/${source.id}/?$`));
    await expect(page.getByRole("heading", { level: 1, name: "Flags source" })).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: "doomed-ui" })).toHaveCount(0);

    const gone = await request.get(`${API_URL}/projects/${source.id}/flags/${flag.id}`, { headers: jwtHeaders(account) });
    expect(gone.status()).toBe(404);
    const audit = await (
      await request.get(`${API_URL}/account/audit?limit=5&action=flag.delete`, { headers: jwtHeaders(account) })
    ).json();
    expect(audit.items[0].target_id).toBe(flag.id);
  });
});
