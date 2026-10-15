# exp end-to-end tests

Playwright suite that exercises the whole stack through Caddy: web app (Qwik),
REST API (Flask), evaluation API and the remote MCP endpoint. It runs against
an **already-running** stack; it does not start one.

## Run locally

```bash
make up                      # from the repo root, once
cd e2e
bun install
bunx playwright install chromium     # add --with-deps on a fresh machine
bun run test                 # whole suite, headless
bun run test:critical        # only tests tagged @critical
bun run test:ui              # Playwright UI mode
bun run report               # open the last HTML report
```

| Variable       | Default                 | Meaning |
|----------------|-------------------------|---------|
| `E2E_BASE_URL` | `http://localhost:8081` | Caddy entrypoint. API at `/api`, MCP at `/mcp`. |

The suite expects the local feature set (`GET /api/features`): `early-access=on`,
`signups=on`, `public-api=on`, `evaluation-api=on`, `flag-copy=on`.

Every spec file registers its own account (`e2e+<ts>@example.com`) through
`POST /api/auth/register`, so runs are independent of existing data and of each
other. Dashboard tests seed the browser session with API tokens
(`localStorage` keys `exp_access_token` / `exp_refresh_token`); the auth spec
goes through the real sign-up / login / logout UI. Tests within a file run
sequentially and share that account; fixtures each test needs are created in
`beforeAll` or at the top of the test, so a failure does not cascade.

## What is covered

| File | Covers |
|------|--------|
| `tests/auth.spec.ts` | `@critical` sign-up via UI → `/dashboard`; marketing nav shows Dashboard (`data-auth-state`); `/login` bounces a signed-in user; log out from the dashboard nav; dashboard guard; log in again. Wrong password error. `@critical` `POST /auth/refresh`, `POST /auth/logout` revokes the refresh token. The app transparently refreshes an expired access token. |
| `tests/projects.spec.ts` | `@critical` create project in the dialog (name → key slug), keys step (`data-testid="project-keys-step"`, 3 environments with one-time `exp_env_` keys), "Go to project". Project card + `GET /projects`, 409 `key_taken`. `@critical` settings: create environment (key revealed once), rotate key (new key revealed, old key → 401), export downloads `exp.project.v1` JSON. `last_environment` 400. `@critical` delete project from the danger zone (cascade kills client keys). |
| `tests/flags.spec.ts` | `@critical` flags of each kind with default states (API); validation: `reserved_key` for `copy`/`evaluate`, `invalid_value`, `key_taken`, bad rollout. `@critical` create flag in the dialog (reserved key rejected client-side). `@critical` per-environment switch in the table → `PUT …/states/:env` + `flag_state.update` audit. `@critical` flag editor: enable, value, rollout slider, preview evaluation (sha256 bucket in/out, no distinct_id). Definition edits; changing kind resets values. `@critical` archive hides from the table/preview. `@critical` copy-flags dialog to a second project: skip then overwrite, `CopyResult` shown, states land by environment key, `flag.copy` audit. Copy to another account → 404. `@critical` delete from the editor. |
| `tests/eval.spec.ts` | `@critical` `X-Environment-Key` header and bearer; JWT / management key / no key → 401. `@critical` on/off semantics per kind (boolean true/false, other kinds value/null, state value overrides default). Single-flag endpoint, unknown/archived → 404. `@critical` rollout determinism against the sha256 bucket computed in the test (`node:crypto`), per-flag buckets. No `distinct_id` → out below 100 %, 0 % always out. `@critical` rotated key → old 401, new works. `@critical` usage counter +1 per evaluation, preview not metered. |
| `tests/apikeys.spec.ts` | `GET /apikeys/roles` matches the shared registry; `invalid_role`. `@critical` viewer/editor/admin keys created in `/dashboard/settings`; viewer write → 403 `insufficient_scope`; editor creates but cannot delete; admin deletes; `/apikeys/me` scopes; `last_used_at`. `@critical` audit log (API: `auth.denied`, `project.create|delete`, `apikey.create`, action filter; UI table + filter). `@critical` revoke → 401. |
| `tests/mcp.spec.ts` | `@critical` `POST /mcp` 401 without/with bogus key; `serverInfo.name === "exp"`; viewer sees only read tools; editor sees `create_flag`/`copy_flags` but not `delete_flag`; admin sees all 18. Viewer `create_flag` refused. `@critical` `create_flag` + `set_flag_state`; `delete_flag` refused without `confirm`, deletes with `confirm: true` (audited as `api_key`); `copy_flags`; `evaluate_flags`. |
| `tests/marketing.spec.ts` | `@critical` landing hero, MCP section (local/remote/JSON snippets), early-access notes; nav without Pricing; `/info`, `/info/pricing` (planned + notice), `/info/docs` sections; blog index + post + 404; `/sponsors`; `@critical` footer (`github.com/Devace-93/exp`, `info.3m4.net`); `/api/features`. |
| `tests/prefs.spec.ts` | `@critical` theme toggle → dark, `3m4.theme` persists (marketing + auth pages); `@critical` language picker: 34 locales, search, Spanish (`3m4.lang`, translated strings, login page), `ar-SA` → `dir=rtl`; dashboard nav carries the same controls. |

`helpers.ts` holds the account/project/flag/API-key factories, session seeding,
the rollout bucket (`rolloutBucket`), the roles → scopes / tools tables and the
minimal Streamable-HTTP (SSE) MCP client.

## CI

`.github/workflows/e2e.yml` builds the stack with docker compose on every pull
request (and on demand), waits for `/api/healthz`, runs the suite and uploads
`playwright-report/` on failure.

## Demo recording

`docs/demo.gif` and `docs/demo.webm` are generated, not hand-made (the webm
comes from Playwright's built-in recorder, 1280×720 VP9):

```bash
cd e2e && bun run scripts/record-demo.ts        # drives the local stack, captures captioned frames
cd .. && uv run --with pillow e2e/scripts/make-gif.py e2e/demo-frames docs/demo.gif
```
