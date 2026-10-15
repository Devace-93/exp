# exp

**Open-source feature flags for projects, people and AI agents.** Register a
project, create flags, toggle them per environment, roll them out by percentage,
copy them between projects, and read them from your app with one HTTP call.
Agents get the same powers through a role-scoped API and an MCP server. MIT.

> Built by Enrique Magallon Alvarez. Hosted edition runs at `exp.3m4.net`
> (free during early access); the core is free to self-host.

![Demo: sign up, create a project, environment keys, flags per environment, rollout preview, copy flags between projects, API keys, MCP](docs/demo.gif)

[▶ Watch the 45-second video (webm)](docs/demo.webm)

---

## Why exp

- **Projects first.** Flags belong to a project; a project has environments
  (production, staging, development by default), each with its own client key.
- **Copy, don't retype.** Copy any set of flags from one project to another,
  states included, skipping or overwriting conflicts, in one transaction.
- **Agents are users too.** API keys carry a role (viewer / editor / admin),
  every mutation is audited, destructive tools ask for confirmation.
- **Never break a running app.** The evaluation API keeps answering past the
  monthly limit; only creating new things is blocked.
- **Self-host friendly.** Plain Docker, Postgres as the source of truth, no
  billing provider required.

## Architecture

```
Caddy (reverse proxy)
 ├─ web   Qwik City (Bun)  landing + /info + /blog + /sponsors + dashboard
 ├─ api   Flask            auth, projects, environments, flags, evaluation, keys, audit, billing webhooks
 └─ mcp   Node (MCP)       AI-agent access: tools over the API, RBAC, confirmations, audit
      Postgres (source of truth) · Redis (rate limits)
```

```
dbcore/               shared Python core (models, plans, rbac, audit, evaluation)
services/api/         Flask REST API
apps/web/             Qwik City frontend (Bun)
packages/mcp-server/  MCP server (npm: exp-mcp) — stdio + Streamable HTTP
packages/shared/      plan_limits.json, api_key_roles.json, feature_flags.json (single source of truth)
deploy/               docker-compose, Caddyfile, production runbook
db/                   Alembic scaffold for future migrations
e2e/                  Playwright end-to-end suite
```

The interface contract is [`CONTRACT.md`](CONTRACT.md); the plan is
[`PROJECT_PLAN.md`](PROJECT_PLAN.md).

## Quick start (Docker)

```bash
cp .env.example .env        # then edit secrets (JWT_SECRET_KEY, ...)
make up                     # build + start everything; creates the schema
# open http://localhost:8081
```

### Self-host (no billing)

```bash
make up-selfhost            # BILLING_ENABLED=false; paywalls hidden, limits unlimited
```

## Reading flags from your app

```bash
curl -H "X-Environment-Key: exp_env_…" \
  "https://exp.3m4.net/api/eval/flags?distinct_id=user-42"
# {"flags": {"new-checkout": {"kind": "boolean", "enabled": true, "value": true}, ...}}
```

One request returns every flag of the environment, already evaluated for the
given `distinct_id` (percentage rollouts are deterministic per id). Single flag:
`GET /api/eval/flags/<key>`.

## AI agents (MCP)

```bash
# local, from npm
claude mcp add exp --scope user --env EXP_API_KEY=exp_live_… -- npx -y exp-mcp
# remote, nothing to install
claude mcp add --transport http exp https://exp.3m4.net/mcp --header "Authorization: Bearer exp_live_…"
```

See [`packages/mcp-server`](packages/mcp-server/) for the tool/role table.

## Common tasks

| Command | Does |
|---|---|
| `make up` / `make down` | start / stop the full stack |
| `make up-selfhost` | start without billing |
| `make logs` | tail all logs |
| `make migrate` | create tables + apply Alembic migrations |
| `make e2e` | run the Playwright suite against the running stack |

## Languages and theme

Same language picker (34 country locales) and light/dark theme as the other
3m4 apps; the choice is shared across them through `localStorage`.

## License

MIT — see [`LICENSE`](LICENSE).
