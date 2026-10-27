#!/usr/bin/env bash
# Uso: PGHOST=/tmp PGPORT=5544 PGUSER=pgtest ./run.sh
set -euo pipefail
cd "$(dirname "$0")"
DB=promo_test
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
P="psql -v ON_ERROR_STOP=1 -q -d $DB"
$P -f 00_supabase_shim.sql
for f in ../migrations/*.sql; do echo "== migração: $(basename "$f")"; $P -f "$f"; done
for t in 1*_tests*.sql; do $P -f "$t"; done
echo "== concorrência"
bash 20_concurrency.sh "$DB"
echo "TODOS OS TESTES PASSARAM"
