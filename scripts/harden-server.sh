#!/usr/bin/env bash
# Idempotent host hardening for the production droplet. Safe to re-run any time
# (e.g. after rebuilding the droplet). Run as root:  bash scripts/harden-server.sh
set -euo pipefail

APP_DIR="/opt/CM-Pharmacy-API"
export DEBIAN_FRONTEND=noninteractive

echo "==> 1. Docker log rotation (stops container logs from filling the disk)"
# NOTE: this owns /etc/docker/daemon.json for this host. Merge by hand if you
# ever add other daemon settings.
install -d -m 0755 /etc/docker
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" }
}
EOF
systemctl restart docker

echo "==> 2. fail2ban (SSH brute-force protection) + unattended security upgrades"
apt-get update -qq
apt-get install -y fail2ban unattended-upgrades
systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "==> 3. Firewall: allow only SSH, HTTP, HTTPS"
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp   >/dev/null
  ufw allow 443/tcp  >/dev/null
  ufw --force enable >/dev/null
fi

echo "==> 4. Lock down the secrets file"
[ -f "${APP_DIR}/.env" ] && chmod 600 "${APP_DIR}/.env"

echo "==> 5. Restart the stack so containers pick up the new log limits"
if [ -f "${APP_DIR}/docker-compose.prod.yml" ]; then
  ( cd "${APP_DIR}" && docker compose -f docker-compose.prod.yml up -d )
fi

echo
echo "Done. fail2ban: $(systemctl is-active fail2ban) | ufw: $(ufw status | head -1)"
