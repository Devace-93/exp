import { test, expect } from "@playwright/test";
import {
  ALL_MCP_TOOLS,
  API_URL,
  ROLE_SCOPES,
  createApiKey,
  createFlag,
  createProject,
  jwtHeaders,
  mcpCall,
  mcpRpc,
  MCP_INIT_PARAMS,
  registerAccount,
  toolsForScopes,
  type Account,
  type Project,
} from "../helpers";

/**
 * Remote MCP endpoint (Streamable HTTP at POST /mcp): auth, role-filtered tool
 * list, destructive-tool confirmation and tools/call round trips.
 */
test.describe("MCP over HTTP", () => {
  let account: Account;
  let viewerKey: string;
  let editorKey: string;
  let adminKey: string;
  let project: Project;
  let other: Project;

  test.beforeAll(async ({ request }) => {
    account = await registerAccount(request);
    viewerKey = (await createApiKey(request, account, "mcp viewer", "viewer")).key;
    editorKey = (await createApiKey(request, account, "mcp editor", "editor")).key;
    adminKey = (await createApiKey(request, account, "mcp admin", "admin")).key;
    project = await createProject(request, account, { name: "MCP project", key: "mcp-project" });
    other = await createProject(request, account, { name: "MCP other", key: "mcp-other" });
    await createFlag(request, account, project.id, { key: "doomed" });
    await createFlag(request, account, project.id, {
      key: "keeper",
      kind: "string",
      default_value: "v1",
      states: { production: { enabled: true } },
    });
  });

  test("@critical rejects requests without a key", async ({ request }) => {
    const res = await mcpRpc(request, "initialize", MCP_INIT_PARAMS);
    expect(res.status).toBe(401);
    expect(res.messages[0]?.error?.message ?? res.raw).toMatch(/api key/i);
  });

  test("@critical rejects a bogus key", async ({ request }) => {
    const res = await mcpRpc(request, "initialize", MCP_INIT_PARAMS, { apiKey: "exp_live_not_a_real_key" });
    expect(res.status).toBe(401);
  });

  test("initialize names the server and the key's role", async ({ request }) => {
    const init = await mcpRpc(request, "initialize", MCP_INIT_PARAMS, { apiKey: viewerKey });
    expect(init.status).toBe(200);
    expect(init.messages[0].result.serverInfo.name).toBe("exp");
    expect(init.messages[0].result.instructions).toContain("viewer");
  });

  test("@critical viewer key: only read tools", async ({ request }) => {
    const msg = await mcpCall(request, viewerKey, "tools/list");
    const names = (msg.result.tools as Array<{ name: string }>).map((t) => t.name).sort();
    expect(names).toEqual(toolsForScopes(ROLE_SCOPES.viewer));
    expect(names).toEqual(
      ["list_projects", "get_project", "list_flags", "get_flag", "export_project", "evaluate_flags", "get_usage"].sort(),
    );
  });

  test("@critical editor key: sees create_flag but not delete_flag", async ({ request }) => {
    const msg = await mcpCall(request, editorKey, "tools/list");
    const names = (msg.result.tools as Array<{ name: string }>).map((t) => t.name).sort();
    expect(names).toEqual(toolsForScopes(ROLE_SCOPES.editor));
    expect(names).toContain("create_flag");
    expect(names).toContain("copy_flags");
    expect(names).not.toContain("delete_flag");
    expect(names).not.toContain("delete_project");
    expect(names).not.toContain("get_audit_log");
  });

  test("@critical admin key: all 18 tools", async ({ request }) => {
    const msg = await mcpCall(request, adminKey, "tools/list");
    const names = (msg.result.tools as Array<{ name: string }>).map((t) => t.name).sort();
    expect(names).toHaveLength(18);
    expect(names).toEqual([...ALL_MCP_TOOLS].sort());
  });

  test("viewer can list flags but calling create_flag is refused", async ({ request }) => {
    const list = await mcpCall(request, viewerKey, "tools/call", {
      name: "list_flags",
      arguments: { project_id: project.id },
    });
    expect(list.result.isError, JSON.stringify(list)).toBeFalsy();
    const keys = (list.result.structuredContent.items as Array<{ key: string }>).map((f) => f.key).sort();
    expect(keys).toEqual(["doomed", "keeper"]);

    const msg = await mcpCall(request, viewerKey, "tools/call", {
      name: "create_flag",
      arguments: { project_id: project.id, key: "viewer-made" },
    });
    expect(msg.result?.structuredContent?.id).toBeUndefined();
    expect(msg.error || msg.result?.isError, JSON.stringify(msg)).toBeTruthy();
    const check = await request.get(`${API_URL}/projects/${project.id}/flags/viewer-made`, { headers: jwtHeaders(account) });
    expect(check.status()).toBe(404);
  });

  test("@critical editor: create_flag + set_flag_state round trip", async ({ request }) => {
    const created = await mcpCall(request, editorKey, "tools/call", {
      name: "create_flag",
      arguments: { project_id: project.id, key: "agent-made", kind: "number", default_value: 3 },
    });
    expect(created.result.isError, JSON.stringify(created)).toBeFalsy();
    expect(created.result.structuredContent.key).toBe("agent-made");

    const set = await mcpCall(request, editorKey, "tools/call", {
      name: "set_flag_state",
      arguments: { project_id: project.id, flag: "agent-made", environment: "staging", enabled: true, rollout_percent: 25 },
    });
    expect(set.result.isError, JSON.stringify(set)).toBeFalsy();
    const flag = await (
      await request.get(`${API_URL}/projects/${project.id}/flags/agent-made`, { headers: jwtHeaders(account) })
    ).json();
    expect(flag.states.staging).toMatchObject({ enabled: true, rollout_percent: 25 });
  });

  test("@critical delete_flag refuses without confirm and deletes with confirm: true", async ({ request }) => {
    const refused = await mcpCall(request, adminKey, "tools/call", {
      name: "delete_flag",
      arguments: { project_id: project.id, flag: "doomed" },
    });
    expect(refused.result.isError, JSON.stringify(refused)).toBe(true);
    expect(JSON.stringify(refused.result.content)).toContain("confirmation_required");
    const still = await request.get(`${API_URL}/projects/${project.id}/flags/doomed`, { headers: jwtHeaders(account) });
    expect(still.status()).toBe(200);

    const done = await mcpCall(request, adminKey, "tools/call", {
      name: "delete_flag",
      arguments: { project_id: project.id, flag: "doomed", confirm: true },
    });
    expect(done.result.isError, JSON.stringify(done)).toBeFalsy();
    expect(done.result.structuredContent).toMatchObject({ deleted: true, key: "doomed" });
    const gone = await request.get(`${API_URL}/projects/${project.id}/flags/doomed`, { headers: jwtHeaders(account) });
    expect(gone.status()).toBe(404);

    // Audit attributes the deletion to the API key.
    const audit = await mcpCall(request, adminKey, "tools/call", {
      name: "get_audit_log",
      arguments: { action: "flag.delete", limit: 5 },
    });
    expect(audit.result.isError, JSON.stringify(audit)).toBeFalsy();
    const items = audit.result.structuredContent.items as Array<{ actor_type: string; action: string }>;
    expect(items[0]).toMatchObject({ action: "flag.delete", actor_type: "api_key" });
  });

  test("@critical copy_flags copies into another project of the account", async ({ request }) => {
    const msg = await mcpCall(request, editorKey, "tools/call", {
      name: "copy_flags",
      arguments: { project_id: project.id, target_project_id: other.id, flag_keys: ["keeper"], include_states: true },
    });
    expect(msg.result.isError, JSON.stringify(msg)).toBeFalsy();
    expect(msg.result.structuredContent).toMatchObject({
      target_project_id: other.id,
      copied: ["keeper"],
      overwritten: [],
      skipped: [],
    });
    const copied = await (
      await request.get(`${API_URL}/projects/${other.id}/flags/keeper`, { headers: jwtHeaders(account) })
    ).json();
    expect(copied.default_value).toBe("v1");
    expect(copied.states.production.enabled).toBe(true);

    // Second copy with the default on_conflict=skip.
    const again = await mcpCall(request, editorKey, "tools/call", {
      name: "copy_flags",
      arguments: { project_id: project.id, target_project_id: other.id, flag_keys: ["keeper"] },
    });
    expect(again.result.structuredContent).toMatchObject({ copied: [], skipped: ["keeper"] });
  });

  test("evaluate_flags previews an environment", async ({ request }) => {
    const msg = await mcpCall(request, viewerKey, "tools/call", {
      name: "evaluate_flags",
      arguments: { project_id: project.id, environment: "production", distinct_id: "user-42" },
    });
    expect(msg.result.isError, JSON.stringify(msg)).toBeFalsy();
    const sc = msg.result.structuredContent;
    expect(sc.environment.key).toBe("production");
    expect(sc.flags.keeper).toEqual({ kind: "string", enabled: true, value: "v1" });
  });
});
