/**
 * API client for the exp Flask backend.
 *
 * - Base URL from VITE_API_URL (fallback "/api" — works behind Caddy).
 * - Attaches the bearer access token.
 * - On a 401, transparently refreshes via POST /auth/refresh (once) and retries.
 *
 * Throws `ApiRequestError` (carrying the parsed `error` body + HTTP status) so
 * callers can branch on e.g. 402 limit_reached (`error.which`).
 */
import {
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  clearTokens,
} from "./auth";
import type {
  ApiError,
  ApiKey,
  ApiKeyRole,
  AuditEvent,
  AuthResponse,
  CopyResult,
  Environment,
  Evaluation,
  Flag,
  FlagKind,
  FlagValue,
  MeResponse,
  OnConflict,
  Paginated,
  Project,
  ProjectExport,
  RolesResponse,
  StatePatch,
  Usage,
} from "./types";

const BASE = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");

export class ApiRequestError extends Error {
  status: number;
  error: ApiError;
  constructor(status: number, error: ApiError) {
    super(error?.message || `Request failed (${status})`);
    this.name = "ApiRequestError";
    this.status = status;
    this.error = error;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Skip attaching/refreshing the bearer token (e.g. login/register). */
  auth?: boolean;
  /** Internal: prevents infinite refresh loops. */
  _retried?: boolean;
}

async function parseError(res: Response): Promise<ApiError> {
  try {
    const data = await res.json();
    if (data?.error) return data.error as ApiError;
    return { code: "error", message: data?.message || res.statusText };
  } catch {
    return { code: "error", message: res.statusText || "Request failed" };
  }
}

let refreshInFlight: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  const refresh_token = getRefreshToken();
  if (!refresh_token) return false;

  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token }),
      });
      if (!res.ok) {
        clearTokens();
        return false;
      }
      const data = (await res.json()) as { access_token: string };
      setAccessToken(data.access_token);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

