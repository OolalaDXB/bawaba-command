#!/usr/bin/env bash
# BAWABA — Deploy to OVHcloud VPS
# Prérequis : VPS OVHcloud (Ubuntu 22.04+)
# Usage : ./scripts/deploy-ovh.sh <IP_INSTANCE> [DOMAIN]

set -euo pipefail

IP="${1:?Usage: $0 <IP_INSTANCE> [DOMAIN]}"
USER="ubuntu"
REPO="https://github.com/OolalaDXB/bawaba-command.git"
DOMAIN="${2:-}"  # optionnel : ton domaine (ex: demo.bawaba.io)

echo "═══════════════════════════════════════════════"
echo "  BAWABA بوابة — Deploy OVHcloud"
echo "  OVHcloud · Europe · Hors Cloud Act"
echo "═══════════════════════════════════════════════"

# 1. Install Docker + Docker Compose on the instance
echo ""
echo "[1/6] Installing Docker..."
ssh -o StrictHostKeyChecking=no ${USER}@${IP} << 'REMOTE'
  # Docker
  if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com | sh
    sudo usermod -aG docker $USER
    sudo systemctl enable docker
    sudo systemctl start docker
    echo "✓ Docker installed"
  else
    echo "✓ Docker already installed"
  fi

  # Docker Compose plugin
  if ! docker compose version &> /dev/null; then
    sudo apt-get update -qq
    sudo apt-get install -y -qq docker-compose-plugin
    echo "✓ Docker Compose installed"
  else
    echo "✓ Docker Compose already installed"
  fi
REMOTE

# 2. Open firewall ports (OVHcloud VPS uses UFW)
echo ""
echo "[2/6] Configuring UFW firewall..."
ssh ${USER}@${IP} << 'REMOTE'
  sudo ufw allow 22/tcp
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw allow 8080/tcp
  sudo ufw allow 8081/tcp
  sudo ufw allow 5173/tcp
  sudo ufw --force enable
  echo "✓ UFW enabled — ports 22, 80, 443, 8080, 8081, 5173 opened"
REMOTE

# 3. Clone or update repo
echo ""
echo "[3/6] Cloning/updating repo..."
ssh ${USER}@${IP} << REMOTE
  if [ -d ~/bawaba-command ]; then
    cd ~/bawaba-command && git pull
    echo "✓ Repo updated"
  else
    git clone ${REPO} ~/bawaba-command
    echo "✓ Repo cloned"
  fi
REMOTE

# 4. Build and start
echo ""
echo "[4/6] Building and starting Bawaba..."
ssh ${USER}@${IP} << 'REMOTE'
  cd ~/bawaba-command

  # Generate Ed25519 key if not exists
  if [ ! -f configs/ed25519.key ]; then
    openssl genpkey -algorithm Ed25519 -out configs/ed25519.key 2>/dev/null
    echo "✓ Ed25519 key generated"
  fi

  # Build and start
  docker compose up --build -d

  # Wait for health
  echo "Waiting for gateway..."
  for i in $(seq 1 30); do
    if curl -sf http://localhost:8081/api/v1/health > /dev/null 2>&1; then
      echo "✓ Gateway is healthy"
      break
    fi
    sleep 2
  done
REMOTE

# 5. Optional: setup HTTPS with Let's Encrypt
if [ -n "${DOMAIN}" ]; then
  echo ""
  echo "[5/6] Setting up HTTPS for ${DOMAIN}..."
  ssh ${USER}@${IP} << REMOTE
    sudo apt-get install -y -qq certbot

    # Nginx reverse proxy
    sudo apt-get install -y -qq nginx

    sudo tee /etc/nginx/sites-available/bawaba << 'NGINX'
server {
    listen 80;
    server_name ${DOMAIN};

    location / {
        proxy_pass http://localhost:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }

    location /api/ {
        proxy_pass http://localhost:8081;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_buffering off;
        proxy_cache off;
        # SSE support
        proxy_set_header Connection '';
        chunked_transfer_encoding off;
    }
}
NGINX

    sudo ln -sf /etc/nginx/sites-available/bawaba /etc/nginx/sites-enabled/
    sudo rm -f /etc/nginx/sites-enabled/default
    sudo nginx -t && sudo systemctl reload nginx

    # SSL
    sudo certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos --email contact@bawaba.io
    echo "✓ HTTPS configured for ${DOMAIN}"
REMOTE
else
  echo ""
  echo "[5/6] Skipping HTTPS (no domain provided)"
fi

# 6. Verify and show status
echo ""
echo "[6/6] Verifying deployment..."
HEALTH=$(ssh ${USER}@${IP} "curl -sf http://localhost:8081/api/v1/health" 2>/dev/null || echo '{"status":"error"}')
echo ""
echo "═══════════════════════════════════════════════"
echo "  BAWABA بوابة — Deployment Complete"
echo "  OVHcloud · Europe · Hors Cloud Act"
echo "═══════════════════════════════════════════════"
echo ""
echo "  Health: ${HEALTH}"
echo ""
if [ -n "${DOMAIN}" ]; then
  echo "  Dashboard: https://${DOMAIN}"
  echo "  API:       https://${DOMAIN}/api/v1/health"
else
  echo "  Dashboard: http://${IP}:5173"
  echo "  API:       http://${IP}:8081/api/v1/health"
  echo "  Proxy MCP: http://${IP}:8080"
fi
echo ""
echo "  Run demo:  ssh ${USER}@${IP} 'cd ~/bawaba-command && make demo'"
echo "  Stop:      ssh ${USER}@${IP} 'cd ~/bawaba-command && docker compose down'"
echo "  Logs:      ssh ${USER}@${IP} 'cd ~/bawaba-command && docker compose logs -f'"
echo ""
echo "═══════════════════════════════════════════════"
