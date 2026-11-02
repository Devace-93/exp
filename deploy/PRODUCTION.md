# Production runbook

exp runs on the same Hetzner box as the 3m4 shortener (`/opt/3m4`). That stack's
Caddy owns ports 80/443, so exp is deployed as a second docker compose project
without its own Caddy, and the 3m4 Caddy routes `exp.3m4.net` to it.

**Already deployed before the accounts migration?** Append these to `.env` and rebuild
(the public accounts URL is baked into the web bundle at build time):

```
ACCOUNTS_URL=https://accounts.3m4.net
ACCOUNTS_INTERNAL_URL=http://accounts-api-1:5000
VITE_ACCOUNTS_URL=https://accounts.3m4.net
PROTOCOL_HEADER=x-forwarded-proto
```
then `docker compose --env-file ../.env -f docker-compose.yml -f docker-compose.prod.yml up -d --build web api`
from `deploy/`. Without `ACCOUNTS_URL` the API rejects every session (issuer mismatch);
without `PROTOCOL_HEADER` the login redirect carries an `http://` return address that
accounts refuses, so users land on their profile instead of the dashboard.

## First-time setup

1. **Shared network** (once per server):
   ```sh
   docker network create edge
   ```
2. **Clone + configure**
   ```sh
   git clone git@github.com:Devace-93/exp.git /opt/exp
   cd /opt/exp && cp .env.example .env && $EDITOR .env
   ```
   Prod `.env` checklist: `APP_BASE_URL=https://exp.3m4.net`,
   `DASHBOARD_URL=https://exp.3m4.net`, `VITE_API_URL=/api`,
   `VITE_APP_URL=https://exp.3m4.net`, `ACCOUNTS_URL=https://accounts.3m4.net`,
   `ACCOUNTS_INTERNAL_URL=http://accounts-api-1:5000`, `VITE_ACCOUNTS_URL=https://accounts.3m4.net`
   (the accounts stack must be up on the `edge` network first), PostHog keys
   (`POSTHOG_API_KEY`, `POSTHOG_PERSONAL_API_KEY`, `VITE_POSTHOG_KEY`; flags are
   prefixed `exp-` in the shared PostHog project), the payments portal set
   (see **Billing** below), a fresh Postgres password (also in `DATABASE_URL`).
3. **Start**
   ```sh
   cd /opt/exp/deploy
   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
   ```
4. **Edge routing** — in `/opt/3m4`:
   - `deploy/docker-compose.prod.yml`: attach the `caddy` service to the external
     `edge` network.
   - `deploy/Caddyfile.prod`: add
     ```
     exp.3m4.net {
     	handle /api/* { reverse_proxy exp-api-1:5000 }
     	handle /mcp*  { reverse_proxy exp-mcp-1:3333 }
     	handle        { reverse_proxy exp-web-1:3000 }
     }
     ```
   - `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate caddy`
5. **DNS (Bluehost)**: A record `exp.3m4.net` → server IP. Caddy issues TLS
   automatically once DNS resolves.
6. **Backups**: add `/opt/exp/deploy/backup.sh` to the same crontab as 3m4.
7. Or do steps 2–3 with `deploy/first-deploy.sh` (idempotent).
8. **Deploy-on-push**: in the GitHub repo set secrets `DEPLOY_HOST` and
   `DEPLOY_SSH_KEY`, and repo variable `DEPLOY_ENABLED=true`. After that every
   push to master redeploys via `.github/workflows/deploy.yml`.

## Billing (payments.3m4.net)

exp never calls Stripe. The portal at `/opt/payments` owns checkout, the
Customer Portal, receipts and donations; exp only sends users there,
receives its signed push webhooks and pulls entitlements with a service key.
Both stacks talk over the shared `edge` network by container name
(`payments-api-1`, `exp-api-1`), so nothing is exposed publicly.

1. **App key on the payments box** (once; prints the two secrets a single
   time — rotate by running it again):
   ```sh
   cd /opt/payments && make app-key SLUG=exp WEBHOOK_URL=http://exp-api-1:5000/api/billing/webhook
   ```
2. **exp `.env`**:
   ```
   BILLING_ENABLED=true
   PAYMENTS_URL=https://payments.3m4.net
   PAYMENTS_INTERNAL_URL=http://payments-api-1:5000
   PAYMENTS_SERVICE_KEY=m4pay_sk_…          # from step 1
   PAYMENTS_WEBHOOK_SECRET=whsec_m4pay_…    # from step 1
   VITE_PAYMENTS_URL=https://payments.3m4.net
   VITE_BILLING_ENABLED=true
   ```
   then rebuild `api`, `worker` and `web` (the public URL is baked into the
   web bundle): `docker compose --env-file ../.env -f docker-compose.yml -f docker-compose.prod.yml up -d --build api worker web`.
   `api`, `worker` and `web` are on `edge` already (base compose); the
   `worker` service is new — it runs the daily reconcile.
3. **Catalog**: the products live in payments' `packages/shared/catalog.json`
   (app `exp`: `pro_monthly`, `pro_annual`, entitlement `pro`, lookup keys
   `exp_pro_monthly` / `exp_pro_annual`) and in exp's
   `packages/shared/plan_limits.json` → `price_keys`. Keep both in sync;
   `team` has no product yet, so its Upgrade button is disabled.
4. **Verify** (same commands locally with `http://localhost:8081` and the
   `.env` secrets; `early-access` must be OFF for the billing page to show,
   the webhook works regardless):
   ```sh
   # push: a signed subscription.updated for an identity that has signed in to exp
   SECRET=$(grep ^PAYMENTS_WEBHOOK_SECRET .env | cut -d= -f2-)
   IDENTITY=<accounts sub of a user who has opened the dashboard>
   BODY='{"id":"'$(uuidgen)'","type":"subscription.updated","created":"2026-11-01T00:00:00Z","app":"exp","identity_id":"'$IDENTITY'","email":"x@example.com","data":{"entitlements":["pro"],"subscription":{"id":"sub_test","entitlement":"pro","status":"active","current_period_end":"2027-01-01T00:00:00Z","cancel_at_period_end":false,"label":"Pro"},"payment":null,"updated_at":"2026-11-01T00:00:00Z"}}'
   TS=$(date +%s); SIG=v1=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')
   curl -s -X POST https://exp.3m4.net/api/billing/webhook -H "Content-Type: application/json" \
     -H "X-M4Pay-Timestamp: $TS" -H "X-M4Pay-Signature: $SIG" -d "$BODY"      # → {"plan":"pro","status":"ok"}
   docker exec exp-postgres-1 psql -U exp -d exp -c "select plan from accounts"         # → pro
   # pull: one reconcile run (lists the app's subscriptions changed in the last 2 days)
   make reconcile-billing                                                               # → reconciled: {'applied': n, ...}
   ```
   The same signed POST with `"entitlements":[],"subscription":null` sets the
   plan back to `free`. Real purchases: `early-access` OFF → `/dashboard/billing`
   → Upgrade opens `https://payments.3m4.net/subscribe?app=exp&price=pro_monthly`.

## Scaling

Same path as 3m4: bigger box → managed Postgres (`DATABASE_URL`) → a second
app node. The evaluation endpoints are stateless and cache-friendly; put a
short-TTL cache in front of `/api/eval/*` before anything else.
