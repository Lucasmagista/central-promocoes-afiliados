# Roda no SEU PowerShell. Diagnostica o servidor por SSH e, com -Corrigir, clona/atualiza o projeto, sobe o painel e instala o auto-update.
#   .\deploy\servidor\diagnosticar-servidor.ps1             -> só diagnostica
#   .\deploy\servidor\diagnosticar-servidor.ps1 -Corrigir   -> instala/sobe o painel (pede a URL e a chave ANON do Supabase)
param([string]$Servidor = "ubuntu@137.131.204.59", [string]$Dominio = "promocoes.hubly.software",
      [string]$Repo = "https://github.com/Lucasmagista/central-promocoes-afiliados.git", [switch]$Corrigir)
$ip = $Servidor.Split("@")[-1]
Write-Host "== Do seu PC: portas públicas do servidor ==" -ForegroundColor Cyan
foreach ($p in 80, 443) { $r = Test-NetConnection $ip -Port $p -WarningAction SilentlyContinue; "{0}:{1} aberta={2}" -f $ip, $p, $r.TcpTestSucceeded }
$sup = ""; $key = ""
if ($Corrigir) {
  $sup = (Read-Host "VITE_SUPABASE_URL (https://xxxx.supabase.co)").Trim().Replace("'", "")
  $key = (Read-Host "VITE_SUPABASE_ANON_KEY (chave ANON/pública, NUNCA a service_role)").Trim().Replace("'", "")
}
$cab = "CORRIGIR=$(if ($Corrigir) {1} else {0}); DOM='$Dominio'; REPO='$Repo'; SUPA='$sup'; KEY='$key'`n"
$remoto = @'
echo "== Projeto no servidor =="
DIR=$(find "$HOME" /opt /srv -maxdepth 5 -name docker-compose.admin.yml -path '*deploy*' 2>/dev/null | head -1)
if [ -n "$DIR" ]; then DIR=$(dirname "$(dirname "$DIR")"); else DIR="$HOME/central-promocoes-afiliados"; fi
echo "DIR=$DIR"; [ -d "$DIR/.git" ] && echo "clone git: sim" || echo "clone git: NÃO"
echo; echo "== Painel (promo-admin) =="; docker ps -a --filter name=promo-admin --format '{{.Names}} {{.Status}}' | grep . || echo "container promo-admin NÃO existe"
echo; echo "== Rede do Nginx Proxy Manager =="; PN=$(docker inspect npm --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null | awk '{print $1}'); echo "PN=$PN"
echo; echo "== TLS local =="; curl -skv --max-time 8 --resolve $DOM:443:127.0.0.1 https://$DOM/ -o /dev/null 2>&1 | grep -E 'issuer:|expire|alert|HTTP/' | head -5
if [ "$CORRIGIR" = "1" ]; then
  echo; echo "== CORRIGINDO =="
  if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only origin main; else git clone "$REPO" "$DIR" || { echo "Falha no clone (repositório privado?)"; exit 1; }; fi
  [ -f "$DIR/deploy/servidor/atualizar.sh" ] || { echo "Faltam arquivos no GitHub: faça git push da pasta deploy/servidor e rode de novo."; exit 1; }
  if [ ! -f "$DIR/deploy/admin.env" ]; then printf 'VITE_SUPABASE_URL=%s\nVITE_SUPABASE_ANON_KEY=%s\nPROXY_NETWORK=%s\n' "$SUPA" "$KEY" "${PN:-proxy}" > "$DIR/deploy/admin.env"; chmod 600 "$DIR/deploy/admin.env"; fi
  bash "$DIR/deploy/servidor/atualizar.sh" --force
  sudo bash "$DIR/deploy/servidor/instalar-auto-update.sh"
  docker ps --filter name=promo-admin --format '{{.Names}} {{.Status}}'
  echo "Agora no NPM: Proxy Host $DOM -> http, promo-admin, porta 80 + certificado (veja docs/10)."
fi
'@
($cab + $remoto) | ssh -o ConnectTimeout=10 $Servidor "tr -d '\r' | bash -s"
