/**
 * API client for the exp Flask backend.
 *
 * - Base URL from VITE_API_URL (fallback "/api" — works behind Caddy).
 * - Credentials included: the accounts `3m4_session` cookie IS the login
 *   (no bearer tokens in the browser).
 * - On `401 session_expired` it refreshes once against accounts and retries;
 *   on `401 no_session` / `invalid_session` it sends the visitor to the hosted
 *   login page and rejects.
 *
 * Throws `ApiRequestError` (carrying the parsed `error` body + HTTP status) so
 * callers can branch on e.g. 402 limit_reached (`error.which`) or 403
 * email_unverified.
 */
import { loginUrl, session } from "./auth";
import type {
  ApiError,
  ApiKey,
  ApiKeyRole,
  AuditEvent,
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
  get isUnverified(): boolean {
    return this.status === 403 && this.error?.code === "email_unverified";
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Public endpoint: a missing session must not trigger the login redirect. */
  auth?: boolean;
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

export async function apiFetch<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const { method = "GET", body, auth = true } = opts;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";

  // fetchWithSession: credentials included + one transparent refresh on
  // `401 session_expired`.
  const res = await session.fetchWithSession(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const error = await parseError(res);
    if (res.status === 401 && auth && typeof location !== "undefined") {
      // No usable session (none, invalid, or the refresh failed): go log in.
      session.invalidate();
      location.assign(loginUrl());
    }
    throw new ApiRequestError(res.status, error);
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
  /* ─── Auth (identity lives at accounts.3m4.net; this is the tenant view) ── */
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
