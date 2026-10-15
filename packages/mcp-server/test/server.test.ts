/**
 * End-to-end tests over a real MCP client/server pair (in-memory transport)
 * against a fake exp API. No network, no database.
 */
import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ElicitRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { MemoryAuditSink } from "../src/audit.js";
import { ExpClient } from "../src/client.js";
import { ALL_TOOLS } from "../src/rbac.js";
import { createExpServer } from "../src/server.js";
import type { Environment, Flag, FlagState, KeyInfo, Project, Role, Scope } from "../src/types.js";

import roles from "../../shared/api_key_roles.json";

const ROLE_SCOPES = Object.fromEntries(
  Object.entries(roles.roles).map(([r, v]) => [r, v.scopes as Scope[]]),
) as Record<Role, Scope[]>;

const keyInfo = (role: Role): KeyInfo => ({
  account: { id: "acc-1", name: "Test", plan: "pro", created_at: "2026-01-01T00:00:00Z" },
  key: { id: "key-1", prefix: "exp_live_test", role },
  scopes: ROLE_SCOPES[role],
});

const NOW = "2026-10-15T00:00:00Z";
const DEFAULT_STATE = (): FlagState => ({ enabled: false, value: null, rollout_percent: 100, updated_at: NOW });
const DEFAULT_ENVS = ["production", "staging", "development"];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const notFound = (what: string) => json(404, { error: { code: "not_found", message: `${what} not found.` } });

/** Just enough of the exp REST API to exercise every tool, with scope checks. */
class FakeApi {
  projects = new Map<string, Project & { environments: Environment[] }>();
  flags = new Map<string, Flag>();
  limitReached: null | "projects" | "environments" | "flags" = null;
  copyDisabled = false;
  calls: string[] = [];
  private n = 0;

  constructor(public role: Role) {}

  private need(scope: Scope): Response | null {
    return ROLE_SCOPES[this.role].includes(scope)
      ? null
      : json(403, { error: { code: "insufficient_scope", message: `lacks ${scope}`, required_scope: scope, role: this.role } });
  }

  private env(key: string, position: number): Environment {
    this.n += 1;
    return {
      id: crypto.randomUUID(),
      key,
      name: key[0]!.toUpperCase() + key.slice(1),
      client_key_prefix: `exp_env_k${this.n}`,
      client_key: `exp_env_k${this.n}secret`,
      position,
      created_at: NOW,
    };
  }

  private view(p: Project & { environments: Environment[] }): Project {
    // client_key is only returned on create / rotate
    return { ...p, environments: p.environments.map(({ client_key: _omit, ...e }) => e), flag_count: this.flagsOf(p.id).length };
  }

  private flagsOf(projectId: string): Flag[] {
    return [...this.flags.values()].filter((f) => f.project_id === projectId).sort((a, b) => a.key.localeCompare(b.key));
  }

  private findFlag(projectId: string, ref: string): Flag | undefined {
    return this.flagsOf(projectId).find((f) => f.id === ref || f.key === ref);
  }

