/**
 * Client-side audit trail for the MCP server: one JSON line per tool call.
 *
 * This complements (does not replace) the server-side `audit_events` table:
 * the API records *what changed*; this log records *what the agent tried*,
 * including calls that were refused locally and never reached the API.
 *
 * In stdio mode stdout is the protocol channel, so the default sink is stderr.
 */
import { appendFileSync } from "node:fs";

export type AuditOutcome = "ok" | "denied" | "error" | "cancelled" | "pending";

export interface AuditEntry {
  ts: string;
  event: "server.start" | "tool.call";
  transport: string;
  actor: { account: string; prefix: string; role: string };
  tool?: string;
  outcome?: AuditOutcome;
  duration_ms?: number;
  args?: Record<string, unknown>;
  error?: { code: string; message: string };
  meta?: Record<string, unknown>;
}

export interface AuditSink {
  write(entry: AuditEntry): void;
}

export class StderrAuditSink implements AuditSink {
  write(entry: AuditEntry): void {
    process.stderr.write(JSON.stringify(entry) + "\n");
  }
}

export class FileAuditSink implements AuditSink {
  constructor(private readonly path: string) {}
  write(entry: AuditEntry): void {
    appendFileSync(this.path, JSON.stringify(entry) + "\n");
  }
}

export class MemoryAuditSink implements AuditSink {
  readonly entries: AuditEntry[] = [];
  write(entry: AuditEntry): void {
    this.entries.push(entry);
  }
}

export class NullAuditSink implements AuditSink {
  write(): void {}
}

/** `EXP_AUDIT_LOG`: "stderr" (default) | "none" | a file path. */
export function createAuditSink(setting: string | undefined): AuditSink {
  const value = (setting ?? "stderr").trim();
  if (value === "" || value === "stderr") return new StderrAuditSink();
  if (value === "none") return new NullAuditSink();
  return new FileAuditSink(value);
}

/** Keep logged arguments small and free of giant payloads. */
export function compactArgs(args: unknown): Record<string, unknown> | undefined {
  if (!args || typeof args !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    out[k] = typeof v === "string" && v.length > 200 ? v.slice(0, 200) + "…" : v;
  }
  return out;
}
