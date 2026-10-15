/**
 * Minimal typed HTTP client for the exp management API.
 *
 * Deliberately dependency-free (global `fetch`) so the MCP server stays small
 * and the client can be swapped for a fake in tests.
 */
import type {
  AuditEvent,
  CopyFlagsInput,
  CopyResult,
  CreateEnvironmentInput,
  CreateFlagInput,
  CreateProjectInput,
  Environment,
  Evaluation,
  Flag,
  KeyInfo,
  Paginated,
  Project,
  ProjectExport,
  RotatedKey,
  StatePatch,
  UpdateFlagInput,
  UpdateProjectInput,
  Usage,
} from "./types.js";
import { VERSION } from "./version.js";

/** An error the API returned on purpose (`{ error: { code, message, ...extra } }`). */
export class ExpApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    /** Extra error fields, e.g. `which` on `limit_reached`, `required_scope` on `insufficient_scope`. */
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ExpApiError";
  }
}

export interface ExpClientOptions {
  /** Base URL including the `/api` prefix, e.g. `https://exp.3m4.net/api`. */
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

type Query = Record<string, string | number | boolean | undefined>;

const enc = encodeURIComponent;

export class ExpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ExpClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { query?: Query; body?: unknown } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      "X-API-Key": this.apiKey,
      Accept: "application/json",
      "User-Agent": `exp-mcp/${VERSION}`,
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    const res = await this.fetchImpl(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!res.ok) {
      const err = ((data as { error?: Record<string, unknown> } | null)?.error ?? {}) as Record<
        string,
        unknown
      >;
      const { code, message, ...extra } = err;
      throw new ExpApiError(
        res.status,
        typeof code === "string" ? code : `http_${res.status}`,
        typeof message === "string" ? message : `HTTP ${res.status}`,
        extra,
      );
    }
    return data as T;
  }

  /** Identity + scopes of the calling key. */
  me(): Promise<KeyInfo> {
    return this.request("GET", "/apikeys/me");
  }

  // --- Projects ---------------------------------------------------------- //

  listProjects(params: { q?: string } = {}): Promise<{ items: Project[]; total: number }> {
    return this.request("GET", "/projects", { query: params });
  }

  createProject(input: CreateProjectInput): Promise<Project> {
    return this.request("POST", "/projects", { body: input });
  }

  getProject(id: string): Promise<Project> {
    return this.request("GET", `/projects/${enc(id)}`);
  }

  updateProject(id: string, patch: UpdateProjectInput): Promise<Project> {
    return this.request("PATCH", `/projects/${enc(id)}`, { body: patch });
  }

  deleteProject(id: string): Promise<void> {
    return this.request("DELETE", `/projects/${enc(id)}`);
  }

  exportProject(id: string): Promise<ProjectExport> {
    return this.request("GET", `/projects/${enc(id)}/export`);
  }

  // --- Environments ------------------------------------------------------ //

  listEnvironments(projectId: string): Promise<Environment[]> {
    return this.request("GET", `/projects/${enc(projectId)}/environments`);
  }

  createEnvironment(projectId: string, input: CreateEnvironmentInput): Promise<Environment> {
    return this.request("POST", `/projects/${enc(projectId)}/environments`, { body: input });
  }

  rotateEnvironmentKey(projectId: string, envId: string): Promise<RotatedKey> {
    return this.request("POST", `/projects/${enc(projectId)}/environments/${enc(envId)}/rotate-key`);
  }

  // --- Flags ------------------------------------------------------------- //

  listFlags(
    projectId: string,
    params: { q?: string; page?: number; per_page?: number; include_archived?: boolean } = {},
  ): Promise<Paginated<Flag>> {
    return this.request("GET", `/projects/${enc(projectId)}/flags`, { query: params });
  }

  createFlag(projectId: string, input: CreateFlagInput): Promise<Flag> {
    return this.request("POST", `/projects/${enc(projectId)}/flags`, { body: input });
  }

  /** `flag` is the flag UUID or its key. */
  getFlag(projectId: string, flag: string): Promise<Flag> {
    return this.request("GET", `/projects/${enc(projectId)}/flags/${enc(flag)}`);
  }

  updateFlag(projectId: string, flag: string, patch: UpdateFlagInput): Promise<Flag> {
    return this.request("PATCH", `/projects/${enc(projectId)}/flags/${enc(flag)}`, { body: patch });
  }

  setFlagState(projectId: string, flag: string, envKey: string, patch: StatePatch): Promise<Flag> {
    return this.request("PUT", `/projects/${enc(projectId)}/flags/${enc(flag)}/states/${enc(envKey)}`, {
      body: patch,
    });
  }

  deleteFlag(projectId: string, flag: string): Promise<void> {
    return this.request("DELETE", `/projects/${enc(projectId)}/flags/${enc(flag)}`);
  }

  copyFlags(projectId: string, input: CopyFlagsInput): Promise<CopyResult> {
    return this.request("POST", `/projects/${enc(projectId)}/flags/copy`, { body: input });
  }

  /** Unmetered preview of what the evaluation API would answer. */
  evaluateFlags(projectId: string, environment: string, distinctId?: string): Promise<Evaluation> {
    return this.request("GET", `/projects/${enc(projectId)}/flags/evaluate`, {
      query: { environment, distinct_id: distinctId },
    });
  }

  // --- Account ----------------------------------------------------------- //

  usage(): Promise<Usage> {
    return this.request("GET", "/account/usage");
  }

  auditLog(params: { limit?: number; action?: string } = {}): Promise<{ items: AuditEvent[] }> {
    return this.request("GET", "/account/audit", { query: params });
  }
}
