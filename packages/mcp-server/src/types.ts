/** Wire types of the exp REST API (see CONTRACT.md at the repo root). */

export type Role = "viewer" | "editor" | "admin";

export type Scope =
  | "projects:read"
  | "projects:write"
  | "projects:delete"
  | "flags:read"
  | "flags:write"
  | "flags:delete"
  | "usage:read"
  | "audit:read";

export type FlagKind = "boolean" | "string" | "number" | "json";

export interface Environment {
  id: string;
  key: string;
  name: string;
  client_key_prefix: string;
  /** Only present on create / rotate. */
  client_key?: string;
  position: number;
  created_at: string;
}

export interface Project {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  flag_count: number;
  /** Present on GET /projects/:id, POST /projects and in the list. */
  environments?: Environment[];
  created_at: string;
  updated_at: string;
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
  created_at: string;
  updated_at: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  per_page: number;
  total: number;
}

export interface KeyInfo {
  account: { id: string; name: string; plan: string; created_at?: string };
  key: { id: string; prefix: string; role: Role };
  scopes: Scope[];
}

export interface Usage {
  period_start: string;
  period_end: string;
  evaluations: number;
  counts: { projects: number; api_keys: number };
  limits: Record<string, unknown>;
}

export interface AuditEvent {
  id: string;
  ts: string;
  actor_type: string;
  actor_id: string | null;
  actor_label: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  outcome: string;
  meta: Record<string, unknown>;
}

export interface EvaluatedFlag {
  kind: FlagKind;
  enabled: boolean;
  value: unknown;
}

export interface Evaluation {
  project: { id: string; key: string };
  environment: { id: string; key: string };
  distinct_id?: string | null;
  evaluated_at: string;
  flags: Record<string, EvaluatedFlag>;
}

export interface CopyResult {
  target_project_id: string;
  copied: string[];
  overwritten: string[];
  skipped: string[];
}

export interface ProjectExport {
  format: string;
  exported_at: string;
  project: { key: string; name: string; description?: string | null };
  environments: { key: string; name: string; position: number }[];
  flags: {
    key: string;
    name: string | null;
    description?: string | null;
    kind: FlagKind;
    default_value: unknown;
    tags: string[];
    archived: boolean;
    states: Record<string, { enabled: boolean; value: unknown; rollout_percent: number }>;
  }[];
}

export interface RotatedKey {
  client_key: string;
  client_key_prefix: string;
}

export interface StatePatch {
  enabled?: boolean;
  value?: unknown;
  rollout_percent?: number;
}

export interface CreateProjectInput {
  name: string;
  key?: string;
  description?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
}

export interface CreateEnvironmentInput {
  key: string;
  name?: string;
}

export interface CreateFlagInput {
  key: string;
  name?: string;
  description?: string;
  kind?: FlagKind;
  default_value?: unknown;
  tags?: string[];
  states?: Record<string, StatePatch>;
}

export interface UpdateFlagInput {
  name?: string;
  description?: string;
  kind?: FlagKind;
  default_value?: unknown;
  tags?: string[];
  archived?: boolean;
}

export interface CopyFlagsInput {
  target_project_id: string;
  flag_keys?: string[];
  include_states?: boolean;
  on_conflict?: "skip" | "overwrite";
}
