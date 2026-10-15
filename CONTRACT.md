# exp — Interface Contract

This file is the shared contract between the backend (Flask), the Qwik frontend
and the MCP server. All of them build against it. Keep it in sync.

exp is a feature-flag service: an **account** registers **projects**, each
project has **environments** (production / staging / development by default)
and **flags**; every flag has one **state** per environment (enabled, value,
rollout percentage). Apps read their flags through the **evaluation API** with
an environment client key; people and AI agents manage everything through the
**management API** (dashboard sessions, role-scoped API keys, MCP server).

Vocabulary, to avoid confusion:

- **flags** = the product (rows in the `flags` table, what users create).
- **features** = exp's *own* switches (`packages/shared/feature_flags.json`,
  resolved from PostHog, exposed as `GET /api/features` and `me.features`).

## Ports (container)

| Service  | Port | Notes |
|----------|------|-------|
| api      | 5000 | Flask JSON API, mounted at `/api` by Caddy |
| web      | 3000 | Qwik City (Bun) SSR server, marketing + dashboard |
| mcp      | 3333 | Streamable HTTP MCP server, mounted at `/mcp` by Caddy |
| postgres | 5432 | |
| redis    | 6379 | db0 rate-limit storage + cache |
| caddy    | 8081 | dev entrypoint (prod: routed by the 3m4 edge Caddy, see deploy/PRODUCTION.md) |

Local dev lives on `http://localhost:8081` (the 3m4 stack already uses 8080).
Frontend tooling is **Bun**. Compose project name is `exp`.

## Auth

- Dashboard: JWT bearer, `Authorization: Bearer <access_token>`. Access TTL
  ~30 min; refresh token (opaque, stored hashed) ~30 days.
- Management API: API keys, header `X-API-Key: exp_live_…` (maps to an account).
  The MCP server also accepts the key as `Authorization: Bearer exp_live_…`.
- Evaluation API: environment client keys, header `X-Environment-Key: exp_env_…`
  (or `Authorization: Bearer exp_env_…`). A client key identifies exactly one
  (project, environment); it has no role and cannot call the management API.

Keys are stored as sha256 hashes plus a non-sensitive prefix (`exp_live_AbCd`,
`exp_env_AbCd`); the full secret is returned exactly once (creation / rotation).

### Authorization (RBAC)

- Every API key has a **role** (`viewer` | `editor` | `admin`). Roles → scopes
  live in `packages/shared/api_key_roles.json` (shared by API, dashboard, MCP).
- Scopes: `projects:read`, `projects:write`, `projects:delete`, `flags:read`,
  `flags:write`, `flags:delete`, `usage:read`, `audit:read`. Dashboard JWT
  sessions hold every scope.
- Each endpoint names its scope. Missing scope → **403**
  `{ "error": { "code": "insufficient_scope", "message", "required_scope", "role" } }`
  plus an `auth.denied` audit event.
- Audit: every mutation and every denial is appended to `audit_events` in the
  same transaction. Actions: `project.create|update|delete`,
  `environment.create|update|delete|rotate_key`, `flag.create|update|delete|copy`,
  `flag_state.update`, `apikey.create|revoke`, `auth.denied`.

## Limits and metering

Plan limits come from `packages/shared/plan_limits.json`. While the
`early-access` feature is ON every account gets the `enterprise` limits.

- **Hard limits** (creation blocked with **402** `limit_reached`, `error.which`
  = `projects` | `environments` | `flags` | `api_keys`): project count per
  account, environments per project, flags per project (archived flags count),
  active API keys.
- **Soft limit**: `evaluations_per_month`. Each evaluation request counts +1 on
  the account's calendar-month counter. Past the limit the API keeps answering
  (never break a running app); the dashboard shows the overage and one PostHog
  `limit_reached {which: "evaluations"}` event fires per period.

## REST API (all under `/api`)

