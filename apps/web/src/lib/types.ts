/** Shared API shapes (mirror of CONTRACT.md). */

export interface User {
  id: string;
  email: string;
  created_at?: string;
}

export type PlanKey = "free" | "pro" | "team" | "enterprise" | "selfhost";

export interface Account {
  id: string;
  name: string;
  plan: PlanKey;
  created_at?: string;
}

/** One entry of packages/shared/plan_limits.json; -1 means unlimited. */
export interface Limits {
  projects: number;
  environments_per_project: number;
  flags_per_project: number;
  evaluations_per_month: number;
  api_keys: number;
  audit_retention_days: number;
  max_users: number;
  api?: string;
}

export interface Usage {
  period_start?: string;
  period_end?: string;
  evaluations: number;
  counts: { projects: number; api_keys: number };
  limits?: Limits;
}

export interface AuthResponse {
  user: User;
  account: Account;
  access_token: string;
  refresh_token: string;
}

export interface MeResponse {
  user: User;
  account: Account;
  plan?: string;
  limits: Limits;
  usage: Usage;
  counts: { projects: number };
  /** exp's own feature switches, resolved for this account. */
  features?: Record<string, boolean>;
}

export interface Environment {
  id: string;
  key: string;
  name: string;
  client_key_prefix: string;
  /** Full secret; present ONLY on create / rotate. */
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
  environments?: Environment[];
  created_at: string;
  updated_at: string;
}

export type FlagKind = "boolean" | "string" | "number" | "json";

/** `value` type depends on the flag kind; JSON flags can hold anything. */
export type FlagValue = boolean | string | number | Record<string, unknown> | unknown[] | null;

export interface FlagState {
  enabled: boolean;
  value: FlagValue;
  rollout_percent: number;
  updated_at?: string;
}

export interface StatePatch {
  enabled?: boolean;
  value?: FlagValue;
  rollout_percent?: number;
}

export interface Flag {
  id: string;
  project_id: string;
  key: string;
  name?: string | null;
  description?: string | null;
  kind: FlagKind;
  default_value: FlagValue;
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

export interface EvaluatedFlag {
  key?: string;
  kind: FlagKind;
  enabled: boolean;
  value: FlagValue;
}

export interface Evaluation {
  project: { id: string; key: string };
  environment: { id: string; key: string };
  distinct_id?: string | null;
  evaluated_at: string;
  flags: Record<string, EvaluatedFlag>;
}

export type OnConflict = "skip" | "overwrite";

export interface CopyResult {
  target_project_id: string;
  copied: string[];
  overwritten: string[];
  skipped: string[];
}

export interface ProjectExport {
  format: "exp.project.v1";
  exported_at: string;
  project: { key: string; name: string; description?: string | null };
  environments: { key: string; name: string; position: number }[];
  flags: {
    key: string;
    name?: string | null;
    description?: string | null;
    kind: FlagKind;
    default_value: FlagValue;
    tags: string[];
    archived: boolean;
    states: Record<string, { enabled: boolean; value: FlagValue; rollout_percent: number }>;
  }[];
}

export type ApiKeyRole = "viewer" | "editor" | "admin";

export interface ApiKey {
  id: string;
  name?: string;
  prefix: string;
  role: ApiKeyRole;
  last_used_at?: string | null;
  created_at: string;
}

export interface RoleInfo {
  label: string;
  description: string;
  scopes: string[];
}

export interface RolesResponse {
  default_role: ApiKeyRole;
  roles: Record<ApiKeyRole, RoleInfo>;
}

export type AuditOutcome = "ok" | "denied" | "error";

export interface AuditEvent {
  id: string;
  ts: string;
  actor_type: "user" | "api_key" | "system";
  actor_id?: string | null;
  actor_label?: string | null;
  action: string;
  target_type?: string | null;
  target_id?: string | null;
  outcome: AuditOutcome;
  meta?: Record<string, unknown>;
}

/** `which` is set on 402 limit_reached: projects | environments | flags | api_keys. */
export interface ApiError {
  code: string;
  message: string;
  which?: string;
  required_scope?: string;
  role?: string;
}
