#!/usr/bin/env bash
# Atualiza o painel no servidor quando há commit novo no GitHub.
# Uso:  ./atualizar.sh            -> só age se houver novidade
#       ./atualizar.sh --force    -> rebuild mesmo sem novidade
# Variáveis opcionais: BRANCH (padrão main), COMPOSE_ENV (padrão deploy/admin.env)
set -Eeuo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BRANCH="${BRANCH:-main}"
ENVF="${COMPOSE_ENV:-$DIR/deploy/admin.env}"
LOG="${LOG:-$DIR/deploy/servidor/atualizar.log}"
FORCE=0; [[ "${1:-}" == "--force" ]] && FORCE=1
exec 9>"/tmp/promo-atualizar.lock"
flock -n 9 || { echo "Outra atualização em andamento."; exit 0; }
log() { echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }
cd "$DIR"
[[ -f "$ENVF" ]] || { log "ERRO: falta $ENVF (copie deploy/admin.env.example e preencha)"; exit 1; }
git fetch --quiet origin "$BRANCH"
LOCAL="$(git rev-parse HEAD)"; REMOTO="$(git rev-parse "origin/$BRANCH")"
if [[ "$LOCAL" == "$REMOTO" && $FORCE -eq 0 ]]; then exit 0; fi
log "Atualizando ${LOCAL:0:7} -> ${REMOTO:0:7}"
git merge --ff-only "origin/$BRANCH" >>"$LOG" 2>&1 || { log "ERRO: o servidor tem alterações locais divergentes; resolva manualmente (git status)."; exit 1; }
PN="$(grep -E '^NPM_NETWORK=' "$ENVF" | cut -d= -f2- || true)"; PN="${PN:-hubly-network}"
docker network inspect "$PN" >/dev/null 2>&1 || { log "ERRO: rede Docker '$PN' (a do Nginx Proxy Manager) não existe"; exit 1; }
COMPOSE="${COMPOSE_FILE:-deploy/docker-compose.oracle.yml}"; [[ -f "$COMPOSE" ]] || COMPOSE="deploy/docker-compose.admin.yml"
docker compose -f "$COMPOSE" --env-file "$ENVF" up -d --build >>"$LOG" 2>&1 || { log "ERRO no build. Versão anterior segue no ar se o build falhou antes do 'up'. Veja $LOG"; exit 1; }
# Worker: só sobe se deploy/worker/worker.env existir. Falha aqui não derruba o painel.
WENV="$DIR/deploy/worker/worker.env"
if [[ -f "$WENV" && -f deploy/docker-compose.worker.yml ]]; then
  if docker compose -f deploy/docker-compose.worker.yml --env-file "$ENVF" up -d --build >>"$LOG" 2>&1; then
    w=none; for i in {1..20}; do w="$(docker inspect -f '{{.State.Health.Status}}' promo-worker 2>/dev/null || echo none)"; [[ "$w" == "healthy" ]] && break; sleep 3; done
    [[ "$w" == "healthy" ]] && log "OK: worker saudável" || log "AVISO: promo-worker não ficou 'healthy' (estado: $w). Veja: docker logs promo-worker"
  else log "AVISO: erro ao subir o worker. Veja $LOG"; fi
fi
for i in {1..20}; do
  s="$(docker inspect -f '{{.State.Health.Status}}' promo-admin 2>/dev/null || echo none)"
  [[ "$s" == "healthy" ]] && { log "OK: painel saudável em $(git rev-parse --short HEAD)"; docker image prune -f >/dev/null 2>&1 || true; exit 0; }
  sleep 3
done
log "AVISO: container não ficou 'healthy' (estado: $s). Veja: docker logs promo-admin"; exit 1