Responses are JSON. Errors: `{ "error": { "code": "string", "message": "string" } }`.
Rate limits: default `RATE_LIMIT_DEFAULT` per IP; management routes called with
an API key add `RATE_LIMIT_PUBLIC_API` per key; evaluation routes add
`RATE_LIMIT_EVAL` per environment key.

### Auth

- `POST /auth/register` `{email, password, account_name?}` → `{user, account, access_token, refresh_token}` (201). Gated by feature `signups`.
- `POST /auth/login` `{email, password}` → `{user, account, access_token, refresh_token}`
- `POST /auth/refresh` `{refresh_token}` → `{access_token}`
- `POST /auth/logout` `{refresh_token}` → 204
- `GET  /auth/me` → `{user, account, plan, limits, usage, counts:{projects}, features}`

### Projects

- `GET    /projects?q=` → `{items:[Project], total}` — `projects:read`. Newest first.
- `POST   /projects` `{name, key?, description?}` → Project (201) — `projects:write`.
  `key` defaults to a slug of `name`; must match `^[a-z0-9][a-z0-9-]{0,62}$` and
  be unique per account (409 `key_taken`). Seeds three environments
  (`production`, `staging`, `development`) and returns them with their one-time
  `client_key`. 402 `limit_reached` (`which: "projects"`).
- `GET    /projects/:id` → Project — `projects:read`
- `PATCH  /projects/:id` `{name?, description?}` → Project — `projects:write`
- `DELETE /projects/:id` → 204 — `projects:delete` (cascades environments, flags, states)
- `GET    /projects/:id/export` → ProjectExport — `flags:read`

`:id` is the project UUID. Every project endpoint is scoped to `g.account_id`;
a project of another account is a 404, never a 403.

### Environments

- `GET    /projects/:id/environments` → `[Environment]` — `projects:read`
- `POST   /projects/:id/environments` `{key, name?}` → Environment with one-time `client_key` (201) — `projects:write`. 402 (`which: "environments"`), 409 `key_taken`.
- `PATCH  /projects/:id/environments/:envId` `{name?}` → Environment — `projects:write`
- `DELETE /projects/:id/environments/:envId` → 204 — `projects:delete`. The last environment cannot be deleted (400 `last_environment`).
- `POST   /projects/:id/environments/:envId/rotate-key` → `{client_key, client_key_prefix}` — `projects:write`. The old key stops working immediately.

### Flags

- `GET    /projects/:id/flags?q=&page=1&per_page=50&include_archived=false` → `{items:[Flag], page, per_page, total}` — `flags:read`. Ordered by key.
- `POST   /projects/:id/flags` `{key, name?, description?, kind?, default_value?, tags?, states?}` → Flag (201) — `flags:write`.
  `key` must match `^[a-z0-9][a-z0-9_-]{0,98}$`, unique per project (409 `key_taken`). The keys `copy` and `evaluate` are reserved because they would shadow the `/flags/copy` and `/flags/evaluate` routes (400 `reserved_key`).
  `kind` ∈ `boolean` (default) | `string` | `number` | `json`. `default_value`
  must match the kind (400 `invalid_value`); for `boolean` it is ignored and
  stored as `true`. `states` is an optional `{env_key: StatePatch}` applied on
  top of the default state (`enabled:false, value:null, rollout_percent:100`)
  which every environment gets. 402 (`which: "flags"`).
- `GET    /projects/:id/flags/:flag` → Flag — `flags:read`. `:flag` is the flag UUID **or** its key.
- `PATCH  /projects/:id/flags/:flag` `{name?, description?, kind?, default_value?, tags?, archived?}` → Flag — `flags:write`. Changing `kind` resets every state `value` to `null`.
- `PUT    /projects/:id/flags/:flag/states/:envKey` `{enabled?, value?, rollout_percent?}` → Flag — `flags:write`. `value` must match the flag kind or be `null`; `rollout_percent` is an integer 0–100. Audit `flag_state.update` with `meta.environment`, `meta.fields`.
- `DELETE /projects/:id/flags/:flag` → 204 — `flags:delete`
- `POST   /projects/:id/flags/copy` `{target_project_id, flag_keys?, include_states?, on_conflict?}` → CopyResult — `flags:write`, feature `flag-copy`.
  Copies flag definitions from project `:id` into `target_project_id` (same
  account; otherwise 404). `flag_keys` defaults to every non-archived flag.
  `include_states` (default `true`) copies each state onto the target
  environment with the **same key**; environments missing on the target get
  the default state. `on_conflict` ∈ `skip` (default) | `overwrite`. The whole
  copy is one transaction: if the target would exceed `flags_per_project` the
  request fails with 402 (`which: "flags"`) and nothing is copied.
  Audit one `flag.copy` event with `meta.source_project_id`, `meta.copied`,
  `meta.overwritten`, `meta.skipped`.
