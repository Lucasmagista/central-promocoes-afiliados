param(
  [string]$HostName = '137.131.204.59',
  [string]$UserName = 'ubuntu',
  [string]$RemotePath = '/mnt/data/apps/central-promocoes'
)

$ErrorActionPreference = 'Stop'
$archive = Join-Path $env:TEMP 'central-promocoes-release.tgz'
Remove-Item -LiteralPath $archive -ErrorAction SilentlyContinue

tar.exe -czf $archive --exclude=.env --exclude=.env.local --exclude=node_modules --exclude=_to_delete --exclude=dist --exclude=.git .
try {
  ssh "$UserName@$HostName" "sudo install -d -o $UserName -g $UserName -m 0750 '$RemotePath'"
  scp $archive "${UserName}@${HostName}:/tmp/central-promocoes-release.tgz"
  ssh "$UserName@$HostName" "tar -xzf /tmp/central-promocoes-release.tgz -C '$RemotePath' && rm -f /tmp/central-promocoes-release.tgz && chmod +x '$RemotePath/scripts/deploy-oracle.sh'"
  Write-Host "Arquivos enviados para $RemotePath. Configure deploy/admin.env no servidor e execute scripts/deploy-oracle.sh."
} finally {
  Remove-Item -LiteralPath $archive -ErrorAction SilentlyContinue
}
