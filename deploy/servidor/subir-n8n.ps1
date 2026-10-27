# Sobe o workflow do n8n já configurado, direto no seu servidor (importa, ativa e reinicia o n8n).
# Uso (PowerShell, na pasta do projeto):  .\deploy\servidor\subir-n8n.ps1
# A chave service_role é pedida na hora, só vai para o servidor (arquivo temporário apagado em seguida) e não fica neste repositório.
param([string]$Servidor = "ubuntu@137.131.204.59", [string]$Container = "n8n-n8n-1", [string]$WorkflowId = "f8PkCAQNba6ZaptH",
      [string]$SupabaseUrl = "https://uspdlypmmyamctlafbfk.supabase.co")
$ErrorActionPreference = "Stop"
$arq = Join-Path $PSScriptRoot "..\n8n\00-central-completo.json"
if (-not (Test-Path $arq)) { throw "Não achei $arq" }
$u = Read-Host "URL do Supabase (Enter para $SupabaseUrl)"; if ($u.Trim()) { $SupabaseUrl = $u.Trim() }
$sec = Read-Host "Chave service_role do Supabase (Settings > API; não aparece na tela)" -AsSecureString
$key = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)).Trim()
if ($key.Length -lt 40) { throw "Chave muito curta. Cole a service_role inteira." }
$payload = $key.Split(".")
if ($payload.Count -ge 2) {
  $b = $payload[1].Replace("-", "+").Replace("_", "/"); while ($b.Length % 4) { $b += "=" }
  try { $role = ([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b)) | ConvertFrom-Json).role } catch { $role = "" }
  if ($role -eq "anon") { throw "Essa é a chave ANON. Use a service_role." }
}
$json = [IO.File]::ReadAllText($arq, [Text.Encoding]::UTF8)
$json = $json.Replace("COLE_AQUI_A_URL_DO_SUPABASE", $SupabaseUrl.TrimEnd("/")).Replace("COLE_AQUI_A_SERVICE_ROLE_KEY", $key)
$json = [regex]::Replace($json, '^\s*\{', "{`n  `"id`": `"$WorkflowId`",", 1)
$tmp = Join-Path $env:TEMP "central-n8n.json"
[IO.File]::WriteAllText($tmp, $json, (New-Object Text.UTF8Encoding($false)))
try {
  Write-Host "Enviando para o servidor..." -ForegroundColor Cyan
  scp -q $tmp "${Servidor}:/tmp/central-n8n.json"
  $remoto = @'
C=__C__; ID=__ID__
chmod 600 /tmp/central-n8n.json
docker exec -u root $C rm -f /tmp/central-n8n.json
docker cp /tmp/central-n8n.json $C:/tmp/central-n8n.json
rm -f /tmp/central-n8n.json
docker exec -u root $C chown node:node /tmp/central-n8n.json
docker exec -u root $C chmod 600 /tmp/central-n8n.json
docker exec $C n8n import:workflow --input=/tmp/central-n8n.json 2>&1 | tail -3
docker exec -u root $C rm -f /tmp/central-n8n.json
docker exec $C n8n publish:workflow --id=$ID 2>&1 | tail -2 || true
docker exec $C n8n update:workflow --id=$ID --active=true 2>&1 | tail -2 || true
docker restart $C >/dev/null && echo "n8n reiniciado"
sleep 12
docker ps --filter name=$C --format '{{.Names}} {{.Status}}'
'@
  $remoto = $remoto.Replace("__C__", $Container).Replace("__ID__", $WorkflowId).Replace("`r", "")
  $remoto | ssh $Servidor "tr -d '\r' > /tmp/subir-n8n.sh; bash /tmp/subir-n8n.sh </dev/null; rm -f /tmp/subir-n8n.sh"
} finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
Write-Host "`nPronto. No n8n, abra o workflow, confirme que está 'Active' e rode: Painel > Configurações > n8n > Rodar autoteste." -ForegroundColor Green
