/**
 * Tool-level authorization.
 *
 * Every tool declares the one scope it needs. The server consults this table
 * twice (defense in depth):
 *
 *   1. at registration — tools the key cannot use are never listed, so the
 *      model is not tempted to call them;
 *   2. at call time — a tool that is somehow invoked without its scope is
 *      refused and the refusal is audited.
 *
 * The REST API enforces the same scopes independently (layer 3), so a bug in
 * this file can never *grant* access, only hide it.
 *
 * The table mirrors the "MCP (AI agents)" section of CONTRACT.md.
 */
import type { Scope } from "./types.js";

export const TOOL_SCOPES = {
  list_projects: "projects:read",
  get_project: "projects:read",
  create_project: "projects:write",
  update_project: "projects:write",
  create_environment: "projects:write",
  rotate_environment_key: "projects:write",
  delete_project: "projects:delete",
  list_flags: "flags:read",
  get_flag: "flags:read",
  export_project: "flags:read",
  evaluate_flags: "flags:read",
  create_flag: "flags:write",
  update_flag: "flags:write",
  set_flag_state: "flags:write",
  copy_flags: "flags:write",
  delete_flag: "flags:delete",
  get_usage: "usage:read",
  get_audit_log: "audit:read",
} as const satisfies Record<string, Scope>;

export type ToolName = keyof typeof TOOL_SCOPES;

export const ALL_TOOLS = Object.keys(TOOL_SCOPES) as ToolName[];

/** Tools that never run without explicit user confirmation. */
export const CONFIRMED_TOOLS: readonly ToolName[] = ["delete_project", "delete_flag", "rotate_environment_key"];

export function hasScope(scopes: Iterable<Scope>, scope: Scope): boolean {
  for (const s of scopes) if (s === scope) return true;
  return false;
}

export function allowedTools(scopes: Iterable<Scope>): ToolName[] {
  const set = new Set(scopes);
  return ALL_TOOLS.filter((tool) => set.has(TOOL_SCOPES[tool]));
}
