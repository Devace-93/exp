import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { BASE_URL } from "./playwright.config";

export const API_URL = `${BASE_URL}/api`;
export const MCP_URL = `${BASE_URL}/mcp`;

/**
 * Identity lives at accounts.3m4.net. Locally that is the accounts stack on
 * :8085 (Mailpit on :8025 for the verification mail); the `3m4_session`
 * cookie it sets for `localhost` is sent to this app on :8081 as well.
 */
export const ACCOUNTS_URL = (process.env.E2E_ACCOUNTS_URL || "http://localhost:8085").replace(/\/$/, "");
export const MAILPIT_URL = (process.env.E2E_MAILPIT_URL || "http://localhost:8025").replace(/\/$/, "");
export const SESSION_COOKIE = "3m4_session";

export const PASSWORD = "E2e-Passw0rd!";

export type Role = "viewer" | "editor" | "admin";
export type FlagKind = "boolean" | "string" | "number" | "json";

export interface Account {
  email: string;
  password: string;
  /** Accounts identity id (`sub`). */
  identityId: string;
  handle: string;
  /** The app's local user / account ids, from /auth/me. */
  userId: string;
  accountId: string;
  /** The current `3m4_session` JWT (also accepted as a bearer by the API). */
  sessionToken: string;
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

/* ─── Mailpit (local accounts stack) ──────────────────────────────────────── */

interface MailpitSummary {
  ID: string;
  Created: string;
}

async function mailpitJson<T>(path: string): Promise<T> {
  const res = await fetch(`${MAILPIT_URL}/api/v1${path}`);
  if (!res.ok) throw new Error(`mailpit ${path}: ${res.status}`);
  return (await res.json()) as T;
}

/** The accounts e-mail verification token sent to `email` (polls Mailpit). */
export async function waitForVerifyToken(email: string, timeoutMs = 20_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = await mailpitJson<{ messages: MailpitSummary[] }>(
      `/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    for (const m of found.messages ?? []) {
      const msg = await mailpitJson<{ Text?: string; HTML?: string }>(`/message/${m.ID}`);
      const match = `${msg.Text ?? ""}\n${msg.HTML ?? ""}`.match(/verify\?token=([A-Za-z0-9_-]+)/);
      if (match) return match[1];
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no verification mail for ${email} at ${MAILPIT_URL}`);
}

async function sessionCookie(request: APIRequestContext): Promise<string> {
  const state = await request.storageState();
  const cookie = state.cookies.find((c) => c.name === SESSION_COOKIE);
  expect(cookie, "3m4_session cookie after accounts login").toBeTruthy();
  return cookie!.value;
}

/**
 * Create a fresh, verified identity at accounts and let this app provision
 * its tenant. The cookies stay in `request`'s jar, so later calls to the app
 * API from the same context are authenticated. Never reuses existing data.
 */
export async function registerAccount(
  request: APIRequestContext,
  opts: { email?: string } = {},
): Promise<Account> {
  const email = opts.email ?? uniqueEmail();
  const signup = await request.post(`${ACCOUNTS_URL}/api/auth/signup`, {
    data: { email, password: PASSWORD },
  });
  expect(signup.status(), `accounts signup ${email}: ${await signup.text()}`).toBe(201);
  const identity = (await signup.json()).user as { id: string; handle: string };

  // Verify the e-mail (the app refuses writes until then) and refresh so the
  // access cookie carries email_verified=true.
  const token = await waitForVerifyToken(email);
  const verify = await request.post(`${ACCOUNTS_URL}/api/auth/verify/consume`, { data: { token } });
  expect(verify.status(), `verify consume: ${await verify.text()}`).toBe(200);
  const refresh = await request.post(`${ACCOUNTS_URL}/api/session/refresh`, { data: {} });
  expect(refresh.status(), `session refresh: ${await refresh.text()}`).toBe(200);

  // First call provisions the local user + workspace.
  const me = await request.get(`${API_URL}/auth/me`);
  expect(me.status(), `auth/me: ${await me.text()}`).toBe(200);
  const body = await me.json();
  return {
    email,
    password: PASSWORD,
    identityId: identity.id,
    handle: identity.handle,
    userId: body.user.id,
    accountId: body.account.id,
    sessionToken: await sessionCookie(request),
  };
}

/** Bearer form of the session (for request contexts without the cookie jar). */
export function jwtHeaders(account: Pick<Account, "sessionToken">) {
  return { Authorization: `Bearer ${account.sessionToken}` };
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
 * Give the browser the accounts session of `account` (fast path for dashboard
 * tests): sets the `3m4_session` cookie for the app's host exactly as accounts
 * would (host-only on localhost). The token is good for 15 minutes, plenty for
 * a spec; no refresh cookie is seeded. No navigation needed.
 */
export async function seedSession(page: Page, account: Pick<Account, "sessionToken">): Promise<void> {
  await page.context().addCookies([
    {
      name: SESSION_COOKIE,
      value: account.sessionToken,
      domain: new URL(BASE_URL).hostname,
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
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