  fetch = async (input: URL | RequestInfo, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const path = url.pathname.replace(/^\/api/, "");
    this.calls.push(`${method} ${path}`);
    const headers = init?.headers as Record<string, string>;
    if (headers["X-API-Key"] !== "exp_live_test") return json(401, { error: { code: "unauthorized", message: "bad key" } });
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (path === "/apikeys/me") return json(200, keyInfo(this.role));

    // --- projects ---
    if (path === "/projects" && method === "GET") {
      const items = [...this.projects.values()].map((p) => this.view(p));
      return this.need("projects:read") ?? json(200, { items, total: items.length });
    }
    if (path === "/projects" && method === "POST") {
      const denied = this.need("projects:write");
      if (denied) return denied;
      if (this.limitReached === "projects") return json(402, { error: { code: "limit_reached", message: "Project limit reached.", which: "projects" } });
      const key = body.key ?? String(body.name).toLowerCase().replace(/[^a-z0-9]+/g, "-");
      if ([...this.projects.values()].some((p) => p.key === key)) return json(409, { error: { code: "key_taken", message: `Key ${key} is taken.` } });
      const p = {
        id: crypto.randomUUID(), key, name: body.name, description: body.description ?? null, flag_count: 0,
        environments: DEFAULT_ENVS.map((k, i) => this.env(k, i)), created_at: NOW, updated_at: NOW,
      };
      this.projects.set(p.id, p);
      return json(201, { ...p }); // with one-time client keys
    }
    const pm = path.match(/^\/projects\/([^/]+)(?:\/(.*))?$/);
    if (!pm) {
      if (path === "/account/usage") {
        return this.need("usage:read") ?? json(200, {
          period_start: "2026-10-01", period_end: "2026-11-01", evaluations: 1234,
          counts: { projects: this.projects.size, api_keys: 1 },
          limits: { projects: 20, environments_per_project: 10, flags_per_project: 200, evaluations_per_month: 2000000, api_keys: 20 },
        });
      }
      if (path === "/account/audit") {
        return this.need("audit:read") ?? json(200, {
          items: [{
            id: "ev-1", ts: NOW, actor_type: "api_key", actor_id: "key-1", actor_label: "exp_live_test",
            action: "flag_state.update", target_type: "flag", target_id: "f-1", outcome: "ok", meta: { environment: "staging", fields: ["enabled"] },
          }],
        });
      }
      return notFound(`route ${method} ${path}`);
    }
    const project = this.projects.get(pm[1]!);
    if (!project) return notFound("Project");
    const sub = pm[2] ?? "";

    if (sub === "") {
      if (method === "GET") return this.need("projects:read") ?? json(200, this.view(project));
      if (method === "PATCH") {
        const denied = this.need("projects:write");
        if (denied) return denied;
        Object.assign(project, body);
        return json(200, this.view(project));
      }
      if (method === "DELETE") {
        const denied = this.need("projects:delete");
        if (denied) return denied;
        this.projects.delete(project.id);
        for (const f of this.flagsOf(project.id)) this.flags.delete(f.id);
        return new Response(null, { status: 204 });
      }
    }
    if (sub === "export") {
      return this.need("flags:read") ?? json(200, {
        format: "exp.project.v1", exported_at: NOW,
        project: { key: project.key, name: project.name, description: project.description },
        environments: project.environments.map(({ key, name, position }) => ({ key, name, position })),
        flags: this.flagsOf(project.id).map(({ key, name, description, kind, default_value, tags, archived, states }) => ({
          key, name, description, kind, default_value, tags, archived,
          states: Object.fromEntries(Object.entries(states).map(([k, s]) => [k, { enabled: s.enabled, value: s.value, rollout_percent: s.rollout_percent }])),
        })),
      });
    }

    // --- environments ---
    if (sub === "environments" && method === "POST") {
      const denied = this.need("projects:write");
      if (denied) return denied;
      if (this.limitReached === "environments") return json(402, { error: { code: "limit_reached", message: "Environment limit reached.", which: "environments" } });
      if (project.environments.some((e) => e.key === body.key)) return json(409, { error: { code: "key_taken", message: "Environment key taken." } });
      const e = this.env(body.key, project.environments.length);
      if (body.name) e.name = body.name;
      project.environments.push(e);
      for (const f of this.flagsOf(project.id)) f.states[e.key] = DEFAULT_STATE();
      return json(201, e);
    }
    const em = sub.match(/^environments\/([^/]+)\/rotate-key$/);
    if (em && method === "POST") {
      const denied = this.need("projects:write");
      if (denied) return denied;
      const e = project.environments.find((x) => x.id === em[1]);
      if (!e) return notFound("Environment");
      this.n += 1;
      e.client_key_prefix = `exp_env_r${this.n}`;
      e.client_key = `exp_env_r${this.n}secret`;
      return json(200, { client_key: e.client_key, client_key_prefix: e.client_key_prefix });
    }

    // --- flags ---
    if (sub === "flags" && method === "GET") {
      const denied = this.need("flags:read");
      if (denied) return denied;
      const inc = url.searchParams.get("include_archived") === "true";
      const items = this.flagsOf(project.id).filter((f) => inc || !f.archived);
      return json(200, { items, page: 1, per_page: 50, total: items.length });
    }
    if (sub === "flags" && method === "POST") {
      const denied = this.need("flags:write");
      if (denied) return denied;
      if (this.limitReached === "flags") return json(402, { error: { code: "limit_reached", message: "Flag limit reached.", which: "flags" } });
      if (this.findFlag(project.id, body.key)) return json(409, { error: { code: "key_taken", message: `Flag ${body.key} exists.` } });
      const kind = body.kind ?? "boolean";
      const states: Record<string, FlagState> = {};
      for (const e of project.environments) states[e.key] = { ...DEFAULT_STATE(), ...(body.states?.[e.key] ?? {}) };
      const f: Flag = {
        id: crypto.randomUUID(), project_id: project.id, key: body.key, name: body.name ?? body.key, description: body.description ?? null,
        kind, default_value: kind === "boolean" ? true : body.default_value ?? null, tags: body.tags ?? [], archived: false, states,
        created_at: NOW, updated_at: NOW,
      };
      this.flags.set(f.id, f);
      return json(201, f);
    }
    if (sub === "flags/copy" && method === "POST") {
      const denied = this.need("flags:write");
      if (denied) return denied;
      if (this.copyDisabled) return json(503, { error: { code: "feature_disabled", message: "flag-copy is off." } });
      const target = this.projects.get(body.target_project_id);
      if (!target) return notFound("Target project");
      const result = { target_project_id: target.id, copied: [] as string[], overwritten: [] as string[], skipped: [] as string[] };
      const keys: string[] = body.flag_keys ?? this.flagsOf(project.id).filter((f) => !f.archived).map((f) => f.key);
      for (const key of keys) {
        const src = this.findFlag(project.id, key)!;
        const existing = this.findFlag(target.id, key);
        if (existing && (body.on_conflict ?? "skip") === "skip") { result.skipped.push(key); continue; }
        if (existing) this.flags.delete(existing.id);
        const states: Record<string, FlagState> = {};
        for (const e of target.environments) states[e.key] = body.include_states === false ? DEFAULT_STATE() : { ...(src.states[e.key] ?? DEFAULT_STATE()) };
        this.flags.set(crypto.randomUUID(), { ...src, id: crypto.randomUUID(), project_id: target.id, states });
        (existing ? result.overwritten : result.copied).push(key);
      }
      return json(200, result);
    }
    if (sub === "flags/evaluate" && method === "GET") {
      const denied = this.need("flags:read");
      if (denied) return denied;
      const e = project.environments.find((x) => x.key === url.searchParams.get("environment"));
      if (!e) return notFound("Environment");
      const flags: Record<string, unknown> = {};
      for (const f of this.flagsOf(project.id)) {
        if (f.archived) continue;
        const s = f.states[e.key]!;
        const on = s.enabled && s.rollout_percent === 100;
        flags[f.key] = { kind: f.kind, enabled: on, value: f.kind === "boolean" ? on : on ? s.value ?? f.default_value : null };
      }
      return json(200, { project: { id: project.id, key: project.key }, environment: { id: e.id, key: e.key }, distinct_id: url.searchParams.get("distinct_id"), evaluated_at: NOW, flags });
    }
    const fm = sub.match(/^flags\/([^/]+)(?:\/states\/([^/]+))?$/);
    if (fm) {
      const f = this.findFlag(project.id, decodeURIComponent(fm[1]!));
      if (!f) return notFound("Flag");
      if (fm[2] && method === "PUT") {
        const denied = this.need("flags:write");
        if (denied) return denied;
        const s = f.states[fm[2]];
        if (!s) return notFound("Environment");
        Object.assign(s, body, { updated_at: NOW });
        return json(200, f);
      }
      if (method === "GET") return this.need("flags:read") ?? json(200, f);
      if (method === "PATCH") {
        const denied = this.need("flags:write");
        if (denied) return denied;
        if (body.kind && body.kind !== f.kind) for (const s of Object.values(f.states)) s.value = null;
        Object.assign(f, body);
        return json(200, f);
      }
      if (method === "DELETE") {
        const denied = this.need("flags:delete");
        if (denied) return denied;
        this.flags.delete(f.id);
        return new Response(null, { status: 204 });
      }
    }
    return notFound(`route ${method} ${path}`);
  };
}

