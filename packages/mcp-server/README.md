# exp-mcp

[Model Context Protocol](https://modelcontextprotocol.io) server for
[exp](https://exp.3m4.net), the feature-flag service. Lets an AI agent (Claude
Code, Claude Desktop, Cursor, the MCP Inspector, your own app) manage
projects, environments and flags, toggle per-environment states, run staged
rollouts and preview evaluations — with **role-based tool access**, a **human
approval step** for destructive actions, and an **audit trail**.

```
npx exp-mcp              # stdio (local hosts)
https://exp.3m4.net/mcp  # Streamable HTTP (remote hosts)
```

## Quick start

1. Create an API key in the dashboard (`/dashboard/settings`) and pick a role.
2. Register the server with your host.

**Claude Code**

```bash
claude mcp add exp --scope user \
  --env EXP_API_KEY=exp_live_… \
  -- npx -y exp-mcp
```

**Cursor / Claude Desktop / any JSON config**

```json
{
  "mcpServers": {
    "exp": {
      "command": "npx",
      "args": ["-y", "exp-mcp"],
      "env": { "EXP_API_KEY": "exp_live_…" }
    }
  }
}
```

**Remote (Streamable HTTP)** — no install, the key travels as a Bearer token:

```bash
claude mcp add --transport http exp https://exp.3m4.net/mcp \
  --header "Authorization: Bearer exp_live_…"
```

Then ask: *"create a flag new-checkout in the web app project and turn it on in
staging"*, *"roll new-checkout out to 25% in production"*, *"what does user 42
see in production?"*, *"who turned the banner off yesterday?"*.

## Configuration

| Variable        | Default                   | Meaning |
|-----------------|---------------------------|---------|
| `EXP_API_KEY`   | —                         | Required for stdio. The exp management API key (`exp_live_…`). |
| `EXP_API_URL`   | `https://exp.3m4.net/api` | API base URL. Self-hosters point this at their instance. |
| `EXP_AUDIT_LOG` | `stderr`                  | `stderr`, `none`, or a file path (JSON lines). |
| `EXP_MCP_PORT`  | `3333`                    | HTTP entrypoint only. |

Environment client keys (`exp_env_…`) are **not** accepted: they can only call
the evaluation API and carry no role.

## Roles and tools (RBAC)

Each API key has a role. The server asks the API for the key's scopes once
(`GET /apikeys/me`) and **only registers the tools those scopes allow**, so a
read-only key never even lists `delete_flag`. Every call is re-checked at
call time, and the API enforces the same scopes independently — three layers,
and a bug in the server can hide access but never grant it.

| Tool                     | Scope             | viewer | editor | admin | Notes |
|--------------------------|-------------------|:------:|:------:|:-----:|-------|
| `list_projects`          | `projects:read`   | ✓ | ✓ | ✓ | search with `q` |
| `get_project`            | `projects:read`   | ✓ | ✓ | ✓ | environments + client key prefixes |
| `list_flags`             | `flags:read`      | ✓ | ✓ | ✓ | per-environment states, `include_archived` |
| `get_flag`               | `flags:read`      | ✓ | ✓ | ✓ | by id or key |
| `export_project`         | `flags:read`      | ✓ | ✓ | ✓ | `exp.project.v1` JSON |
| `evaluate_flags`         | `flags:read`      | ✓ | ✓ | ✓ | unmetered preview for one environment / distinct_id |
| `get_usage`              | `usage:read`      | ✓ | ✓ | ✓ | evaluations and counts vs. plan limits |
| `create_project`         | `projects:write`  |   | ✓ | ✓ | seeds 3 environments, returns one-time client keys |
| `update_project`         | `projects:write`  |   | ✓ | ✓ | |
| `create_environment`     | `projects:write`  |   | ✓ | ✓ | returns one-time client key |
| `rotate_environment_key` | `projects:write`  |   | ✓ | ✓ | old key stops working immediately |
| `create_flag`            | `flags:write`     |   | ✓ | ✓ | kind, default_value, tags, initial states |
| `update_flag`            | `flags:write`     |   | ✓ | ✓ | definition only (incl. `archived`) |
| `set_flag_state`         | `flags:write`     |   | ✓ | ✓ | enabled / value / rollout_percent in one environment |
| `copy_flags`             | `flags:write`     |   | ✓ | ✓ | between projects, `on_conflict` skip/overwrite |
| `delete_project`         | `projects:delete` |   |   | ✓ | **confirmation required** |
| `delete_flag`            | `flags:delete`    |   |   | ✓ | **confirmation required** |
| `get_audit_log`          | `audit:read`      |   |   | ✓ | |

Roles are defined once in
[`packages/shared/api_key_roles.json`](../shared/api_key_roles.json) and
shared by the API, the dashboard and this server.

Also exposed: resources `exp://projects` and `exp://projects/{id}/flags`, and
the `rollout-plan` prompt (drafts a staged rollout of one flag across
environments without changing anything).

## Human approval for destructive actions

`delete_project` and `delete_flag` are irreversible, so they never run on the
model's say-so alone:

- On hosts that support MCP **elicitation** (Claude Code, Inspector) the user
  gets a native confirmation dialog showing exactly what will be deleted (the
  project with its flag count, or the flag and where it is currently on).
- On hosts that don't (and always over HTTP, which is stateless), the tool
  refuses with `confirmation_required` until the model calls it again with
  `confirm: true` — which it can only honestly do after asking the user.

`rotate_environment_key` is not gated but is marked destructive: the previous
client key stops working the moment it runs. Prefer `update_flag` with
`archived: true` over `delete_flag` when the flag may be needed again.

## Audit trail

Two complementary logs:

- **Server-side** (`audit_events` table, `GET /account/audit`, tool
  `get_audit_log`): every mutation and every authorization denial, written in
  the same transaction as the change.
- **Agent-side** (`EXP_AUDIT_LOG`, JSON lines): every tool call the agent
  attempted, including ones refused locally that never reached the API, with
  duration, outcome (`ok|denied|error|cancelled|pending`) and compacted args.

## Design notes

- **Structured outputs.** Every tool declares an `outputSchema` and returns
  `structuredContent`; hosts can validate and chain results without parsing
  prose. Objects mirroring API responses allow extra fields, so an additive
  API change never breaks client-side validation.
- **Errors are results.** API errors come back as `isError` with the stable
  code (`limit_reached` + `which`, `key_taken`, `insufficient_scope`,
  `feature_disabled`, `invalid_value`, `not_found`…) so the model can recover
  instead of crashing.
- **stdio hygiene.** stdout is the protocol channel; all logging goes to stderr.
- **Stateless HTTP.** Each request builds a server bound to the caller's key;
  tenants can never share state. The `/apikeys/me` lookup is cached 60 s per key.

## Development

```bash
bun install
bun test            # in-memory MCP client ↔ server against a fake API
bun run build
EXP_API_KEY=… EXP_API_URL=http://localhost:8081/api bun run inspect   # MCP Inspector
EXP_API_KEY=… EXP_API_URL=http://localhost:8081/api bun run dev:http  # http://localhost:3333/mcp
```

The Docker image (`packages/mcp-server/Dockerfile`) runs the HTTP flavour and
is wired into `deploy/docker-compose.yml` as the `mcp` service, exposed by
Caddy at `/mcp`.

## License

MIT © Enrique Magallon Alvarez
