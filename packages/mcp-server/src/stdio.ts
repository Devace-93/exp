#!/usr/bin/env node
/**
 * stdio entrypoint: the host (Claude Code, Cursor, Inspector…) spawns this
 * process and talks JSON-RPC over stdin/stdout.
 *
 * Rule #1 of stdio servers: never write anything but protocol messages to
 * stdout. All logging goes to stderr (see audit.ts).
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createAuditSink } from "./audit.js";
import { ExpApiError, ExpClient } from "./client.js";
import { loadConfig } from "./config.js";
import { createExpServer } from "./server.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.apiKey) {
    process.stderr.write(
      "exp-mcp: EXP_API_KEY is not set. Create a key at <dashboard>/dashboard/settings and export it.\n",
    );
    process.exit(2);
  }

  const client = new ExpClient({ baseUrl: cfg.apiUrl, apiKey: cfg.apiKey });
  let keyInfo;
  try {
    keyInfo = await client.me();
  } catch (err) {
    const why = err instanceof ExpApiError ? `${err.status} ${err.code}: ${err.message}` : String(err);
    process.stderr.write(`exp-mcp: could not authenticate against ${cfg.apiUrl} (${why})\n`);
    process.exit(1);
  }

  const audit = createAuditSink(cfg.auditLog);
  const server = createExpServer({ client, keyInfo, audit, transport: "stdio", allowElicitation: true });
  await server.connect(new StdioServerTransport());
  audit.write({
    ts: new Date().toISOString(),
    event: "server.start",
    transport: "stdio",
    actor: { account: keyInfo.account.id, prefix: keyInfo.key.prefix, role: keyInfo.key.role },
    meta: { api_url: cfg.apiUrl, scopes: keyInfo.scopes },
  });
}

main().catch((err) => {
  process.stderr.write(`exp-mcp: fatal ${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
  process.exit(1);
});
