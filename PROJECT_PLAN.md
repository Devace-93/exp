# exp — Feature flags — Project Plan

> Status: Phase 1 (MVP) in progress. Last updated: 2026-10-15.

Owner: Enrique Magallon Alvarez. License: **MIT** (open-source core, self-hostable).

## 1. Locked decisions

| Topic | Decision |
|---|---|
| Stack | Same as 3m4: Flask API + PostgreSQL + Redis, Qwik City frontend (Bun), MCP server (TS), Caddy, Docker |
| Domain | `exp.3m4.net`, single host: web + `/api` + `/mcp` |
| Brand | Tailwind **violet** (3m4 is blue) |
| Auth | Identity at accounts.3m4.net (shared session cookie verified via JWKS, see CONTRACT.md); API keys `exp_live_…` with roles; environment client keys `exp_env_…` for evaluation only |
| Tenancy | Account is the billing unit; users join via memberships |
| Model | account → projects → environments + flags → one state per (flag, environment) |
| Flag kinds | boolean, string, number, json; per-environment enabled / value / rollout percentage |
| Rollout | Deterministic bucket: sha256(`flag_key:distinct_id`) mod 100 |
| Limits | Hard: projects, environments/project, flags/project, API keys (402). Soft: evaluations/month (never block SDKs) |
| Early access | Feature `early-access` ON ⇒ enterprise limits for everyone, billing hidden |
| Own feature switches | Called **features**; PostHog keys prefixed `exp-` (one PostHog project shared with 3m4) |
| i18n / theme | Same 34 locales and `3m4.lang` / `3m4.theme` storage keys as the other apps |
| Production | Second compose project on the 3m4 Hetzner box; routed by the 3m4 edge Caddy over the `edge` network |

## 2. Phases

- **Phase 1 — MVP (now):** auth, projects, environments, flags, states, copy,
  export, evaluation API, API keys + RBAC + audit, MCP server, dashboard,
  marketing pages, i18n, theme, e2e suite, deploy.
- **Phase 2:** import (`exp.project.v1`), targeting rules (attribute matching),
  flag change history and scheduled changes, SDK snippets (JS/Python helpers),
  evaluation cache in Redis, webhooks on state change.
- **Phase 3:** billing on (RevenueCat), team members and invitations, dogfooding
  (exp resolves its own features from an exp project instead of PostHog).

## 3. Open questions

- npm publish of `exp-mcp` (name is free as of 2026-10-15).
- Whether `info.3m4.net` lists exp as `building` or `live` at first deploy.
