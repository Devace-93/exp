import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { BASE_URL } from "./playwright.config";

export const API_URL = `${BASE_URL}/api`;
export const MCP_URL = `${BASE_URL}/mcp`;

/** localStorage keys used by apps/web/src/lib/auth.ts */
export const ACCESS_KEY = "exp_access_token";
export const REFRESH_KEY = "exp_refresh_token";

export const PASSWORD = "E2e-Passw0rd!";

export type Role = "viewer" | "editor" | "admin";
export type FlagKind = "boolean" | "string" | "number" | "json";

export interface Account {
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  userId: string;
  accountId: string;
}

export interface Environment {
  id: string;
  key: string;
  name: string;
  client_key_prefix: string;
  client_key?: string;
  position: number;
}

export interface FlagState {
  enabled: boolean;
  value: unknown;
  rollout_percent: number;
  updated_at?: string;
}

export interface Flag {
  id: string;
  project_id: string;
  key: string;
  name: string | null;
  description?: string | null;
  kind: FlagKind;
  default_value: unknown;
  tags: string[];
  archived: boolean;
  states: Record<string, FlagState>;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  flag_count: number;
  environments: Environment[];
}

export function uniqueEmail(tag = "e2e"): string {
  return `${tag}+${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

export function uniqueKey(prefix = "k"): string {
  return `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Create a fresh account through the API. Never reuses existing data. */
export async function registerAccount(
  request: APIRequestContext,
  opts: { email?: string; accountName?: string } = {},
): Promise<Account> {
  const email = opts.email ?? uniqueEmail();
  const res = await request.post(`${API_URL}/auth/register`, {
    data: { email, password: PASSWORD, account_name: opts.accountName },
  });
  expect(res.status(), `register ${email}: ${await res.text()}`).toBe(201);
  const body = await res.json();
  return {
    email,
    password: PASSWORD,
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    userId: body.user.id,
    accountId: body.account.id,
  };
}

export function jwtHeaders(account: Pick<Account, "accessToken">) {
  return { Authorization: `Bearer ${account.accessToken}` };
}

/** Management API key (exp_live_…). */
export function keyHeaders(key: string) {
  return { "X-API-Key": key };
}

/** Environment client key (exp_env_…) for the evaluation API. */
export function envKeyHeaders(clientKey: string) {
  return { "X-Environment-Key": clientKey };
}

/** POST /api/apikeys with a JWT. Returns the one-time secret plus metadata. */
export async function createApiKey(
  request: APIRequestContext,
  account: Account,
  name: string,
  role: Role,
): Promise<{ id: string; key: string; prefix: string; role: Role }> {
  const res = await request.post(`${API_URL}/apikeys`, {
    headers: jwtHeaders(account),
    data: { name, role },
  });
  expect(res.status(), `create api key: ${await res.text()}`).toBe(201);
  return res.json();
}

/** POST /api/projects with a JWT. Environments come back with one-time client keys. */
export async function createProject(
  request: APIRequestContext,
  account: Account,
  input: { name: string; key?: string; description?: string },
): Promise<Project> {
  const res = await request.post(`${API_URL}/projects`, {
    headers: jwtHeaders(account),
    data: input,
  });
  expect(res.status(), `create project: ${await res.text()}`).toBe(201);
  return res.json();
}

/** POST /api/projects/:id/flags with a JWT. */
export async function createFlag(
  request: APIRequestContext,
  account: Account,
  projectId: string,
  input: {
    key: string;
    name?: string;
    description?: string;
    kind?: FlagKind;
    default_value?: unknown;
    tags?: string[];
    states?: Record<string, Partial<FlagState>>;
  },
): Promise<Flag> {
  const res = await request.post(`${API_URL}/projects/${projectId}/flags`, {
    headers: jwtHeaders(account),
    data: input,
  });
  expect(res.status(), `create flag ${input.key}: ${await res.text()}`).toBe(201);
  return res.json();
}

export async function getFlag(
  request: APIRequestContext,
  account: Account,
  projectId: string,
  flag: string,
): Promise<Flag> {
  const res = await request.get(`${API_URL}/projects/${projectId}/flags/${flag}`, {
    headers: jwtHeaders(account),
  });
  expect(res.status(), `get flag ${flag}: ${await res.text()}`).toBe(200);
  return res.json();
}

export function envByKey(project: Project, key: string): Environment {
  const env = project.environments.find((e) => e.key === key);
  expect(env, `environment ${key} on project ${project.key}`).toBeTruthy();
  return env!;
}

/**
 * The rollout bucket rule from CONTRACT.md: first 8 hex chars of
 * sha256("<flag_key>:<distinct_id>") as an integer, modulo 100.
 */
export function rolloutBucket(flagKey: string, distinctId: string): number {
  const hex = createHash("sha256").update(`${flagKey}:${distinctId}`, "utf8").digest("hex");
  return parseInt(hex.slice(0, 8), 16) % 100;
}

/**
 * Seed the browser session with API-issued tokens (fast path for dashboard
 * tests). The app reads them from localStorage on hydration. Must be called
 * after the page is on the app origin (localStorage is origin-scoped).
 */
export async function seedSession(page: Page, account: Account): Promise<void> {
  await page.goto("/login");
  await page.evaluate(
    ([ak, rk, at, rt]) => {
      localStorage.setItem(ak, at);
      localStorage.setItem(rk, rt);
    },
    [ACCESS_KEY, REFRESH_KEY, account.accessToken, account.refreshToken] as const,
  );
}

/** Log in through the real /login form. */
export async function loginViaUi(page: Page, email: string, password = PASSWORD): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/dashboard\/?$/);
}

