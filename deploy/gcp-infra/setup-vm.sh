#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  sudo apt-get update
  sudo apt-get install -y ca-certificates curl gnupg
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

sudo mkdir -p /opt/mesh-infra
sudo cp docker-compose.yml /opt/mesh-infra/docker-compose.yml

if [ ! -f /opt/mesh-infra/.env ]; then
  NATS_PASSWORD="$(openssl rand -hex 24)"
  printf "NATS_USER=mesh\nNATS_PASSWORD=%s\n" "$NATS_PASSWORD" | sudo tee /opt/mesh-infra/.env >/dev/null
fi

sudo docker compose --env-file /opt/mesh-infra/.env -f /opt/mesh-infra/docker-compose.yml up -d

echo "Infra started."
echo "Use these values in Render:"
echo "ETCD_HOST=<THIS_VM_EXTERNAL_IP>"
echo "ETCD_PORT=2379"
echo "NATS_URL=nats://mesh:$(sudo awk -F= '/NATS_PASSWORD/ {print $2}' /opt/mesh-infra/.env)@<THIS_VM_EXTERNAL_IP>:4222"
