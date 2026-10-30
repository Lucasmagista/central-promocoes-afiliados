#!/usr/bin/env bash
# Guarda as conexões do WhatsApp (Evolution) e do Telegram no arquivo SEGURO do worker (deploy/worker/worker.env),
# para o painel nunca pedir endereço, instância nem chave: ele só mostra os botões "Conectar".
#
# Uso (no servidor, na pasta do projeto):
#   bash deploy/servidor/configurar-conexoes.sh               # pergunta o que estiver faltando
#   bash deploy/servidor/configurar-conexoes.sh --importar    # copia o que já está guardado no banco (Supabase) para o arquivo
#   bash deploy/servidor/configurar-conexoes.sh --status      # mostra o que está configurado (sem mostrar segredos)
#   (acrescente --forcar para sobrescrever valores que já estão no arquivo)
set -Eeuo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENVF="$DIR/deploy/worker/worker.env"
MODE="perguntar"; FORCE=0
for a in "$@"; do case "$a" in --importar) MODE="importar";; --status) MODE="status";; --forcar) FORCE=1;; *) echo "Opção desconhecida: $a"; exit 1;; esac; done
[[ -f "$ENVF" ]] || { echo "Falta $ENVF (crie a partir de deploy/worker/worker.env.example)."; exit 1; }
chmod 600 "$ENVF"

get()  { grep -E "^$1=" "$ENVF" | tail -1 | cut -d= -f2- || true; }
setkv(){ local k="$1" v="$2" tmp; tmp="$(mktemp)"; (grep -vE "^$k=" "$ENVF" || true) > "$tmp"; printf '%s=%s\n' "$k" "$v" >> "$tmp"; cat "$tmp" > "$ENVF"; rm -f "$tmp"; chmod 600 "$ENVF"; }
mask() { local v="$1"; if [[ -z "$v" ]]; then echo "(vazio)"; elif [[ "$2" == "secret" ]]; then echo "••••${v: -4}"; else echo "$v"; fi; }
KEYS=(EVOLUTION_BASE_URL:público EVOLUTION_INSTANCE:público EVOLUTION_API_KEY:secret TELEGRAM_BOT_TOKEN:secret PUBLIC_URL:público)

show() { echo "Conexões em $ENVF:"; for kv in "${KEYS[@]}"; do k="${kv%%:*}"; t="${kv##*:}"; printf '  %-20s %s\n' "$k" "$(mask "$(get "$k")" "$t")"; done; }
have() { [[ -n "$(get "$1")" && $FORCE -eq 0 ]]; }

if [[ "$MODE" == "status" ]]; then show; exit 0; fi

if [[ "$MODE" == "importar" ]]; then
  URL="$(get SUPABASE_URL)"; SRK="$(get SUPABASE_SERVICE_ROLE_KEY)"
  [[ -n "$URL" && -n "$SRK" ]] || { echo "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes no arquivo."; exit 1; }
  command -v python3 >/dev/null || { echo "python3 não encontrado."; exit 1; }
  OUT="$(curl -fsS -m 30 -X POST "$URL/rest/v1/rpc/get_integration_runtime" -H "apikey: $SRK" -H "Authorization: Bearer $SRK" -H 'Content-Type: application/json' -d '{}' \
    | python3 -c 'import json,sys; r=json.load(sys.stdin); e=r.get("evolution") or {}; s=r.get("secrets") or {}; m={"EVOLUTION_BASE_URL":e.get("base_url"),"EVOLUTION_INSTANCE":e.get("instance"),"EVOLUTION_API_KEY":s.get("evolution_api_key"),"TELEGRAM_BOT_TOKEN":s.get("telegram_bot_token")}; [print(k+"\t"+str(v)) for k,v in m.items() if v]')"
  n=0; while IFS=$'\t' read -r k v; do [[ -z "$k" ]] && continue; if have "$k"; then echo "  mantido  $k (já está no arquivo)"; else setkv "$k" "$v"; echo "  gravado  $k"; n=$((n+1)); fi; done <<< "$OUT"
  have PUBLIC_URL || { setkv PUBLIC_URL "https://worker.hubly.software"; echo "  gravado  PUBLIC_URL (padrão)"; }
  echo "Importados: $n."
else
  ask()  { local k="$1" label="$2" def="${3:-}" cur; cur="$(get "$k")"; if have "$k"; then echo "  $k já configurado ($(mask "$cur" público))"; return; fi
           read -r -p "$label${def:+ [$def]}: " v; v="${v:-$def}"; [[ -n "$v" ]] && setkv "$k" "$v" || true; }
  asks() { local k="$1" label="$2"; if have "$k"; then echo "  $k já configurado ($(mask "$(get "$k")" secret))"; return; fi
           read -r -s -p "$label (não aparece na tela; Enter para pular): " v; echo; [[ -n "$v" ]] && setkv "$k" "$v" || true; }
  echo "WhatsApp (Evolution API)"
  ask  EVOLUTION_BASE_URL "  Endereço da Evolution" "https://whatsapp.hubly.software"
  ask  EVOLUTION_INSTANCE "  Nome da instância" "central-promo"
  asks EVOLUTION_API_KEY  "  Chave de acesso (apikey)"
  echo "Telegram"
  asks TELEGRAM_BOT_TOKEN "  Token do bot (@BotFather)"
  ask  PUBLIC_URL "  Endereço público do worker (para o webhook do Telegram)" "https://worker.hubly.software"
fi

echo; show; echo
if command -v docker >/dev/null && [[ -f "$DIR/deploy/docker-compose.worker.yml" ]]; then
  echo "Reiniciando o worker para ler o arquivo…"
  ( cd "$DIR/deploy" && docker compose -f docker-compose.worker.yml --env-file "$( [[ -f admin.env ]] && echo admin.env || echo worker/worker.env )" up -d --force-recreate ) >/dev/null 2>&1 && echo "Pronto: abra o painel → Configurações → WhatsApp e clique em “Conectar WhatsApp”." || echo "Não consegui reiniciar sozinho: rode ./deploy/servidor/atualizar.sh --force"
fi
