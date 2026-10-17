# exp — API service (Flask)

JSON REST API for exp, the feature-flag service. Auth, projects, environments,
flags and their per-environment states, the SDK evaluation API, account usage,
API keys, and (optionally) RevenueCat billing. Mounted at `/api` behind Caddy.
The spec is the repo-root `CONTRACT.md`.

## Layout

```
services/api/
├── api/
│   ├── app.py              # create_app() factory + error handlers + health
│   ├── extensions.py       # Flask-Limiter (Redis-backed); per-key and per-env-key buckets
│   ├── auth_utils.py       # accounts session verify + JIT provisioning, @require_auth / @require_api_key / @require_environment_key, @require_scope
│   ├── features.py         # exp's own switches: @require_feature + GET /api/features
│   ├── serializers.py      # ORM -> JSON (CONTRACT.md shapes)
│   ├── errors.py           # ApiError -> {"error": {...}}
│   └── blueprints/         # auth, projects, environments, flags, eval, account, apikeys, billing
├── requirements.txt
└── Dockerfile
```

Shared logic (config, models, plans, RBAC, key validation, evaluation
semantics, usage, audit, PostHog) lives in the repo-root `dbcore/` package and
is imported, never re-implemented.

## Auth

- **Dashboard:** the accounts.3m4.net session (`3m4_session` cookie or the same
  EdDSA JWT as a bearer), verified locally against the accounts JWKS
  (`ACCOUNTS_INTERNAL_URL`); no passwords or refresh tokens live here.
- **Management API:** `X-API-Key: exp_live_...` (or as a bearer token); the
  key's role decides its scopes (`packages/shared/api_key_roles.json`).
- **Evaluation API:** `X-Environment-Key: exp_env_...` (or as a bearer token).
  Identifies one (project, environment); no role, evaluation routes only.

## Endpoints (all under `/api`)

- `auth`: `me` (register / login / logout happen at accounts.3m4.net)
- `projects`: list/create/get/patch/delete, `:id/export`
- `projects/:id/environments`: list/create/patch/delete, `:envId/rotate-key`
- `projects/:id/flags`: list/create/get/patch/delete, `:flag/states/:envKey`, `copy`, `evaluate` (preview)
- `eval/flags`, `eval/flags/:key` (metered, environment key)
- `account/usage`, `account/audit`
- `apikeys`: list/create/delete, `roles`, `me`
- `features`
- `billing` (only if `BILLING_ENABLED=true`): `offerings`, `webhook`
- `healthz` (also at the bare path for container health checks)

## Run

```bash
# From the repo root, via docker compose (recommended):
docker compose --env-file .env -f deploy/docker-compose.yml up -d --build postgres redis migrate api

# Locally (needs Postgres + Redis reachable, deps installed):
pip install -r services/api/requirements.txt
gunicorn -b 0.0.0.0:5000 -w 2 'api.app:create_app()'
```

Configuration is entirely env-driven (`dbcore.config`); see the repo `.env.example`.

## Limits

- Hard (402 `limit_reached`, `which`): projects, environments per project,
  flags per project (archived flags count), active API keys.
- Soft: evaluations per month. The evaluation API never blocks; the overage
  is reported by `GET /account/usage` and one PostHog event fires per period.
