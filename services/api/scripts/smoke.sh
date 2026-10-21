#!/usr/bin/env bash
# Walk the CONTRACT.md happy path with curl against a RUNNING stack, using a
# session from the accounts service (no passwords live in this app).
#
#   services/api/scripts/smoke.sh                               # http://localhost:8081 + http://localhost:8085
#   BASE=https://exp.3m4.net ACCOUNTS=https://accounts.3m4.net services/api/scripts/smoke.sh
#
# 1. Signs up a throwaway identity at accounts (cookie jar keeps 3m4_session).
# 2. Calls this API with the cookie: /auth/me is reachable unverified, /projects
#    is 403 email_unverified until the mailed link is followed. With Mailpit
#    (local stack) the script consumes the verification token itself.
# 3. Creates a project, an API key, and reads the project back through the key.
# Needs curl + jq.
set -euo pipefail

BASE="${BASE:-http://localhost:8081}"
ACCOUNTS="${ACCOUNTS:-http://localhost:8085}"
MAILPIT="${MAILPIT:-http://localhost:8025}"
API="$BASE/api"
EMAIL="${SMOKE_EMAIL:-smoke+$(date +%s)@example.com}"
PASSWORD="${SMOKE_PASSWORD:-Smoke-Passw0rd!}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

step() { printf '\n\033[36m▶ %s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null || { echo "missing: $1" >&2; exit 1; }; }
need curl; need jq

step "health"
curl -fsS "$API/healthz" | jq -c .

step "sign up at accounts as $EMAIL"
curl -fsS -c "$JAR" -b "$JAR" -X POST "$ACCOUNTS/api/auth/signup" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}" | jq -c '{handle: .user.handle, verified: .user.email_verified}'

step "GET /auth/me with the session cookie (allowed while unverified)"
curl -fsS -b "$JAR" "$API/auth/me" | jq -c '{handle: .user.handle, verified: .user.email_verified, account: .account.name, plan}'

step "POST /projects is refused until the e-mail is verified"
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -b "$JAR" -X POST "$API/projects" -H 'Content-Type: application/json' \
  -d '{"name":"Smoke project"}')
echo "  $CODE (expected 403)"

step "verify the e-mail through Mailpit"
TOKEN=""
for _ in $(seq 1 20); do
  TOKEN=$(curl -sS "$MAILPIT/api/v1/search?query=to:$EMAIL" | jq -r '.messages[0].ID // empty' | \
    xargs -r -I{} curl -sS "$MAILPIT/api/v1/message/{}" | jq -r '.Text // ""' | grep -oE 'verify\?token=[A-Za-z0-9_-]+' | head -1 | cut -d= -f2 || true)
  [ -n "$TOKEN" ] && break
  sleep 1
done
if [ -z "$TOKEN" ]; then
  echo "  no verification mail found at $MAILPIT (production? verify manually, then re-run with SMOKE_EMAIL)"; exit 1
fi
curl -fsS -b "$JAR" -c "$JAR" -X POST "$ACCOUNTS/api/auth/verify/consume" -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\"}" | jq -c '{verified: .user.email_verified}'
# A fresh access cookie carries email_verified=true.
curl -fsS -b "$JAR" -c "$JAR" -X POST "$ACCOUNTS/api/session/refresh" -H 'Content-Type: application/json' -d '{}' >/dev/null
echo "  session refreshed"

step "create project"
PROJECT=$(curl -fsS -b "$JAR" -X POST "$API/projects" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke project $(date +%H%M%S)\"}")
jq -c '{id, key, flag_count}' <<<"$PROJECT"
PID=$(jq -r .id <<<"$PROJECT")

step "create an API key (editor) and read the project back with it"
KEY=$(curl -fsS -b "$JAR" -X POST "$API/apikeys" -H 'Content-Type: application/json' -d '{"name":"smoke","role":"editor"}' | jq -r .key)
curl -fsS -H "X-API-Key: $KEY" "$API/projects/$PID" | jq -c '{id, key}'

step "no session, no key"
curl -sS -o /dev/null -w '  %{http_code} (expected 401)\n' "$API/projects"

step "log out at accounts; the cookie is gone"
curl -fsS -b "$JAR" -c "$JAR" -X POST "$ACCOUNTS/api/session/logout" -H 'Content-Type: application/json' -d '{}' -o /dev/null
curl -sS -o /dev/null -w '  %{http_code} (expected 401)\n' -b "$JAR" "$API/auth/me"
echo
echo "smoke ok"
