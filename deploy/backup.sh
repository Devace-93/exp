#!/usr/bin/env bash
# Nightly Postgres dump for the exp stack. Keeps 14 days.
set -euo pipefail
DIR=/opt/backups/exp
mkdir -p "$DIR"
cd /opt/exp/deploy
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U exp -d exp | gzip > "$DIR/exp-$(date +%F).sql.gz"
find "$DIR" -name 'exp-*.sql.gz' -mtime +14 -delete
