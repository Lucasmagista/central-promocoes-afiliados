#!/usr/bin/env bash
# Backup diário do banco do Supabase (pg_dump) para /mnt/data/backups/supabase, mantendo os últimos 14 dias.
# Precisa de deploy/backup.env (fora do Git) com:  SUPABASE_DB_URL=postgresql://postgres:SENHA@db.SEU-PROJETO.supabase.co:5432/postgres
# (Supabase → Project Settings → Database → Connection string; use a senha do banco, NÃO a service_role).
set -Eeuo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENVF="${BACKUP_ENV:-$DIR/deploy/backup.env}"; OUT="${BACKUP_DIR:-/mnt/data/backups/supabase}"; KEEP_DAYS="${KEEP_DAYS:-14}"
[[ -f "$ENVF" ]] || { echo "Falta $ENVF (veja o cabeçalho deste script)."; exit 1; }
set -a; . "$ENVF"; set +a
[[ -n "${SUPABASE_DB_URL:-}" ]] || { echo "SUPABASE_DB_URL vazio em $ENVF"; exit 1; }
mkdir -p "$OUT"; umask 077
F="$OUT/promo-$(date +%Y%m%d-%H%M).sql.gz"
docker run --rm -e DB_URL="$SUPABASE_DB_URL" postgres:16-alpine sh -c 'pg_dump "$DB_URL" --no-owner --no-privileges --schema=public --schema=auth --exclude-table-data=auth.sessions --exclude-table-data=auth.refresh_tokens' | gzip -9 > "$F.tmp"
mv "$F.tmp" "$F"
find "$OUT" -name 'promo-*.sql.gz' -mtime +"$KEEP_DAYS" -delete
echo "Backup ok: $F ($(du -h "$F" | cut -f1))"