/** Poll an async condition until it holds. */
export async function pollUntil<T>(
  fn: () => Promise<T>,
  predicate: (v: T) => boolean,
  { timeoutMs = 15_000, intervalMs = 500 } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T = await fn();
  while (!predicate(last) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await fn();
  }
  return last;
}

/* ─── MCP (Streamable HTTP) ────────────────────────────────────────────── */

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: any;
  error?: { code: number; message: string; data?: unknown };
}

/**
 * Parse a Streamable HTTP response body. The server may answer with plain JSON
 * or with SSE frames ("event: message\ndata: {...}\n\n"); return every JSON-RPC
 * message found, in order.
 */
export function parseMcpBody(contentType: string | undefined, body: string): JsonRpcResponse[] {
  const text = body.trim();
  if (!text) return [];
  if (!(contentType ?? "").includes("text/event-stream")) {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  const messages: JsonRpcResponse[] = [];
  for (const frame of text.split(/\n\n+/)) {
    const data = frame
      .split("\n")
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .join("\n");
    if (data) messages.push(JSON.parse(data));
  }
  return messages;
}

export interface McpCallResult {
  status: number;
  messages: JsonRpcResponse[];
  raw: string;
}

export async function mcpRpc(
  request: APIRequestContext,
  method: string,
  params: Record<string, unknown> = {},
  opts: { apiKey?: string; id?: number } = {},
): Promise<McpCallResult> {
  const headers: Record<string, string> = {
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  };
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
  const res = await request.post(MCP_URL, {
    headers,
    data: { jsonrpc: "2.0", id: opts.id ?? 1, method, params },
    maxRedirects: 0,
  });
  const raw = await res.text();
  let messages: JsonRpcResponse[] = [];
  try {
    messages = parseMcpBody(res.headers()["content-type"], raw);
  } catch {
    /* non-JSON body (e.g. 401 text) — caller inspects status/raw */
  }
  return { status: res.status(), messages, raw };
}

export const MCP_INIT_PARAMS = {
  protocolVersion: "2025-03-26",
  capabilities: {},
  clientInfo: { name: "exp-e2e", version: "0.0.0" },
};

/** Convenience: initialize then return the first result message of `method`. */
export async function mcpCall(
  request: APIRequestContext,
  apiKey: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<JsonRpcResponse> {
  const init = await mcpRpc(request, "initialize", MCP_INIT_PARAMS, { apiKey, id: 1 });
  expect(init.status, `initialize: ${init.raw}`).toBe(200);
  expect(init.messages[0]?.result?.serverInfo?.name).toBe("exp");
  const out = await mcpRpc(request, method, params, { apiKey, id: 2 });
  expect(out.status, `${method}: ${out.raw}`).toBe(200);
  const msg = out.messages.find((m) => m.id === 2) ?? out.messages[0];
  expect(msg, `${method}: no JSON-RPC message in body: ${out.raw}`).toBeTruthy();
  return msg!;
}

/** The 18 tools from CONTRACT.md, grouped by scope. */
export const MCP_TOOLS_BY_SCOPE = {
  "projects:read": ["list_projects", "get_project"],
  "projects:write": ["create_project", "update_project", "create_environment", "rotate_environment_key"],
  "projects:delete": ["delete_project"],
  "flags:read": ["list_flags", "get_flag", "export_project", "evaluate_flags"],
  "flags:write": ["create_flag", "update_flag", "set_flag_state", "copy_flags"],
  "flags:delete": ["delete_flag"],
  "usage:read": ["get_usage"],
  "audit:read": ["get_audit_log"],
} as const;

export const ALL_MCP_TOOLS = [
  "list_projects",
  "get_project",
  "create_project",
  "update_project",
  "create_environment",
  "rotate_environment_key",
  "delete_project",
  "list_flags",
  "get_flag",
  "export_project",
  "evaluate_flags",
  "create_flag",
  "update_flag",
  "set_flag_state",
  "copy_flags",
  "delete_flag",
  "get_usage",
  "get_audit_log",
] as const;

/** Tools a key with the given scopes should see (mirrors packages/mcp-server/src/rbac.ts). */
export function toolsForScopes(scopes: readonly string[]): string[] {
  const out: string[] = [];
  for (const [scope, tools] of Object.entries(MCP_TOOLS_BY_SCOPE)) {
    if (scopes.includes(scope)) out.push(...tools);
  }
  return out.sort();
}

/** Roles → scopes, mirroring packages/shared/api_key_roles.json. */
export const ROLE_SCOPES: Record<Role, string[]> = {
  viewer: ["projects:read", "flags:read", "usage:read"],
  editor: ["projects:read", "projects:write", "flags:read", "flags:write", "usage:read"],
  admin: [
    "projects:read",
    "projects:write",
    "projects:delete",
    "flags:read",
    "flags:write",
    "flags:delete",
    "usage:read",
    "audit:read",
  ],
};
