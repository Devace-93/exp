/**
 * The exp MCP server: tools, resources and prompts over the exp management API.
 *
 * Design notes (the parts worth reading before changing anything):
 *
 * - **RBAC, three layers.** The key's scopes (from `GET /apikeys/me`) decide
 *   which tools are *registered* (hidden tools are never listed), each handler
 *   re-checks its scope at call time, and the REST API enforces the same
 *   scopes independently. See `rbac.ts`.
 * - **Human approval for destructive actions.** `delete_project` and
 *   `delete_flag` ask the user through MCP *elicitation* when the client
 *   supports it (Claude Code, the Inspector). Otherwise they refuse until the
 *   model passes `confirm: true`, which forces the model to ask the user first.
 * - **Structured outputs.** Every tool declares an `outputSchema` and returns
 *   `structuredContent`, so hosts can validate and chain results without
 *   parsing prose. Objects that mirror API responses are *loose* (extra fields
 *   allowed) so an additive API change never breaks client-side validation.
 * - **Errors are results, not exceptions.** API errors come back as
 *   `isError: true` with the stable error code, so the model can recover
 *   (e.g. `limit_reached` → tell the user to upgrade) instead of crashing.
 * - **Everything is audited**, locally (`audit.ts`) and server-side.
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { compactArgs, type AuditEntry, type AuditOutcome, type AuditSink } from "./audit.js";
import { ExpApiError, type ExpClient } from "./client.js";
import { TOOL_SCOPES, hasScope, type ToolName } from "./rbac.js";
import type { Flag, KeyInfo, Project, Scope } from "./types.js";
import { VERSION } from "./version.js";

export interface ExpServerOptions {
  client: ExpClient;
  keyInfo: KeyInfo;
  audit: AuditSink;
  /** Label written to the audit log: "stdio" | "http". */
  transport?: string;
  /**
   * Whether destructive tools may ask the user via elicitation. Only safe on
   * a transport with a persistent back-channel (stdio). Default: true.
   */
  allowElicitation?: boolean;
}

// --------------------------------------------------------------------------- //
// Shared schema fragments
// --------------------------------------------------------------------------- //
const FLAG_KINDS = ["boolean", "string", "number", "json"] as const;
const PROJECT_KEY_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const FLAG_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,98}$/;

const projectId = z.uuid().describe("The project's id (UUID), as returned by list_projects or create_project.");
const flagRef = z
  .string()
  .min(1)
  .max(100)
  .describe("The flag's id (UUID) or its key, e.g. \"new-checkout\".");
const envKey = z
  .string()
  .regex(PROJECT_KEY_RE)
  .describe("Environment key, e.g. \"production\", \"staging\" or \"development\".");
const kindEnum = z.enum(FLAG_KINDS).describe("Flag kind: boolean (default), string, number or json.");
const jsonValue = z.unknown().describe("A JSON value matching the flag kind (ignored for boolean flags).");
const rolloutPercent = z
  .number()
  .int()
  .min(0)
  .max(100)
  .describe("Percentage of distinct_ids that get the flag ON (0-100). Bucketing is deterministic per flag key + distinct_id.");
const confirmFlag = z
  .boolean()
  .default(false)
  .describe("Set to true only after the user explicitly confirmed this specific deletion.");

const statePatchShape = {
  enabled: z.boolean().optional().describe("Whether the flag is on in this environment."),
  value: jsonValue.optional().describe("Served value when on; null falls back to the flag's default_value."),
  rollout_percent: rolloutPercent.optional(),
};

