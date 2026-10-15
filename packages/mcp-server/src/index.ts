export { createExpServer, buildInstructions, type ExpServerOptions } from "./server.js";
export { ExpClient, ExpApiError, type ExpClientOptions } from "./client.js";
export { TOOL_SCOPES, ALL_TOOLS, CONFIRMED_TOOLS, allowedTools, hasScope, type ToolName } from "./rbac.js";
export {
  createAuditSink,
  StderrAuditSink,
  FileAuditSink,
  MemoryAuditSink,
  NullAuditSink,
  type AuditSink,
  type AuditEntry,
  type AuditOutcome,
} from "./audit.js";
export { loadConfig, DEFAULT_API_URL, type Config } from "./config.js";
export type * from "./types.js";
export { VERSION } from "./version.js";
