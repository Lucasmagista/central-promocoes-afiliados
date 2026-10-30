#!/usr/bin/env bash
# Instala um timer (systemd) que roda atualizar.sh a cada minuto. Rode UMA vez no servidor: sudo ./instalar-auto-update.sh
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo "Rode com sudo."; exit 1; }
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
USR="${SUDO_USER:-ubuntu}"
chmod +x "$DIR/deploy/servidor/atualizar.sh"
cat >/etc/systemd/system/promo-atualizar.service <<EOF
[Unit]
Description=Atualiza o painel Central de Promoções a partir do GitHub
After=network-online.target docker.service
[Service]
Type=oneshot
User=$USR
ExecStart=/bin/bash $DIR/deploy/servidor/atualizar.sh
EOF
cat >/etc/systemd/system/promo-atualizar.timer <<EOF
[Unit]
Description=Verifica novidades no GitHub a cada minuto
[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=10s
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload
systemctl enable --now promo-atualizar.timer
echo "Pronto. Acompanhe: tail -f $DIR/deploy/servidor/atualizar.log   |   systemctl list-timers promo-atualizar.timer"