// Output schemas. `looseObject` = additionalProperties allowed (see header).
const stateObject = z.looseObject({
  enabled: z.boolean(),
  value: z.unknown(),
  rollout_percent: z.number(),
  updated_at: z.string().optional(),
});
const environmentObject = z.looseObject({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  client_key_prefix: z.string(),
  client_key: z.string().optional().describe("Full client key. ONLY returned on create / rotate; store it now."),
  position: z.number(),
  created_at: z.string(),
});
const projectObject = z.looseObject({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  flag_count: z.number(),
  environments: z.array(environmentObject).optional(),
  created_at: z.string(),
  updated_at: z.string(),
});
const flagObject = z.looseObject({
  id: z.string(),
  project_id: z.string(),
  key: z.string(),
  name: z.string().nullable(),
  description: z.string().nullable().optional(),
  kind: z.enum(FLAG_KINDS),
  default_value: z.unknown(),
  tags: z.array(z.string()),
  archived: z.boolean(),
  states: z.record(z.string(), stateObject),
  created_at: z.string(),
  updated_at: z.string(),
});
const evaluationObject = z.looseObject({
  project: z.looseObject({ id: z.string(), key: z.string() }),
  environment: z.looseObject({ id: z.string(), key: z.string() }),
  distinct_id: z.string().nullable().optional(),
  evaluated_at: z.string(),
  flags: z.record(z.string(), z.looseObject({ kind: z.enum(FLAG_KINDS), enabled: z.boolean(), value: z.unknown() })),
});
const copyResultObject = z.looseObject({
  target_project_id: z.string(),
  copied: z.array(z.string()),
  overwritten: z.array(z.string()),
  skipped: z.array(z.string()),
});
const exportObject = z.looseObject({
  format: z.string(),
  exported_at: z.string(),
  project: z.looseObject({ key: z.string(), name: z.string(), description: z.string().nullable().optional() }),
  environments: z.array(z.looseObject({ key: z.string(), name: z.string(), position: z.number() })),
  flags: z.array(
    z.looseObject({
      key: z.string(),
      name: z.string().nullable(),
      description: z.string().nullable().optional(),
      kind: z.enum(FLAG_KINDS),
      default_value: z.unknown(),
      tags: z.array(z.string()),
      archived: z.boolean(),
      states: z.record(z.string(), z.looseObject({ enabled: z.boolean(), value: z.unknown(), rollout_percent: z.number() })),
    }),
  ),
});
const usageObject = z.looseObject({
  period_start: z.string(),
  period_end: z.string(),
  evaluations: z.number(),
  counts: z.looseObject({ projects: z.number(), api_keys: z.number() }),
  limits: z.record(z.string(), z.unknown()),
});
const auditEventObject = z.looseObject({
  id: z.string(),
  ts: z.string(),
  actor_type: z.string(),
  actor_id: z.string().nullable(),
  actor_label: z.string().nullable(),
  action: z.string(),
  target_type: z.string().nullable(),
  target_id: z.string().nullable(),
  outcome: z.string(),
  meta: z.record(z.string(), z.unknown()),
});

/** A handler may return a plain result, or wrap it to record a non-"ok" audit outcome. */
type Wrapped = { result: CallToolResult; outcome: AuditOutcome };
type Handled = CallToolResult | Wrapped;

function isWrapped(out: Handled): out is Wrapped {
  return (
    typeof (out as Wrapped).outcome === "string" &&
    typeof (out as Wrapped).result === "object" &&
    !("content" in out)
  );
}

