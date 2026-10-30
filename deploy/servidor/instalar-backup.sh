#!/usr/bin/env bash
# Agenda o backup diário do Supabase (03:40). Rode UMA vez no servidor: sudo ./instalar-backup.sh
set -Eeuo pipefail
[[ $EUID -eq 0 ]] || { echo "Rode com sudo."; exit 1; }
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; USR="${SUDO_USER:-ubuntu}"
chmod +x "$DIR/deploy/servidor/backup-supabase.sh"
cat >/etc/systemd/system/promo-backup.service <<EOF
[Unit]
Description=Backup do banco do Supabase (Central de Promocoes)
After=docker.service
[Service]
Type=oneshot
User=$USR
ExecStart=/bin/bash $DIR/deploy/servidor/backup-supabase.sh
EOF
cat >/etc/systemd/system/promo-backup.timer <<EOF
[Unit]
Description=Backup diario do Supabase
[Timer]
OnCalendar=*-*-* 03:40:00
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl daemon-reload && systemctl enable --now promo-backup.timer
echo "Pronto. Teste agora: sudo -u $USR bash $DIR/deploy/servidor/backup-supabase.sh   |   systemctl list-timers promo-backup.timer"