- `GET    /projects/:id/flags/evaluate?environment=<envKey>&distinct_id=` → Evaluation — `flags:read`. A **preview** of what the evaluation API would answer. Not metered, not rate-limited as eval.

### Evaluation (SDKs; environment client key)

Feature `evaluation-api` OFF → 503 `feature_disabled`.

- `GET /eval/flags?distinct_id=` → Evaluation. Metered (+1 evaluation).
- `GET /eval/flags/:key?distinct_id=` → EvaluatedFlag (404 `not_found` for unknown or archived keys). Metered (+1 evaluation).

Semantics for one flag in one environment (see `dbcore/evaluate.py`):

1. State `enabled == false` → off.
2. `rollout_percent < 100`: bucket = first 8 hex chars of `sha256("<flag_key>:<distinct_id>")` as an integer, modulo 100. In when `bucket < rollout_percent`. Without `distinct_id` the request is **out** unless `rollout_percent == 100`.
3. On → `boolean`: `value = true`; other kinds: `value = state.value ?? flag.default_value`.
4. Off → `boolean`: `value = false`; other kinds: `value = null`.

Archived flags are never returned by the evaluation API.

### Account / keys

- `GET /account/usage` → Usage — JWT or key, `usage:read`
- `GET /account/audit?limit=50&action=` → `{items:[AuditEvent], limit}` newest first — JWT or key, `audit:read`
- `GET /apikeys` → `[{id, name, prefix, role, last_used_at, created_at}]` (JWT)
- `GET /apikeys/roles` → `{default_role, roles:{viewer|editor|admin: {label, description, scopes}}}` (public)
- `POST /apikeys` `{name, role?}` → `{id, key, prefix, name, role}` (201; full key shown once; 400 `invalid_role`; 402 `which: "api_keys"`) (JWT)
- `GET /apikeys/me` → `{account, key:{id, prefix, role}, scopes:[...]}` (API key only; what the MCP server calls at startup)
- `DELETE /apikeys/:id` → 204 (JWT)

### Features (exp's own switches)

- `GET /features` → `{features:{<key>: bool}}`. Public; an optional bearer token upgrades resolution to the account's targeting bucket.

### MCP (AI agents)

- Streamable HTTP endpoint `POST /mcp` (Caddy → `mcp:3333`), auth `Authorization: Bearer exp_live_…` (or `X-API-Key`). Stateless; one server per request bound to the caller's key.
- stdio flavour published to npm as `exp-mcp`. Tools/roles table in `packages/mcp-server/README.md`.
- Tools (scope in parentheses): `list_projects` `get_project` (projects:read) ·
  `create_project` `update_project` `create_environment` (projects:write) ·
  `rotate_environment_key` (projects:write, needs confirmation) ·
  `delete_project` (projects:delete, needs confirmation) ·
  `list_flags` `get_flag` `export_project` `evaluate_flags` (flags:read) ·
  `create_flag` `update_flag` `set_flag_state` `copy_flags` (flags:write) ·
  `delete_flag` (flags:delete, needs confirmation) ·
  `get_usage` (usage:read) · `get_audit_log` (audit:read).
- Destructive tools ask the user through MCP elicitation when the client
  supports it, otherwise refuse until called with `confirm: true`.

### Billing (only when BILLING_ENABLED=true)