function structured(value: Record<string, unknown>, summary?: string): CallToolResult {
  return {
    content: [{ type: "text", text: summary ?? JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function failure(code: string, message: string, extra: Record<string, unknown> = {}): CallToolResult {
  const detail = Object.keys(extra).length ? ` ${JSON.stringify(extra)}` : "";
  return {
    content: [{ type: "text", text: `Error (${code}): ${message}${detail}` }],
    isError: true,
  };
}

/** One-line human summary of a flag's per-environment states. */
function describeStates(flag: Flag): string {
  return (
    Object.entries(flag.states)
      .map(([env, s]) => {
        const pct = s.rollout_percent < 100 ? ` ${s.rollout_percent}%` : "";
        const val = flag.kind !== "boolean" && s.value !== null && s.value !== undefined ? ` value=${JSON.stringify(s.value)}` : "";
        return `${env}: ${s.enabled ? "on" : "off"}${pct}${val}`;
      })
      .join(", ") || "no environments"
  );
}

function describeProject(p: Project): string {
  const envs = p.environments?.map((e) => e.key).join(", ");
  return `${p.name} (key=${p.key}, id=${p.id}, ${p.flag_count} flag(s)${envs ? `, environments: ${envs}` : ""})`;
}

export function buildInstructions(info: KeyInfo): string {
  return [
    `exp is a feature-flag service. You are acting for account "${info.account.name}" (plan: ${info.account.plan}).`,
    `This API key has role "${info.key.role}" with scopes: ${info.scopes.join(", ")}. Only tools allowed by those scopes are listed; if a user asks for something outside them, say the key lacks that permission instead of guessing.`,
    "Model: an account has projects; a project has environments (production, staging, development by default) and flags; every flag has one state per environment (enabled, value, rollout_percent). Apps read flags with an environment client key (exp_env_...); you manage them with this management key (exp_live_...).",
    "Flags are referenced by project id plus flag id or key. Keys are lowercase slugs. To turn a flag on or off in one environment use set_flag_state, not update_flag.",
    "Deleting a project or a flag is irreversible: delete_project and delete_flag require explicit user confirmation.",
  ].join("\n");
}

export function createExpServer(opts: ExpServerOptions): McpServer {
  const { client, keyInfo, audit } = opts;
  const transport = opts.transport ?? "unknown";
  const allowElicitation = opts.allowElicitation ?? true;
  const scopes = new Set<Scope>(keyInfo.scopes);
  const actor = { account: keyInfo.account.id, prefix: keyInfo.key.prefix, role: keyInfo.key.role };

  const server = new McpServer(
    { name: "exp", version: VERSION },
    { instructions: buildInstructions(keyInfo) },
  );

  const log = (
    tool: ToolName,
    outcome: AuditOutcome,
    started: number,
    args?: unknown,
    extra: Partial<Pick<AuditEntry, "error" | "meta">> = {},
  ) =>
    audit.write({
      ts: new Date().toISOString(),
      event: "tool.call",
      transport,
      actor,
      tool,
      outcome,
      duration_ms: Date.now() - started,
      args: compactArgs(args),
      ...extra,
    });

  /**
   * Register a tool only if the key's scopes allow it, wrapping the handler
   * with the call-time scope re-check, error mapping and audit logging.
   */
  function tool<In extends z.ZodRawShape, Out extends z.ZodObject>(
    name: ToolName,
    config: {
      title: string;
      description: string;
      inputSchema: In;
      outputSchema: Out;
      annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
    },
    handler: (
      args: z.infer<z.ZodObject<In>>,
      extra: Parameters<Parameters<McpServer["registerTool"]>[2]>[1],
    ) => Promise<Handled>,
  ): void {
    const required = TOOL_SCOPES[name];
    if (!scopes.has(required)) return; // layer 1: never listed

    server.registerTool(
      name,
      {
        title: config.title,
        description: `${config.description} (requires scope ${required})`,
        inputSchema: config.inputSchema,
        outputSchema: config.outputSchema,
        annotations: { title: config.title, ...config.annotations },
      },
      (async (args: z.infer<z.ZodObject<In>>, extra: Parameters<typeof handler>[1]) => {
        const started = Date.now();
        if (!hasScope(scopes, required)) {
          // layer 2: refused even if somehow invoked
          log(name, "denied", started, args, { error: { code: "insufficient_scope", message: required } });
          return failure("insufficient_scope", `This key (role ${keyInfo.key.role}) lacks ${required}.`, {
            required_scope: required,
          });
        }
        try {
          const out = await handler(args, extra);
          if (isWrapped(out)) {
            log(name, out.outcome, started, args);
            return out.result;
          }
          log(name, "ok", started, args);
          return out;
        } catch (err) {
          if (err instanceof ExpApiError) {
            // layer 3 (the API said no) or any other API-level failure
            log(name, err.code === "insufficient_scope" ? "denied" : "error", started, args, {
              error: { code: err.code, message: err.message },
            });
            return failure(err.code, err.message, { status: err.status, ...err.extra });
          }
          const message = err instanceof Error ? err.message : String(err);
          log(name, "error", started, args, { error: { code: "internal_error", message } });
          return failure("internal_error", message);
        }
      }) as never,
    );
  }

  /**
   * Shared confirmation flow for destructive tools: elicit when possible,
   * otherwise require `confirm: true`. Returns null when approved.
   */
  async function confirmOrRefuse(
    confirm: boolean,
    what: string,
    toolName: ToolName,
    cancelled: Record<string, unknown>,
  ): Promise<Wrapped | null> {
    if (confirm) return null;
    const canAsk = allowElicitation && Boolean(server.server.getClientCapabilities()?.elicitation);
    if (canAsk) {
      const answer = await server.server.elicitInput({
        mode: "form",
        message: `${what} This cannot be undone.`,
        requestedSchema: {
          type: "object",
          properties: { confirm: { type: "boolean", title: "Yes, delete it", default: false } },
          required: ["confirm"],
        },
      });
      if (answer.action === "accept" && answer.content?.confirm === true) return null;
      return {
        outcome: "cancelled",
        result: structured(cancelled, "Deletion was cancelled by the user. Nothing was changed."),
      };
    }
    return {
      outcome: "pending",
      result: failure(
        "confirmation_required",
        `${what} This is irreversible. Ask the user to confirm, then call ${toolName} again with confirm=true.`,
      ),
    };
  }

  // ------------------------------------------------------------------------- //
  // Projects
  // ------------------------------------------------------------------------- //
  tool(
    "list_projects",
    {
      title: "List projects",
      description:
        "List the account's projects, newest first, each with its environments and flag count. Use q to search by name or key. Start here to find a project id for the other tools.",
      inputSchema: {
        q: z.string().optional().describe("Case-insensitive search in project name and key."),
      },
      outputSchema: z.looseObject({ items: z.array(projectObject), total: z.number() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const page = await client.listProjects(args);
      const lines = page.items.map(describeProject);
      return structured({ ...page }, `${page.total} project(s).\n${lines.join("\n")}`);
    },
  );

  tool(
    "get_project",
    {
      title: "Get project",
      description: "Fetch one project by id with its environments (keys, names, client key prefixes) and flag count.",
      inputSchema: { project_id: projectId },
      outputSchema: projectObject,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id }) => {
      const p = await client.getProject(project_id);
      return structured({ ...p }, describeProject(p));
    },
  );

  tool(
    "create_project",
    {
      title: "Create project",
      description:
        "Create a project. Seeds three environments (production, staging, development) and returns them with their ONE-TIME client_key (exp_env_...); show those keys to the user because they cannot be read again (only rotated). Errors: limit_reached (which=projects) when the plan's project quota is used up, key_taken when the key already exists in this account.",
      inputSchema: {
        name: z.string().min(1).max(100).describe("Human-friendly project name."),
        key: z
          .string()
          .regex(PROJECT_KEY_RE)
          .optional()
          .describe("Slug, unique per account (^[a-z0-9][a-z0-9-]{0,62}$). Defaults to a slug of the name."),
        description: z.string().max(1000).optional(),
      },
      outputSchema: projectObject,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async (args) => {
      const p = await client.createProject(args);
      const keys = (p.environments ?? []).map((e) => `  ${e.key}: ${e.client_key ?? e.client_key_prefix}`).join("\n");
      return structured({ ...p }, `Created project ${describeProject(p)}.\nClient keys (shown once):\n${keys}`);
    },
  );

  tool(
    "update_project",
    {
      title: "Update project",
      description: "Rename a project or change its description. Only the fields you pass are changed; the key cannot change.",
      inputSchema: {
        project_id: projectId,
        name: z.string().min(1).max(100).optional(),
        description: z.string().max(1000).optional(),
      },
      outputSchema: projectObject,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ project_id, ...patch }) => {
      const p = await client.updateProject(project_id, patch);
      return structured({ ...p }, `Updated project ${describeProject(p)}.`);
    },
  );

  tool(
    "delete_project",
    {
      title: "Delete project",
      description:
        "Permanently delete a project with ALL its environments, flags and states. IRREVERSIBLE: apps using its client keys will stop getting flags. The user must confirm: when the client supports it you will be prompted; otherwise ask the user explicitly and call again with confirm=true.",
      inputSchema: { project_id: projectId, confirm: confirmFlag },
      outputSchema: z.looseObject({ deleted: z.boolean(), id: z.string(), key: z.string(), name: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ project_id, confirm }) => {
      // Show the user *what* they are deleting (needs projects:read, which
      // every role that can delete also has).
      const p = await client.getProject(project_id);
      const refusal = await confirmOrRefuse(
        confirm,
        `Delete project "${p.name}" (${p.key}) with its ${p.flag_count} flag(s) and ${p.environments?.length ?? "all"} environment(s)?`,
        "delete_project",
        { deleted: false, id: p.id, key: p.key, name: p.name },
      );
      if (refusal) return refusal;
      await client.deleteProject(project_id);
      return structured({ deleted: true, id: p.id, key: p.key, name: p.name }, `Deleted project "${p.name}" (${p.key}).`);
    },
  );

  // ------------------------------------------------------------------------- //
  // Environments
  // ------------------------------------------------------------------------- //
  tool(
    "create_environment",
    {
      title: "Create environment",
      description:
        "Add an environment (e.g. \"qa\", \"canary\") to a project. Every existing flag gets the default state in it (off, rollout 100%). Returns the ONE-TIME client_key; show it to the user. Errors: limit_reached (which=environments), key_taken.",
      inputSchema: {
        project_id: projectId,
        key: envKey,
        name: z.string().min(1).max(100).optional().describe("Display name. Defaults to the key."),
      },
      outputSchema: environmentObject,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ project_id, ...input }) => {
      const e = await client.createEnvironment(project_id, input);
      return structured({ ...e }, `Created environment ${e.key} (id=${e.id}). Client key (shown once): ${e.client_key}`);
    },
  );

  tool(
    "rotate_environment_key",
    {
      title: "Rotate environment client key",
      description:
        "Issue a new client key (exp_env_...) for one environment. The OLD KEY STOPS WORKING IMMEDIATELY, so only do this when the user asks to rotate or revoke a leaked key, and show them the new key (it is returned once). Use get_project to find the environment id.",
      inputSchema: {
        project_id: projectId,
        environment_id: z.uuid().describe("The environment's id (UUID), from get_project."),
      },
      outputSchema: z.looseObject({ client_key: z.string(), client_key_prefix: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    },
    async ({ project_id, environment_id }) => {
      const k = await client.rotateEnvironmentKey(project_id, environment_id);
      return structured({ ...k }, `Rotated. New client key (shown once): ${k.client_key}. The previous key is now invalid.`);
    },
  );

  // ------------------------------------------------------------------------- //
  // Flags
  // ------------------------------------------------------------------------- //
  tool(
    "list_flags",
    {
      title: "List flags",
      description:
        "List a project's flags ordered by key, with their per-environment states. Use q to search by key, name or description; archived flags are hidden unless include_archived=true.",
      inputSchema: {
        project_id: projectId,
        q: z.string().optional().describe("Case-insensitive search in key, name and description."),
        page: z.number().int().min(1).default(1).describe("1-based page number."),
        per_page: z.number().int().min(1).max(200).default(50).describe("Flags per page (max 200)."),
        include_archived: z.boolean().default(false),
      },
      outputSchema: z.looseObject({ items: z.array(flagObject), page: z.number(), per_page: z.number(), total: z.number() }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id, ...params }) => {
      const page = await client.listFlags(project_id, params);
      const lines = page.items.map(
        (f) => `${f.key} [${f.kind}${f.archived ? ", archived" : ""}] ${describeStates(f)} id=${f.id}`,
      );
      return structured(
        { ...page },
        `${page.total} flag(s) total; showing page ${page.page} (${page.items.length}).\n${lines.join("\n")}`,
      );
    },
  );

  tool(
    "get_flag",
    {
      title: "Get flag",
      description: "Fetch one flag by id or key, including its default value, tags and the state in every environment.",
      inputSchema: { project_id: projectId, flag: flagRef },
      outputSchema: flagObject,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id, flag }) => {
      const f = await client.getFlag(project_id, flag);
      return structured({ ...f }, `${f.key} [${f.kind}] default=${JSON.stringify(f.default_value)}; ${describeStates(f)}`);
    },
  );

  tool(
    "create_flag",
    {
      title: "Create flag",
      description:
        "Create a flag in a project. Every environment gets the default state (enabled=false, value=null, rollout_percent=100) unless you pass states. For non-boolean kinds default_value must match the kind (error invalid_value). Errors: limit_reached (which=flags) when the plan's flags-per-project quota is used up, key_taken when the key already exists in this project.",
      inputSchema: {
        project_id: projectId,
        key: z
          .string()
          .regex(FLAG_KEY_RE)
          .describe("Flag key, unique per project (^[a-z0-9][a-z0-9_-]{0,98}$); this is what SDKs reference."),
        name: z.string().max(100).optional().describe("Display name. Defaults to the key."),
        description: z.string().max(1000).optional(),
        kind: kindEnum.default("boolean"),
        default_value: jsonValue.optional().describe("Value served when a state has value=null. Ignored for boolean (always true)."),
        tags: z.array(z.string().min(1).max(50)).max(20).optional(),
        states: z
          .record(envKey, z.object(statePatchShape))
          .optional()
          .describe("Initial per-environment overrides keyed by environment key, e.g. {\"development\": {\"enabled\": true}}."),
      },
      outputSchema: flagObject,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ project_id, ...input }) => {
      const f = await client.createFlag(project_id, input);
      return structured({ ...f }, `Created flag ${f.key} [${f.kind}] (id=${f.id}); ${describeStates(f)}.`);
    },
  );

  tool(
    "update_flag",
    {
      title: "Update flag",
      description:
        "Change a flag's definition: name, description, kind, default_value, tags or archived. Only the fields you pass are changed. Changing kind resets every environment's value to null. archived=true hides the flag from SDKs without deleting it (reversible). To toggle the flag in an environment use set_flag_state instead.",
      inputSchema: {
        project_id: projectId,
        flag: flagRef,
        name: z.string().max(100).optional(),
        description: z.string().max(1000).optional(),
        kind: kindEnum.optional(),
        default_value: jsonValue.optional(),
        tags: z.array(z.string().min(1).max(50)).max(20).optional(),
        archived: z.boolean().optional().describe("true archives (SDKs stop seeing it), false restores."),
      },
      outputSchema: flagObject,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ project_id, flag, ...patch }) => {
      const f = await client.updateFlag(project_id, flag, patch);
      return structured({ ...f }, `Updated flag ${f.key} [${f.kind}${f.archived ? ", archived" : ""}].`);
    },
  );

  tool(
    "set_flag_state",
    {
      title: "Set flag state in an environment",
      description:
        "Turn a flag on/off, change its served value or its rollout percentage in ONE environment. Only the fields you pass are changed. This is the tool for \"enable X in staging\" or \"roll out X to 25% in production\". Returns the whole flag. Errors: invalid_value when value does not match the flag kind, not_found for an unknown environment key.",
      inputSchema: { project_id: projectId, flag: flagRef, environment: envKey, ...statePatchShape },
      outputSchema: flagObject,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    },
    async ({ project_id, flag, environment, ...patch }) => {
      const f = await client.setFlagState(project_id, flag, environment, patch);
      const s = f.states[environment];
      const now = s ? `${s.enabled ? "on" : "off"}${s.rollout_percent < 100 ? ` at ${s.rollout_percent}%` : ""}` : "updated";
      return structured({ ...f }, `${f.key} in ${environment}: ${now}. All states: ${describeStates(f)}.`);
    },
  );

  tool(
    "copy_flags",
    {
      title: "Copy flags to another project",
      description:
        "Copy flag definitions (and by default their per-environment states, matched by environment key) from this project into another project of the same account. Defaults to every non-archived flag; on_conflict decides what happens to keys that already exist in the target (skip, the default, or overwrite). All-or-nothing: errors limit_reached (which=flags) if the target would exceed its quota, feature_disabled if copying is switched off, not_found if the target is not in this account.",
      inputSchema: {
        project_id: projectId.describe("Source project id."),
        target_project_id: z.uuid().describe("Destination project id (same account)."),
        flag_keys: z.array(z.string().regex(FLAG_KEY_RE)).min(1).optional().describe("Subset of flag keys to copy. Defaults to all non-archived flags."),
        include_states: z.boolean().default(true).describe("Copy per-environment states onto same-key environments of the target."),
        on_conflict: z.enum(["skip", "overwrite"]).default("skip"),
      },
      outputSchema: copyResultObject,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ project_id, ...input }) => {
      const r = await client.copyFlags(project_id, input);
      return structured(
        { ...r },
        `Copied ${r.copied.length}, overwrote ${r.overwritten.length}, skipped ${r.skipped.length} flag(s) into project ${r.target_project_id}.` +
          (r.skipped.length ? ` Skipped: ${r.skipped.join(", ")}.` : ""),
      );
    },
  );

  tool(
    "delete_flag",
    {
      title: "Delete flag",
      description:
        "Permanently delete a flag and its states in every environment. IRREVERSIBLE; prefer update_flag with archived=true when the user may want it back. The user must confirm: when the client supports it you will be prompted; otherwise ask the user explicitly and call again with confirm=true.",
      inputSchema: { project_id: projectId, flag: flagRef, confirm: confirmFlag },
      outputSchema: z.looseObject({ deleted: z.boolean(), id: z.string(), key: z.string(), project_id: z.string() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ project_id, flag, confirm }) => {
      const f = await client.getFlag(project_id, flag);
      const on = Object.entries(f.states).filter(([, s]) => s.enabled).map(([env]) => env);
      const refusal = await confirmOrRefuse(
        confirm,
        `Delete flag "${f.key}"${on.length ? ` (currently ON in ${on.join(", ")})` : " (off everywhere)"}?`,
        "delete_flag",
        { deleted: false, id: f.id, key: f.key, project_id: f.project_id },
      );
      if (refusal) return refusal;
      await client.deleteFlag(project_id, f.id);
      return structured({ deleted: true, id: f.id, key: f.key, project_id: f.project_id }, `Deleted flag ${f.key} (id=${f.id}).`);
    },
  );

  tool(
    "export_project",
    {
      title: "Export project",
      description:
        "Export a project's environments and flags (definitions + states, no secrets) as a portable JSON document (format exp.project.v1). Use it for backups, reviews or to move configuration between accounts.",
      inputSchema: { project_id: projectId },
      outputSchema: exportObject,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id }) => {
      const x = await client.exportProject(project_id);
      return structured(
        { ...x },
        `Export of ${x.project.key}: ${x.environments.length} environment(s), ${x.flags.length} flag(s).\n${JSON.stringify(x, null, 2)}`,
      );
    },
  );

  tool(
    "evaluate_flags",
    {
      title: "Preview flag evaluation",
      description:
        "Preview what the evaluation API would return for one environment and (optionally) one distinct_id: every non-archived flag with enabled + value after applying states and rollout buckets. Not metered and not rate-limited as an evaluation, so use it freely to answer \"what does user X see in production?\". Without distinct_id, partial rollouts evaluate as OFF.",
      inputSchema: {
        project_id: projectId,
        environment: envKey,
        distinct_id: z.string().max(200).optional().describe("The end-user / device identifier the SDK would send."),
      },
      outputSchema: evaluationObject,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ project_id, environment, distinct_id }) => {
      const ev = await client.evaluateFlags(project_id, environment, distinct_id);
      const lines = Object.entries(ev.flags).map(
        ([k, v]) => `${k}: ${v.enabled ? "on" : "off"}${v.kind !== "boolean" ? ` value=${JSON.stringify(v.value)}` : ""}`,
      );
      return structured(
        { ...ev },
        `${ev.project.key}/${ev.environment.key}${distinct_id ? ` for ${distinct_id}` : ""}: ${lines.join("; ") || "no flags"}`,
      );
    },
  );

  // ------------------------------------------------------------------------- //
  // Account
  // ------------------------------------------------------------------------- //
  tool(
    "get_usage",
    {
      title: "Usage and limits",
      description:
        "This month's evaluations plus project / API key counts against the plan's limits (-1 = unlimited). Call this when a tool returns limit_reached or before creating many projects or flags.",
      inputSchema: {},
      outputSchema: usageObject,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async () => {
      const u = await client.usage();
      const lim = u.limits;
      const fmt = (n: unknown) => (n === -1 ? "unlimited" : String(n ?? "?"));
      return structured(
        { ...u },
        `Period ${u.period_start} → ${u.period_end}: ${u.evaluations}/${fmt(lim.evaluations_per_month)} evaluations, ${u.counts.projects}/${fmt(lim.projects)} projects, ${u.counts.api_keys}/${fmt(lim.api_keys)} API keys. Per project: ${fmt(lim.environments_per_project)} environments, ${fmt(lim.flags_per_project)} flags.`,
      );
    },
  );

  tool(
    "get_audit_log",
    {
      title: "Audit log",
      description:
        "Most recent audit events for the account (who did what, when, and whether it was allowed). Useful to answer \"who turned X off?\" or to review agent activity. Actions look like flag.create, flag_state.update, project.delete, auth.denied.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).default(50),
        action: z.string().optional().describe("Filter by action, e.g. flag_state.update, flag.delete, auth.denied."),
      },
      outputSchema: z.looseObject({ items: z.array(auditEventObject) }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args) => {
      const { items } = await client.auditLog(args);
      const lines = items.map(
        (e) =>
          `${e.ts} ${e.outcome.padEnd(6)} ${e.action} by ${e.actor_type}${e.actor_label ? `:${e.actor_label}` : ""}${e.target_id ? ` → ${e.target_type}:${e.target_id}` : ""}`,
      );
      return structured({ items }, lines.join("\n") || "No audit events.");
    },
  );

  // ------------------------------------------------------------------------- //
  // Resources (read-only context the host can attach without a tool call)
  // ------------------------------------------------------------------------- //
  if (scopes.has("projects:read")) {
    server.registerResource(
      "projects",
      "exp://projects",
      {
        title: "Projects",
        description: "Every project of the account with its environments and flag count.",
        mimeType: "application/json",
      },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(await client.listProjects(), null, 2) }],
      }),
    );
  }

  if (scopes.has("flags:read")) {
    server.registerResource(
      "project-flags",
      new ResourceTemplate("exp://projects/{id}/flags", { list: undefined }),
      {
        title: "Project flags",
        description: "All flags of one project (by project id) with their per-environment states.",
        mimeType: "application/json",
      },
      async (uri, { id }) => ({
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(await client.listFlags(String(id), { per_page: 200 }), null, 2),
          },
        ],
      }),
    );
  }

  // ------------------------------------------------------------------------- //
  // Prompts (reusable workflows the user can pick from the host UI)
  // ------------------------------------------------------------------------- //
  if (scopes.has("flags:read")) {
    server.registerPrompt(
      "rollout-plan",
      {
        title: "Staged rollout plan",
        description: "Draft a staged rollout of one flag across the project's environments, from development to 100% in production.",
        argsSchema: {
          project_id: z.string().describe("Project id (UUID)."),
          flag: z.string().describe("Flag id or key."),
        },
      },
      ({ project_id, flag }) => ({
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `Call get_project with project_id="${project_id}" and get_flag with flag="${flag}" in that project. Then draft a staged rollout plan for this flag: one stage per environment in position order (development first, production last), with suggested rollout_percent steps for production (e.g. 5% → 25% → 50% → 100%), what to verify before each step, and how to roll back (set_flag_state with enabled=false). Show the exact set_flag_state calls for each stage as a small table. Do NOT change any state unless the user explicitly asks you to execute the plan.`,
            },
          },
        ],
      }),
    );
  }

  return server;
}