type Elicit = (message: string) => Promise<{ action: "accept" | "decline" | "cancel"; content?: Record<string, unknown> }>;

async function connect(role: Role, opts: { elicit?: Elicit; apiRole?: Role } = {}) {
  const api = new FakeApi(opts.apiRole ?? role);
  const client = new ExpClient({ baseUrl: "http://fake/api", apiKey: "exp_live_test", fetch: api.fetch as typeof fetch });
  const audit = new MemoryAuditSink();
  const server = createExpServer({ client, keyInfo: keyInfo(role), audit, transport: "test" });

  const mcp = new Client({ name: "test-client", version: "0.0.0" }, { capabilities: opts.elicit ? { elicitation: { form: {} } } : {} });
  if (opts.elicit) mcp.setRequestHandler(ElicitRequestSchema, async (req) => opts.elicit!(req.params.message));

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);

  const call = (name: string, args: Record<string, unknown> = {}) =>
    mcp.callTool({ name, arguments: args }) as Promise<CallToolResult>;
  const toolNames = async () => (await mcp.listTools()).tools.map((t) => t.name).sort();
  const textOf = (r: CallToolResult) => r.content.map((c) => (c.type === "text" ? c.text : "")).join("\n");
  const project = async (name = "Web app") => (await call("create_project", { name })).structuredContent as Project;
  const flag = async (project_id: string, key = "new-checkout", extra: Record<string, unknown> = {}) =>
    (await call("create_flag", { project_id, key, ...extra })).structuredContent as Flag;
  return { api, mcp, audit, server, call, toolNames, textOf, project, flag };
}