- `GET  /billing/offerings` → offerings/packages for the paywall
- `POST /billing/webhook` ← RevenueCat (server-to-server; verifies `Authorization` header)

### Health

- `GET /healthz` → `{status:"ok"}` (also `/api/healthz` behind Caddy)

## Objects

### Project
```json
{
  "id": "uuid",
  "key": "web-app",
  "name": "Web app",
  "description": "optional",
  "flag_count": 12,
  "environments": [Environment],
  "created_at": "2026-10-15T10:00:00Z",
  "updated_at": "2026-10-15T10:00:00Z"
}
```
`environments` is present on `GET /projects/:id`, `POST /projects` and in the
list (so the dashboard can render toggles without a second request).

### Environment
```json
{
  "id": "uuid",
  "key": "production",
  "name": "Production",
  "client_key_prefix": "exp_env_AbCd",
  "client_key": "exp_env_…   (ONLY on create / rotate)",
  "position": 0,
  "created_at": "…"
}
```

### Flag
```json
{
  "id": "uuid",
  "project_id": "uuid",
  "key": "new-checkout",
  "name": "New checkout",
  "description": "optional",
  "kind": "boolean",
  "default_value": true,
  "tags": ["checkout"],
  "archived": false,
  "states": {
    "production":  { "enabled": false, "value": null, "rollout_percent": 100, "updated_at": "…" },
    "staging":     { "enabled": true,  "value": null, "rollout_percent": 50,  "updated_at": "…" }
  },
  "created_at": "…",
  "updated_at": "…"
}
```

### Evaluation / EvaluatedFlag
```json
{
  "project": { "id": "uuid", "key": "web-app" },
  "environment": { "id": "uuid", "key": "production" },
  "distinct_id": "user-42",
  "evaluated_at": "…",
  "flags": {
    "new-checkout": { "kind": "boolean", "enabled": true,  "value": true },
    "banner-text":  { "kind": "string",  "enabled": false, "value": null }
  }
}
```
`GET /eval/flags/:key` returns one entry: `{ "key", "kind", "enabled", "value" }`.

### CopyResult
```json
{ "target_project_id": "uuid", "copied": ["a"], "overwritten": ["b"], "skipped": ["c"] }
```

### ProjectExport
```json
{
  "format": "exp.project.v1",
  "exported_at": "…",
  "project": { "key", "name", "description" },
  "environments": [ { "key", "name", "position" } ],
  "flags": [ { "key", "name", "description", "kind", "default_value", "tags", "archived", "states": { "<env_key>": { "enabled", "value", "rollout_percent" } } } ]
}
```

### Usage
```json
{
  "period_start": "2026-10-01",
  "period_end": "2026-11-01",
  "evaluations": 1234,
  "counts": { "projects": 2, "api_keys": 1 },
  "limits": { "...plan_limits.json entry..." }
}
```

### AuditEvent
```json
{ "id", "ts", "actor_type": "user|api_key|system", "actor_id", "actor_label", "action", "target_type", "target_id", "outcome": "ok|denied|error", "meta": {} }
```

## Frontend contract

- Same chrome as the other 3m4 apps: footer (author → Source → info.3m4.net,
  then pricing/blog/sponsors), language picker (34 locales, `3m4.lang`),
  theme toggle (`3m4.theme`). Tokens in localStorage `exp_access_token` /
  `exp_refresh_token`.
- Routes: `/` landing · `/info` + `/info/pricing` + `/info/docs` · `/blog` ·
  `/sponsors` · `/login` · `/signup` · `/dashboard` (projects) ·
  `/dashboard/projects/[id]` (flags table, per-environment toggles, copy) ·
  `/dashboard/projects/[id]/flags/[flag]` (flag editor) ·
  `/dashboard/projects/[id]/settings` (environments, client keys, export, delete) ·
  `/dashboard/settings` (API keys, audit) · `/dashboard/billing` (hidden in early access).
- Brand colour: Tailwind **violet** scale as `primary` (3m4 is blue, bubbles is
  orange; exp is violet).
