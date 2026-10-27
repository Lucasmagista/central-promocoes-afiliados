#!/usr/bin/env bash
set -euo pipefail

APP_DIR=${APP_DIR:-/mnt/data/apps/central-promocoes}
COMPOSE_FILE="$APP_DIR/deploy/docker-compose.oracle.yml"
ENV_FILE="$APP_DIR/deploy/admin.env"

test -d "$APP_DIR"
test -f "$ENV_FILE" || { echo "Ausente: $ENV_FILE" >&2; exit 1; }
docker network inspect hubly-network >/dev/null

cd "$APP_DIR"
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --build --remove-orphans
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps
docker exec promo-admin wget -qO- http://127.0.0.1/healthz
echo "Painel iniciado. No Nginx Proxy Manager, encaminhe o subdomínio para promo-admin:80 na rede hubly-network."