export async function apiFetch<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, auth = true, _retried = false } = opts;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth) {
    const token = getAccessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth && !_retried) {
    const ok = await tryRefresh();
    if (ok) return apiFetch<T>(path, { ...opts, _retried: true });
    clearTokens();
  }

  if (!res.ok) {
    throw new ApiRequestError(res.status, await parseError(res));
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Build a query string from defined, non-empty values. */
function qs(params: Record<string, string | number | boolean | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

const p = (id: string) => `/projects/${encodeURIComponent(id)}`;

export const api = {
  /* ─── Auth ───────────────────────────────────────────────────────────── */
  register: (email: string, password: string, account_name?: string) =>
    apiFetch<AuthResponse>("/auth/register", {
      method: "POST",
      auth: false,
      body: { email, password, account_name },
    }),

  login: (email: string, password: string) =>
    apiFetch<AuthResponse>("/auth/login", {
      method: "POST",
      auth: false,
      body: { email, password },
    }),

  logout: (refresh_token: string) =>
    apiFetch<void>("/auth/logout", {
      method: "POST",
      body: { refresh_token },
    }),

  me: () => apiFetch<MeResponse>("/auth/me"),

  /* ─── Features (exp's own switches; public, used by anonymous pages) ──── */
  features: () =>
    apiFetch<{ features: Record<string, boolean> }>("/features", { auth: false }),

  /* ─── Projects ───────────────────────────────────────────────────────── */
  listProjects: (q = "") =>
    apiFetch<{ items: Project[]; total: number }>(`/projects${qs({ q })}`),

  createProject: (input: { name: string; key?: string; description?: string }) =>
    apiFetch<Project>("/projects", { method: "POST", body: input }),

  getProject: (id: string) => apiFetch<Project>(p(id)),

  updateProject: (id: string, input: { name?: string; description?: string }) =>
    apiFetch<Project>(p(id), { method: "PATCH", body: input }),

  deleteProject: (id: string) => apiFetch<void>(p(id), { method: "DELETE" }),

  exportProject: (id: string) => apiFetch<ProjectExport>(`${p(id)}/export`),

  /* ─── Environments ───────────────────────────────────────────────────── */
  listEnvironments: (id: string) => apiFetch<Environment[]>(`${p(id)}/environments`),

  createEnvironment: (id: string, input: { key: string; name?: string }) =>
    apiFetch<Environment>(`${p(id)}/environments`, { method: "POST", body: input }),

  updateEnvironment: (id: string, envId: string, input: { name?: string }) =>
    apiFetch<Environment>(`${p(id)}/environments/${encodeURIComponent(envId)}`, {
      method: "PATCH",
      body: input,
    }),

  deleteEnvironment: (id: string, envId: string) =>
    apiFetch<void>(`${p(id)}/environments/${encodeURIComponent(envId)}`, { method: "DELETE" }),

  rotateEnvironmentKey: (id: string, envId: string) =>
    apiFetch<{ client_key: string; client_key_prefix: string }>(
      `${p(id)}/environments/${encodeURIComponent(envId)}/rotate-key`,
      { method: "POST" },
    ),

  /* ─── Flags ──────────────────────────────────────────────────────────── */
  listFlags: (
    id: string,
    opts: { q?: string; page?: number; per_page?: number; include_archived?: boolean } = {},
  ) =>
    apiFetch<Paginated<Flag>>(
      `${p(id)}/flags${qs({
        q: opts.q,
        page: opts.page ?? 1,
        per_page: opts.per_page ?? 50,
        include_archived: opts.include_archived ? "true" : undefined,
      })}`,
    ),

  createFlag: (
    id: string,
    input: {
      key: string;
      name?: string;
      description?: string;
      kind?: FlagKind;
      default_value?: FlagValue;
      tags?: string[];
      states?: Record<string, StatePatch>;
    },
  ) => apiFetch<Flag>(`${p(id)}/flags`, { method: "POST", body: input }),

  /** `flag` is the flag UUID or its key. */
  getFlag: (id: string, flag: string) =>
    apiFetch<Flag>(`${p(id)}/flags/${encodeURIComponent(flag)}`),

  updateFlag: (
    id: string,
    flag: string,
    input: {
      name?: string;
      description?: string;
      kind?: FlagKind;
      default_value?: FlagValue;
      tags?: string[];
      archived?: boolean;
    },
  ) =>
    apiFetch<Flag>(`${p(id)}/flags/${encodeURIComponent(flag)}`, {
      method: "PATCH",
      body: input,
    }),

  setFlagState: (id: string, flag: string, envKey: string, patch: StatePatch) =>
    apiFetch<Flag>(
      `${p(id)}/flags/${encodeURIComponent(flag)}/states/${encodeURIComponent(envKey)}`,
      { method: "PUT", body: patch },
    ),

  deleteFlag: (id: string, flag: string) =>
    apiFetch<void>(`${p(id)}/flags/${encodeURIComponent(flag)}`, { method: "DELETE" }),

  copyFlags: (
    id: string,
    input: {
      target_project_id: string;
      flag_keys?: string[];
      include_states?: boolean;
      on_conflict?: OnConflict;
    },
  ) => apiFetch<CopyResult>(`${p(id)}/flags/copy`, { method: "POST", body: input }),

  /** Preview of what the evaluation API would answer (not metered). */
  evaluatePreview: (id: string, environment: string, distinct_id = "") =>
    apiFetch<Evaluation>(`${p(id)}/flags/evaluate${qs({ environment, distinct_id })}`),

  /* ─── Account ────────────────────────────────────────────────────────── */
  usage: () => apiFetch<Usage>("/account/usage"),

  audit: (limit = 50, action = "") =>
    apiFetch<{ items: AuditEvent[]; limit: number }>(`/account/audit${qs({ limit, action })}`),

  /* ─── API keys ───────────────────────────────────────────────────────── */
  listApiKeys: () => apiFetch<ApiKey[]>("/apikeys"),

  apiKeyRoles: () => apiFetch<RolesResponse>("/apikeys/roles", { auth: false }),

  createApiKey: (name: string, role: ApiKeyRole = "editor") =>
    apiFetch<{ id: string; key: string; prefix: string; name: string; role: ApiKeyRole }>(
      "/apikeys",
      { method: "POST", body: { name, role } },
    ),

  deleteApiKey: (id: string) =>
    apiFetch<void>(`/apikeys/${encodeURIComponent(id)}`, { method: "DELETE" }),

  /* ─── Billing ────────────────────────────────────────────────────────── */
  billingOfferings: () => apiFetch<unknown>("/billing/offerings"),
};

/** Public base URL of the API, for docs snippets (e.g. curl examples). */
export const API_PUBLIC_BASE = BASE;
