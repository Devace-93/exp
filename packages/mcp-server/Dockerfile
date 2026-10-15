# exp MCP server (Streamable HTTP). Build context = repo root:
#   docker build -f packages/mcp-server/Dockerfile -t exp-mcp .
#
# Serves `POST /mcp` on :3333; Caddy exposes it at https://exp.3m4.net/mcp.
# The stdio flavour is the npm package (`npx exp-mcp`), not this image.

# ─── Build stage ──────────────────────────────────────────────────────────────
FROM oven/bun:1 AS build
WORKDIR /pkg
COPY packages/mcp-server/package.json packages/mcp-server/bun.lock* ./
RUN bun install --frozen-lockfile || bun install
COPY packages/mcp-server/tsconfig.json ./
COPY packages/mcp-server/src ./src
RUN bun run build
# Runtime deps only.
RUN rm -rf node_modules && bun install --production --frozen-lockfile || bun install --production

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    EXP_MCP_PORT=3333
COPY --from=build /pkg/package.json ./package.json
COPY --from=build /pkg/dist ./dist
COPY --from=build /pkg/node_modules ./node_modules
EXPOSE 3333
USER node
CMD ["node", "dist/http.js"]
