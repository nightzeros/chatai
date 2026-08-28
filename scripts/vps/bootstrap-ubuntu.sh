#!/usr/bin/env bash
# Bootstrap a fresh Ubuntu 24.04 VPS for ChatAI production.
# Run as root on first login. Does NOT contain secrets or SSH keys.
#
# Usage (on VPS):
#   curl -fsSL https://raw.githubusercontent.com/master-tecs/chatai/main/scripts/vps/bootstrap-ubuntu.sh | bash
#   # or copy from repo and run locally:
#   sudo bash scripts/vps/bootstrap-ubuntu.sh
#
# Optional env:
#   DEPLOY_USER=deploy
#   DEPLOY_DIR=/opt/chatai
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_DIR="${DEPLOY_DIR:-/opt/chatai}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "[bootstrap] Run as root (sudo)." >&2
  exit 1
fi

echo "[bootstrap] Updating packages…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get upgrade -y

echo "[bootstrap] Installing base packages…"
apt-get install -y \
  ca-certificates \
  curl \
  gnupg \
  lsb-release \
  ufw \
  unattended-upgrades \
  apt-listchanges

echo "[bootstrap] Enabling unattended security upgrades…"
dpkg-reconfigure -plow unattended-upgrades || true

if ! id "$DEPLOY_USER" &>/dev/null; then
  echo "[bootstrap] Creating user ${DEPLOY_USER}…"
  adduser --disabled-password --gecos "" "$DEPLOY_USER"
  usermod -aG sudo "$DEPLOY_USER"
  echo "[bootstrap] Add your SSH public key to /home/${DEPLOY_USER}/.ssh/authorized_keys before disabling password auth."
fi

echo "[bootstrap] Hardening SSH (disable root login; keep password auth until keys confirmed)…"
sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
if grep -q '^PasswordAuthentication' /etc/ssh/sshd_config; then
  :
else
  echo "PasswordAuthentication yes" >>/etc/ssh/sshd_config
fi
systemctl reload ssh || systemctl reload sshd || true

echo "[bootstrap] Configuring UFW (22, 80, 443)…"
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "[bootstrap] Installing Docker…"
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "${VERSION_CODENAME}") stable" \
  >/etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker "$DEPLOY_USER"

echo "[bootstrap] Creating ${DEPLOY_DIR}…"
mkdir -p "$DEPLOY_DIR/backups"
chown -R "${DEPLOY_USER}:${DEPLOY_USER}" "$DEPLOY_DIR"

echo "[bootstrap] Done."
echo "[bootstrap] Next steps:"
echo "  1. Add SSH key for ${DEPLOY_USER}"
echo "  2. Confirm SSH login as ${DEPLOY_USER}, then disable password auth:"
echo "     sudo sed -i 's/^PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config"
echo "     sudo systemctl reload ssh"
echo "  3. Clone repo or copy compose/scripts to ${DEPLOY_DIR}"
echo "  4. Create ${DEPLOY_DIR}/.env.production (chmod 600)"
echo "  5. docker login ghcr.io (read-only PAT for ghcr.io/master-tecs/chatai)"
echo "  6. Point DNS: app.nightzeros.com → this VPS (Cloudflare DNS-only / grey cloud)"
echo "  7. Deploy with CHATAI_IMAGE_TAG=<tag> ./scripts/deploy.sh"