describe("RBAC: tool visibility follows the key's role", () => {
  test("viewer sees read-only tools only", async () => {
    const { toolNames } = await connect("viewer");
    const names = await toolNames();
    expect(names).toEqual(["evaluate_flags", "export_project", "get_flag", "get_project", "get_usage", "list_flags", "list_projects"]);
    expect(names).not.toContain("create_flag");
    expect(names).not.toContain("delete_flag");
  });

  test("editor adds create/update/state/copy but no delete or audit", async () => {
    const { toolNames } = await connect("editor");
    const names = await toolNames();
    for (const t of ["create_project", "update_project", "create_environment", "rotate_environment_key", "create_flag", "update_flag", "set_flag_state", "copy_flags"]) {
      expect(names).toContain(t);
    }
    for (const t of ["delete_project", "delete_flag", "get_audit_log"]) expect(names).not.toContain(t);
  });

  test("admin sees every tool in CONTRACT.md", async () => {
    const { toolNames } = await connect("admin");
    expect(await toolNames()).toEqual([...ALL_TOOLS].sort());
    expect(ALL_TOOLS).toHaveLength(18);
  });

  test("a hidden tool cannot be called", async () => {
    const { call, textOf, api } = await connect("viewer");
    const r = await call("create_project", { name: "x" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/not found/i);
    expect(api.calls.filter((c) => c.startsWith("POST"))).toHaveLength(0);
  });

  test("the API's own scope check is surfaced as a denied result, not a crash", async () => {
    // Server believes it is admin, API says viewer (e.g. key downgraded after start).
    const { call, textOf, audit } = await connect("admin", { apiRole: "viewer" });
    const r = await call("create_project", { name: "x" });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toContain("insufficient_scope");
    expect(textOf(r)).toContain('"required_scope":"projects:write"');
    expect(audit.entries.at(-1)?.outcome).toBe("denied");
  });
});

describe("projects and environments", () => {
  test("create_project returns environments with one-time client keys", async () => {
    const c = await connect("editor");
    const p = await c.project();
    expect(p.key).toBe("web-app");
    expect(p.environments?.map((e) => e.key)).toEqual(["production", "staging", "development"]);
    expect(p.environments?.[0]?.client_key).toMatch(/^exp_env_/);
    // ...and get_project does not leak them again
    const again = (await c.call("get_project", { project_id: p.id })).structuredContent as Project;
    expect(again.environments?.[0]?.client_key).toBeUndefined();
    expect((await c.call("list_projects")).structuredContent).toMatchObject({ total: 1 });
  });

  test("key_taken and limit_reached surface with their codes", async () => {
    const c = await connect("editor");
    await c.project();
    const dup = await c.call("create_project", { name: "Web app" });
    expect(dup.isError).toBe(true);
    expect(c.textOf(dup)).toContain("key_taken");
    c.api.limitReached = "projects";
    const lim = await c.call("create_project", { name: "Other" });
    expect(lim.isError).toBe(true);
    expect(c.textOf(lim)).toContain("limit_reached");
    expect(c.textOf(lim)).toContain('"which":"projects"');
    expect(c.audit.entries.at(-1)?.error?.code).toBe("limit_reached");
  });

  test("create_environment, rotate_environment_key and update_project", async () => {
    const c = await connect("editor");
    const p = await c.project();
    await c.flag(p.id);
    const env = (await c.call("create_environment", { project_id: p.id, key: "qa" })).structuredContent as Environment;
    expect(env.client_key).toMatch(/^exp_env_/);
    const f = (await c.call("get_flag", { project_id: p.id, flag: "new-checkout" })).structuredContent as Flag;
    expect(f.states.qa).toMatchObject({ enabled: false, rollout_percent: 100 });

    const rot = await c.call("rotate_environment_key", { project_id: p.id, environment_id: env.id, confirm: true });
    expect(rot.isError).toBeFalsy();
    expect((rot.structuredContent as { client_key: string }).client_key).not.toBe(env.client_key);

    const up = (await c.call("update_project", { project_id: p.id, name: "Renamed" })).structuredContent as Project;
    expect(up.name).toBe("Renamed");
  });

  test("invalid input is rejected before reaching the API", async () => {
    const c = await connect("editor");
    const r = await c.call("create_project", { name: "x", key: "Not A Slug" });
    expect(r.isError).toBe(true);
    expect(c.api.calls.filter((x) => x.startsWith("POST"))).toHaveLength(0);
  });
});

describe("flags", () => {
  test("create_flag returns structured content with a state per environment and audits the call", async () => {
    const c = await connect("editor");
    const p = await c.project();
    const r = await c.call("create_flag", { project_id: p.id, key: "new-checkout", tags: ["checkout"], states: { development: { enabled: true } } });
    expect(r.isError).toBeFalsy();
    const f = r.structuredContent as Flag;
    expect(f.key).toBe("new-checkout");
    expect(f.kind).toBe("boolean");
    expect(f.default_value).toBe(true);
    expect(Object.keys(f.states).sort()).toEqual(["development", "production", "staging"]);
    expect(f.states.development?.enabled).toBe(true);
    expect(f.states.production?.enabled).toBe(false);
    expect(c.textOf(r)).toContain("development: on");
    const entry = c.audit.entries.find((e) => e.tool === "create_flag");
    expect(entry?.outcome).toBe("ok");
    expect(entry?.actor.role).toBe("editor");
    expect(entry?.args?.key).toBe("new-checkout");
  });

  test("rollout_percent outside 0-100 and bad kinds are rejected locally", async () => {
    const c = await connect("editor");
    const p = await c.project();
    const before = c.api.calls.length;
    expect((await c.call("create_flag", { project_id: p.id, key: "a", kind: "float" })).isError).toBe(true);
    expect((await c.call("set_flag_state", { project_id: p.id, flag: "a", environment: "staging", rollout_percent: 150 })).isError).toBe(true);
    expect((await c.call("copy_flags", { project_id: p.id, target_project_id: p.id, on_conflict: "merge" })).isError).toBe(true);
    expect(c.api.calls.length).toBe(before);
  });

  test("set_flag_state, update_flag, get_flag by key, list_flags round-trip", async () => {
    const c = await connect("editor");
    const p = await c.project();
    await c.flag(p.id, "banner-text", { kind: "string", default_value: "Hello" });
    const r = await c.call("set_flag_state", { project_id: p.id, flag: "banner-text", environment: "staging", enabled: true, rollout_percent: 25, value: "Hi" });
    expect(r.isError).toBeFalsy();
    expect((r.structuredContent as Flag).states.staging).toMatchObject({ enabled: true, rollout_percent: 25, value: "Hi" });
    expect(c.textOf(r)).toContain("banner-text in staging: on at 25%");
    expect(c.api.calls.at(-1)).toBe("PUT /projects/" + p.id + "/flags/banner-text/states/staging");

    const up = (await c.call("update_flag", { project_id: p.id, flag: "banner-text", archived: true, kind: "number" })).structuredContent as Flag;
    expect(up.archived).toBe(true);
    expect(up.states.staging?.value).toBeNull();

    expect(((await c.call("list_flags", { project_id: p.id })).structuredContent as { total: number }).total).toBe(0);
    expect(((await c.call("list_flags", { project_id: p.id, include_archived: true })).structuredContent as { total: number }).total).toBe(1);
    const got = (await c.call("get_flag", { project_id: p.id, flag: up.id })).structuredContent as Flag;
    expect(got.key).toBe("banner-text");
  });

  test("API errors become isError results with the stable code (limit_reached + which)", async () => {
    const c = await connect("editor");
    const p = await c.project();
    c.api.limitReached = "flags";
    const r = await c.call("create_flag", { project_id: p.id, key: "x" });
    expect(r.isError).toBe(true);
    expect(c.textOf(r)).toContain("limit_reached");
    expect(c.textOf(r)).toContain('"which":"flags"');
    expect(c.audit.entries.at(-1)?.error?.code).toBe("limit_reached");
    expect(c.audit.entries.at(-1)?.outcome).toBe("error");
  });

  test("copy_flags skips, overwrites and reports feature_disabled", async () => {
    const c = await connect("editor");
    const src = await c.project("Source");
    const dst = await c.project("Target");
    await c.flag(src.id, "a", { states: { production: { enabled: true } } });
    await c.flag(src.id, "b");
    await c.flag(dst.id, "a");
    const first = (await c.call("copy_flags", { project_id: src.id, target_project_id: dst.id })).structuredContent as { copied: string[]; skipped: string[] };
    expect(first.copied).toEqual(["b"]);
    expect(first.skipped).toEqual(["a"]);
    const second = (await c.call("copy_flags", { project_id: src.id, target_project_id: dst.id, flag_keys: ["a"], on_conflict: "overwrite" })).structuredContent as { overwritten: string[] };
    expect(second.overwritten).toEqual(["a"]);
    const copied = (await c.call("get_flag", { project_id: dst.id, flag: "a" })).structuredContent as Flag;
    expect(copied.states.production?.enabled).toBe(true);
    c.api.copyDisabled = true;
    const off = await c.call("copy_flags", { project_id: src.id, target_project_id: dst.id });
    expect(off.isError).toBe(true);
    expect(c.textOf(off)).toContain("feature_disabled");
  });

  test("evaluate_flags and export_project are available to a viewer", async () => {
    const admin = await connect("admin");
    const p = await admin.project();
    await admin.flag(p.id, "a", { states: { production: { enabled: true } } });
    await admin.flag(p.id, "b");
    // Reuse the same fake API with a viewer key.
    const viewer = await connect("viewer");
    viewer.api.projects = admin.api.projects;
    viewer.api.flags = admin.api.flags;
    const ev = await viewer.call("evaluate_flags", { project_id: p.id, environment: "production", distinct_id: "user-42" });
    expect(ev.isError).toBeFalsy();
    expect((ev.structuredContent as { flags: Record<string, { enabled: boolean }> }).flags).toEqual({
      a: { kind: "boolean", enabled: true, value: true },
      b: { kind: "boolean", enabled: false, value: false },
    });
    expect(viewer.api.calls.at(-1)).toBe(`GET /projects/${p.id}/flags/evaluate`);
    const ex = await viewer.call("export_project", { project_id: p.id });
    expect(ex.isError).toBeFalsy();
    const x = ex.structuredContent as { format: string; flags: unknown[]; environments: unknown[] };
    expect(x.format).toBe("exp.project.v1");
    expect(x.flags).toHaveLength(2);
    expect(x.environments).toHaveLength(3);
  });

  test("get_usage and get_audit_log return schema-valid structured content", async () => {
    const c = await connect("admin");
    const u = await c.call("get_usage");
    expect(u.isError).toBeFalsy();
    expect(c.textOf(u)).toContain("1234/2000000 evaluations");
    const a = await c.call("get_audit_log", { limit: 5 });
    expect(a.isError).toBeFalsy();
    expect((a.structuredContent as { items: unknown[] }).items).toHaveLength(1);
    expect(c.textOf(a)).toContain("flag_state.update");
  });
});

describe("destructive tools require human approval", () => {
  test("delete_project refuses without confirmation and succeeds with confirm=true", async () => {
    const c = await connect("admin");
    const p = await c.project();
    await c.flag(p.id);

    const refused = await c.call("delete_project", { project_id: p.id });
    expect(refused.isError).toBe(true);
    expect(c.textOf(refused)).toContain("confirmation_required");
    expect(c.textOf(refused)).toContain("Web app");
    expect(c.api.projects.has(p.id)).toBe(true);
    expect(c.audit.entries.at(-1)?.outcome).toBe("pending");
    expect(c.api.calls.filter((x) => x.startsWith("DELETE"))).toHaveLength(0);

    const done = await c.call("delete_project", { project_id: p.id, confirm: true });
    expect(done.isError).toBeFalsy();
    expect(done.structuredContent).toEqual({ deleted: true, id: p.id, key: "web-app", name: "Web app" });
    expect(c.api.projects.has(p.id)).toBe(false);
    expect(c.api.flags.size).toBe(0);
    expect(c.audit.entries.at(-1)?.outcome).toBe("ok");
  });

  test("delete_flag refuses without confirmation and succeeds with confirm=true", async () => {
    const c = await connect("admin");
    const p = await c.project();
    const f = await c.flag(p.id);
    const refused = await c.call("delete_flag", { project_id: p.id, flag: "new-checkout" });
    expect(refused.isError).toBe(true);
    expect(c.textOf(refused)).toContain("confirmation_required");
    expect(c.api.flags.has(f.id)).toBe(true);
    const done = await c.call("delete_flag", { project_id: p.id, flag: "new-checkout", confirm: true });
    expect(done.isError).toBeFalsy();
    expect(done.structuredContent).toEqual({ deleted: true, id: f.id, key: "new-checkout", project_id: p.id });
    expect(c.api.flags.has(f.id)).toBe(false);
  });

  test("with elicitation, the user is asked and can accept", async () => {
    const asked: string[] = [];
    const c = await connect("admin", {
      elicit: async (message) => {
        asked.push(message);
        return { action: "accept", content: { confirm: true } };
      },
    });
    const p = await c.project();
    const f = await c.flag(p.id, "a", { states: { staging: { enabled: true } } });
    const done = await c.call("delete_flag", { project_id: p.id, flag: f.id });
    expect(done.isError).toBeFalsy();
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('"a"');
    expect(asked[0]).toContain("ON in staging");
    expect(c.api.flags.has(f.id)).toBe(false);
  });

  test("with elicitation, declining cancels and nothing is deleted", async () => {
    const c = await connect("admin", { elicit: async () => ({ action: "decline" }) });
    const p = await c.project();
    const r = await c.call("delete_project", { project_id: p.id });
    expect(r.isError).toBeFalsy();
    expect(c.textOf(r)).toContain("cancelled");
    expect((r.structuredContent as { deleted: boolean }).deleted).toBe(false);
    expect(c.api.projects.has(p.id)).toBe(true);
    expect(c.audit.entries.at(-1)?.outcome).toBe("cancelled");
    expect(c.api.calls.filter((x) => x.startsWith("DELETE"))).toHaveLength(0);
  });
});

describe("resources and prompts", () => {
  test("projects resource and flags template are exposed for a viewer", async () => {
    const admin = await connect("admin");
    const p = await admin.project();
    await admin.flag(p.id);
    const viewer = await connect("viewer");
    viewer.api.projects = admin.api.projects;
    viewer.api.flags = admin.api.flags;
    const res = await viewer.mcp.listResources();
    expect(res.resources.map((r) => r.uri)).toContain("exp://projects");
    const tpl = await viewer.mcp.listResourceTemplates();
    expect(tpl.resourceTemplates.map((t) => t.uriTemplate)).toContain("exp://projects/{id}/flags");
    const list = await viewer.mcp.readResource({ uri: "exp://projects" });
    expect(JSON.parse((list.contents[0] as { text: string }).text).total).toBe(1);
    const flags = await viewer.mcp.readResource({ uri: `exp://projects/${p.id}/flags` });
    expect(JSON.parse((flags.contents[0] as { text: string }).text).items[0].key).toBe("new-checkout");
  });

  test("rollout-plan prompt is available when flags:read is granted", async () => {
    const { mcp } = await connect("viewer");
    const prompts = await mcp.listPrompts();
    expect(prompts.prompts.map((p) => p.name)).toContain("rollout-plan");
    const got = await mcp.getPrompt({ name: "rollout-plan", arguments: { project_id: "p-1", flag: "new-checkout" } });
    const text = (got.messages[0]!.content as { text: string }).text;
    expect(text).toContain('project_id="p-1"');
    expect(text).toContain("set_flag_state");
  });
});

describe("rotate_environment_key requires human approval", () => {
  const seed = async (c: Awaited<ReturnType<typeof connect>>) => {
    const p = await c.project();
    return { p, env: p.environments![0]! };
  };

  test("refuses without confirmation and succeeds with confirm=true", async () => {
    const c = await connect("editor");
    const { p, env } = await seed(c);
    const refused = await c.call("rotate_environment_key", { project_id: p.id, environment_id: env.id });
    expect(refused.isError).toBe(true);
    expect(c.textOf(refused)).toContain("confirmation_required");
    expect(c.textOf(refused)).toContain("production");
    expect(c.audit.entries.at(-1)?.outcome).toBe("pending");
    expect(c.api.calls.filter((x) => x.endsWith("/rotate-key"))).toHaveLength(0);

    const done = await c.call("rotate_environment_key", { project_id: p.id, environment_id: env.id, confirm: true });
    expect(done.isError).toBeFalsy();
    const sc = done.structuredContent as { rotated: boolean; client_key: string; client_key_prefix: string };
    expect(sc.rotated).toBe(true);
    expect(sc.client_key).toMatch(/^exp_env_/);
    expect(sc.client_key).not.toBe(env.client_key);
    expect(sc.client_key_prefix).not.toBe(env.client_key_prefix);
    expect(c.audit.entries.at(-1)?.outcome).toBe("ok");
  });

  test("with elicitation, declining cancels and the key is untouched", async () => {
    const asked: string[] = [];
    const c = await connect("editor", {
      elicit: async (message) => {
        asked.push(message);
        return { action: "decline" };
      },
    });
    const { p, env } = await seed(c);
    const r = await c.call("rotate_environment_key", { project_id: p.id, environment_id: env.id });
    expect(r.isError).toBeFalsy();
    expect(c.textOf(r)).toContain("cancelled");
    expect((r.structuredContent as { rotated: boolean }).rotated).toBe(false);
    expect(asked[0]).toContain("Rotate the client key of environment production");
    expect(c.api.calls.filter((x) => x.endsWith("/rotate-key"))).toHaveLength(0);
    expect(c.audit.entries.at(-1)?.outcome).toBe("cancelled");
  });
});
