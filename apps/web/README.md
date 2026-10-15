# exp — Web (Qwik City)

The marketing site **and** dashboard for [exp](https://exp.3m4.net), an
open-source feature-flag service for projects, people and AI agents. One Qwik
City app, SSR'd by a standalone Node-compatible HTTP server on **port 3000**
(run with Bun). Same chrome, toolchain and code style as the sibling
[3m4](https://github.com/Devace-93/3m4) app; brand colour is Tailwind violet.

- Marketing: `/`, `/info` (+ `/info/pricing`, `/info/docs`), `/blog/*`, `/sponsors`.
- Auth: `/login`, `/signup` (hidden while the `signups` feature is off).
- Dashboard: `/dashboard` (projects), `/dashboard/projects/[id]` (flags table,
  per-environment toggles, copy flags), `/dashboard/projects/[id]/flags/[flag]`
  (flag editor + preview evaluation), `/dashboard/projects/[id]/settings`
  (environments, client keys, export, delete), `/dashboard/settings` (API keys,
  audit log), `/dashboard/billing` (hidden in early access).

Vocabulary: **flags** are the product (what users create); **features** are
exp's own switches from `packages/shared/feature_flags.json`.

Toolchain: **Bun** (do not use npm/pnpm). Stack: Qwik + Qwik City + Vite +
TypeScript + Tailwind CSS, with the official `@builder.io/qwik-city/adapters/node-server`.

## Develop

```bash
cd apps/web
bun install
bun run dev          # Vite dev server (SSR), http://localhost:5173
```

## Build & serve (production)

```bash
bun install
bun run build        # check:i18n + types + client + SSR server → dist/ + server/entry.node-server.js
bun run serve        # starts the SSR server on 0.0.0.0:3000
```

`bun run check:i18n` verifies that every base-language catalog has every
English key (same placeholders, nothing extra) and that every locale in
`src/i18n/langs.ts` has a base catalog.

## Environment (build-time `VITE_*`)

| Var | Default | Purpose |
|-----|---------|---------|
| `VITE_API_URL` | `/api` | Backend base URL (Caddy proxies `/api`). |
| `VITE_APP_URL` | `https://exp.3m4.net` | Public origin; used in docs/curl/MCP snippets. |
| `VITE_POSTHOG_KEY` | – | PostHog project key. Unset → analytics no-ops. |
| `VITE_POSTHOG_HOST` | `https://us.i.posthog.com` | PostHog host. |
| `VITE_REVENUECAT_PUBLIC_KEY` | – | RevenueCat Web SDK key. |
| `VITE_BILLING_ENABLED` | `true` | Set `false` for self-host → hides purchase UI. |
| `VITE_INFO_URL` | `https://info.3m4.net` | Apps index linked from the footer. |

Runtime (SSR only): `API_INTERNAL_URL` (compose: `http://api:5000/api`) is
where the server resolves `GET /api/features` for the first paint; when the
API is unreachable the registry defaults are used, so SSR never fails.

> `VITE_*` vars are inlined at **build time**. For hosted builds, pass them as
> Docker build args (see `Dockerfile`).

## Docker

Build context is the **repo root** (the app imports `packages/shared/*.json`):

```bash
# from repo root
docker build -f apps/web/Dockerfile -t exp-web .
docker run -p 3000:3000 exp-web
```

Or via `deploy/docker-compose.yml` (the `web` service).

## Layout

```
src/
  root.tsx                 app root (<head>/<body>)
  entry.ssr.tsx            SSR render entry
  entry.node-server.tsx    standalone HTTP server (prod)
  entry.dev.tsx            CSR dev entry
  global.css               Tailwind + violet theme (CSS variables, light/dark)
  lib/
    api.ts                 typed client for every CONTRACT.md endpoint (bearer + 401 refresh)
    auth.ts                token storage (exp_access_token / exp_refresh_token)
    features.ts            exp's own switches: FeaturesContext, FEATURE_DEFAULTS
    features.server.ts     SSR resolution of GET /api/features (with fallback)
    errors.ts              error → message, 402 limit_reached per error.which
    flag-values.ts         kind-aware value parsing/formatting, slug, JSON download
    analytics.ts           PostHog wrapper (no-op when unset)
    plans.ts               reads packages/shared/plan_limits.json
    types.ts               API types (mirror of CONTRACT.md)
  i18n/
    index.ts               tr(i18n, key) runtime; langs.ts: 34 locales (3m4.lang)
    catalog/en/*.ts        English source of truth (chrome, marketing, app)
    catalog/<lang>.ts      base catalogs + <lang>-<COUNTRY>.ts overrides
  components/              nav, footer, pricing table, switch, modal, …
  content/posts.ts         blog posts (plain data)
  routes/
    (marketing)/           public pages
    (auth)/                login / signup
    (dashboard)/           authed area (client-side route guard)
public/                    favicon.svg/.ico, PNG icons, og-image.png (rendered from
                           an HTML template with Playwright), manifest, robots
```

## Notes

- **Auth guard**: tokens live only in the browser, so `/dashboard/*` is guarded
  client-side in `routes/(dashboard)/layout.tsx` (redirects to `/login`).
- **i18n**: `tr(i18n, key)` is a module function on purpose — never return a
  function from a `use*` hook in Qwik (breaks SSR with Code(3)).
- **Limits**: a 402 `limit_reached` is rendered per `error.which`
  (`projects | environments | flags | api_keys`) with an upgrade link when
  billing is on and early access is off.
- **Billing**: `dashboard/billing` launches RevenueCat Web checkout
  (`app_user_id = account id`, entitlements `pro`/`team`).
- Open source · MIT.
