# exp web (Qwik City SSR on Bun).
#
# Build context is the REPO ROOT (`/home/enrique/exp`), because the app imports
# the shared plan-limits JSON from packages/shared.
#
#   docker build -f apps/web/Dockerfile -t exp-web .
#
# In deploy/docker-compose.yml this is:
#   web: { build: { context: .., dockerfile: apps/web/Dockerfile } }

# ─── Build stage ──────────────────────────────────────────────────────────────
FROM oven/bun:1 AS build
WORKDIR /repo

# Shared package (single source of truth for plan limits) is imported by the app.
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

WORKDIR /repo/apps/web
RUN bun install --frozen-lockfile || bun install

# Build-time public config. Vite inlines VITE_* at build time, so these must be
# present during `bun run build` (passed via compose build.args from .env). All
# optional — the app degrades gracefully when unset: PostHog no-ops, and the
# billing page shows a "not configured" notice instead of launching checkout.
ARG VITE_API_URL=/api
ARG VITE_APP_URL
ARG VITE_POSTHOG_KEY
ARG VITE_POSTHOG_HOST=https://us.i.posthog.com
ARG VITE_REVENUECAT_PUBLIC_KEY
ARG VITE_BILLING_ENABLED=true
ARG VITE_INFO_URL=https://info.3m4.net
ARG VITE_RETRO_PROJECT_KEY
ARG VITE_RETRO_WIDGET_URL=https://retro.3m4.net/widget.js
ENV VITE_API_URL=$VITE_API_URL \
    VITE_APP_URL=$VITE_APP_URL \
    VITE_POSTHOG_KEY=$VITE_POSTHOG_KEY \
    VITE_POSTHOG_HOST=$VITE_POSTHOG_HOST \
    VITE_REVENUECAT_PUBLIC_KEY=$VITE_REVENUECAT_PUBLIC_KEY \
    VITE_BILLING_ENABLED=$VITE_BILLING_ENABLED \
    VITE_INFO_URL=$VITE_INFO_URL \
    VITE_RETRO_PROJECT_KEY=$VITE_RETRO_PROJECT_KEY \
    VITE_RETRO_WIDGET_URL=$VITE_RETRO_WIDGET_URL
RUN bun run build

# ─── Runtime stage ────────────────────────────────────────────────────────────
FROM oven/bun:1-slim AS runtime
WORKDIR /repo/apps/web

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

# Built SSR server + client assets + deps.
COPY --from=build /repo/apps/web/server ./server
COPY --from=build /repo/apps/web/dist ./dist
COPY --from=build /repo/apps/web/node_modules ./node_modules
COPY --from=build /repo/apps/web/package.json ./package.json

EXPOSE 3000

# Start the standalone Node-API HTTP server with Bun (node:http compatible).
CMD ["bun", "./server/entry.node-server.js"]
