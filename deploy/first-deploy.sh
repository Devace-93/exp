#!/usr/bin/env bash
# First production deploy of exp on the 3m4 box. Run ON THE SERVER as root:
#   bash /opt/exp/deploy/first-deploy.sh
# or from your machine:
#   ssh root@<server> 'bash -s' < deploy/first-deploy.sh
#
# Idempotent: re-running keeps an existing .env and just rebuilds/restarts.
# Prerequisites (already true on the 3m4 box): /opt/exp cloned, `edge` network
# created, 3m4's Caddyfile.prod has the exp.3m4.net block.
set -euo pipefail

cd /opt/exp
git pull -q --ff-only

if [ ! -f .env ]; then
  cp .env.example .env
  set_var() { sed -i "s|^$1=.*|$1=$2|" .env; grep -q "^$1=" .env || echo "$1=$2" >> .env; }
  # Reuse a value from the 3m4 stack's env (same PostHog project; exp prefixes its flag keys).
  from3m4() { v=$(grep -E "^$1=" /opt/3m4/.env | head -1 | cut -d= -f2-); set_var "$2" "$v"; }

  set_var ACCOUNTS_URL https://accounts.3m4.net
  set_var ACCOUNTS_INTERNAL_URL http://accounts-api-1:5000
  set_var VITE_ACCOUNTS_URL https://accounts.3m4.net
  set_var PROTOCOL_HEADER x-forwarded-proto
  set_var REVENUECAT_WEBHOOK_AUTH_TOKEN "$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
  set_var APP_BASE_URL https://exp.3m4.net
  set_var DASHBOARD_URL https://exp.3m4.net
  # Billing stays off until exp has its own RevenueCat products; early access hides it anyway.
  set_var BILLING_ENABLED false
  set_var VITE_BILLING_ENABLED false
  set_var VITE_API_URL /api
  set_var VITE_APP_URL https://exp.3m4.net
  from3m4 POSTHOG_API_KEY POSTHOG_API_KEY
  from3m4 POSTHOG_PERSONAL_API_KEY POSTHOG_PERSONAL_API_KEY
  from3m4 POSTHOG_HOST POSTHOG_HOST
  from3m4 VITE_POSTHOG_KEY VITE_POSTHOG_KEY
  from3m4 VITE_POSTHOG_HOST VITE_POSTHOG_HOST
  chmod 600 .env
  echo "✓ .env written"
fi

cd deploy
docker compose --env-file ../.env -f docker-compose.yml -f docker-compose.prod.yml up -d --build --remove-orphans
docker image prune -f >/dev/null

echo "--- status"
docker compose --env-file ../.env -f docker-compose.yml -f docker-compose.prod.yml ps --format '{{.Name}} {{.Status}}'
# Health through the edge Caddy (TLS needs DNS; this hits it by Host header over the docker network).
docker exec 3m4-caddy-1 wget -qO- --header 'Host: exp.3m4.net' http://localhost/api/healthz 2>/dev/null || \
  docker run --rm --network edge curlimages/curl -s http://exp-api-1:5000/api/healthz
echo
