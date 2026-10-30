# Sobe uma atualizacao: testa, envia ao GitHub e manda o servidor atualizar (painel + worker).
# Uso (PowerShell, na pasta do projeto):
#   .\deploy\servidor\subir.ps1                      # commit automatico + push + atualiza o servidor
#   .\deploy\servidor\subir.ps1 "minha mensagem"     # com mensagem de commit
#   .\deploy\servidor\subir.ps1 -SemTestes           # pula os testes
#   .\deploy\servidor\subir.ps1 -SoServidor          # nao faz commit/push; so manda o servidor atualizar
#   .\deploy\servidor\subir.ps1 -Forcar              # reconstrui o painel e o worker mesmo sem novidade
# Requer: git, node e acesso SSH ao servidor (chave). Migracoes SQL continuam manuais (o script avisa).
param(
  [string]$Mensagem = "",
  [string]$Servidor = "ubuntu@137.131.204.59",
  [string]$Pasta = "/mnt/data/apps/central-promocoes",
  [switch]$SemTestes, [switch]$SoServidor, [switch]$Forcar
)
$ErrorActionPreference = "Stop"
Set-Location (Resolve-Path (Join-Path $PSScriptRoot "..\.."))
function Passo($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Roda($cmd) { & cmd /c $cmd; if ($LASTEXITCODE -ne 0) { throw "Falhou: $cmd" } }

if (-not $SoServidor) {
  if (-not $SemTestes) {
    Passo "Testes do worker"; Roda "node scripts/worker-test.mjs"
    Passo "Typecheck e testes do painel"; Push-Location admin; try { Roda "npx tsc --noEmit"; Roda "npx vitest run" } finally { Pop-Location }
  }
  Passo "Git"
  git add -A
  if (git status --porcelain) {
    if (-not $Mensagem) { $Mensagem = "update " + (Get-Date -Format "yyyy-MM-dd HH:mm") }
    git commit -m $Mensagem
    if ($LASTEXITCODE -ne 0) { throw "git commit falhou" }
  } else { Write-Host "Nada novo para commitar." }
  $novasMig = git diff --name-only "origin/main..HEAD" -- db/migrations 2>$null
  git push origin HEAD:main
  if ($LASTEXITCODE -ne 0) { throw "git push falhou" }
  if ($novasMig) { Write-Host "`nATENCAO: ha migracoes novas. Aplique no SQL Editor do Supabase, em ordem:" -ForegroundColor Yellow; $novasMig | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow } }
}

Passo "Atualizando o servidor ($Servidor)"
$flag = ""; if ($Forcar) { $flag = "--force" }
ssh -o BatchMode=yes $Servidor "cd $Pasta && ./deploy/servidor/atualizar.sh $flag; echo; tail -n 6 deploy/servidor/atualizar.log; echo; docker ps --filter name=promo- --format '{{.Names}}: {{.Status}}'"
if ($LASTEXITCODE -ne 0) { throw "A atualizacao no servidor falhou. Veja: ssh $Servidor tail -n 50 $Pasta/deploy/servidor/atualizar.log" }
Write-Host "`nPronto." -ForegroundColor Green
