# Roda no SEU PowerShell. Diagnostica o servidor por SSH e, com -Corrigir, clona/atualiza o projeto, sobe o painel e instala o auto-update.
#   .\deploy\servidor\diagnosticar-servidor.ps1             -> só diagnostica
#   .\deploy\servidor\diagnosticar-servidor.ps1 -Corrigir   -> instala/sobe o painel (pede a URL e a chave ANON do Supabase)
param([string]$Servidor = "ubuntu@137.131.204.59", [string]$Dominio = "promocoes.hubly.software", [string]$AppDir = "/mnt/data/apps/central-promocoes",
      [string]$Repo = "git@github.com:Lucasmagista/central-promocoes-afiliados.git", [switch]$Corrigir)
$ip = $Servidor.Split("@")[-1]
Write-Host "== Do seu PC: portas públicas do servidor ==" -ForegroundColor Cyan
foreach ($p in 80, 443) { $r = Test-NetConnection $ip -Port $p -WarningAction SilentlyContinue; "{0}:{1} aberta={2}" -f $ip, $p, $r.TcpTestSucceeded }
$sup = ""; $key = ""
if ($Corrigir) {
  Write-Host "(Se o servidor já tem deploy/admin.env, pode deixar em branco: Enter)" -ForegroundColor DarkGray
  $sup = (Read-Host "VITE_SUPABASE_URL (https://xxxx.supabase.co)").Trim().Replace("'", "")
  $key = (Read-Host "VITE_SUPABASE_ANON_KEY (chave ANON/pública, NUNCA a service_role)").Trim().Replace("'", "")
}
$cab = "CORRIGIR=$(if ($Corrigir) {1} else {0}); DOM='$Dominio'; DIR='$AppDir'; REPO='$Repo'; SUPA='$sup'; KEY='$key'`n"
$remoto = @'
echo "== Projeto no servidor =="
echo "DIR=$DIR"; [ -d "$DIR/.git" ] && echo "clone git: sim" || echo "clone git: NÃO"
echo; echo "== Painel (promo-admin) =="; docker ps -a --filter name=promo-admin --format '{{.Names}} {{.Status}}' | grep . || echo "container promo-admin NÃO existe"
echo; echo "== Rede do Nginx Proxy Manager =="; docker inspect npm --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null; ls -la "$DIR/deploy/admin.env" 2>&1 | head -1
echo; echo "== TLS local =="; curl -skv --max-time 8 --resolve $DOM:443:127.0.0.1 https://$DOM/ -o /dev/null 2>&1 | grep -E 'issuer:|expire|alert|HTTP/' | head -5
if [ "$CORRIGIR" = "1" ]; then
  echo; echo "== CORRIGINDO =="
  mkdir -p "$DIR"; cd "$DIR"
  # Repositório privado: usa uma chave de deploy (somente leitura) criada no servidor.
  K="$HOME/.ssh/deploy_central"; mkdir -p "$HOME/.ssh"; chmod 700 "$HOME/.ssh"
  [ -f "$K" ] || ssh-keygen -t ed25519 -N "" -C "deploy-central@oracle" -f "$K" -q
  ssh-keyscan -t ed25519 github.com 2>/dev/null >> "$HOME/.ssh/known_hosts"
  [ -d .git ] || { git init -q -b main; }
  git remote get-url origin >/dev/null 2>&1 && git remote set-url origin "$REPO" || git remote add origin "$REPO"
  git config core.sshCommand "ssh -i $K -o IdentitiesOnly=yes"
  if git fetch -q origin main 2>/dev/null; then
    git reset -q --hard origin/main   # não toca em deploy/admin.env (não versionado)
  else
    echo; echo "!! O servidor ainda não tem acesso ao GitHub. Cadastre esta chave em:"
    echo "   GitHub > repositório > Settings > Deploy keys > Add deploy key (deixe 'Allow write' DESMARCADO):"; echo; cat "$K.pub"; echo
    echo "   Depois rode este script de novo com -Corrigir. (Seguindo com os arquivos já enviados pelo Codex.)"
  fi
  if [ ! -f "$DIR/deploy/admin.env" ]; then printf 'VITE_SUPABASE_URL=%s\nVITE_SUPABASE_ANON_KEY=%s\nNPM_NETWORK=hubly-network\nPROXY_NETWORK=hubly-network\n' "$SUPA" "$KEY" > "$DIR/deploy/admin.env"; chmod 600 "$DIR/deploy/admin.env"; fi
  if [ -f "$DIR/deploy/servidor/atualizar.sh" ] && [ -d "$DIR/.git" ] && git -C "$DIR" rev-parse -q --verify origin/main >/dev/null; then
    bash "$DIR/deploy/servidor/atualizar.sh" --force && sudo bash "$DIR/deploy/servidor/instalar-auto-update.sh"
  else
    bash "$DIR/scripts/deploy-oracle.sh"   # caminho do Codex: sobe o painel com os arquivos já enviados
  fi
  docker ps --filter name=promo-admin --format '{{.Names}} {{.Status}}'
  echo "Agora no NPM: Proxy Host $DOM -> http, promo-admin, porta 80 (rede hubly-network) + certificado (veja docs/10)."
fi
'@
($cab + $remoto) | ssh -o ConnectTimeout=10 $Servidor "tr -d '\r' > /tmp/promo-diag.sh; bash /tmp/promo-diag.sh </dev/null; rm -f /tmp/promo-diag.sh"
