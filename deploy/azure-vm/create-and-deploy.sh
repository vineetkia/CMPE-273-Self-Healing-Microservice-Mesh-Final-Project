#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-mesh-demo-rg}"
LOCATION="${AZURE_LOCATION:-westus2}"
VM_NAME="${AZURE_VM_NAME:-mesh-demo-vm}"
VM_SIZE="${AZURE_VM_SIZE:-Standard_B2s}"
ADMIN_USER="${AZURE_ADMIN_USER:-azureuser}"
REMOTE_DIR="/home/${ADMIN_USER}/meshcontrol"

echo "Using:"
echo "  resource group: ${RESOURCE_GROUP}"
echo "  location:       ${LOCATION}"
echo "  vm:             ${VM_NAME}"
echo "  size:           ${VM_SIZE}"

if az group show --name "$RESOURCE_GROUP" >/dev/null 2>&1; then
  echo "Resource group ${RESOURCE_GROUP} already exists; reusing it."
else
  az group create \
    --name "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --output table
fi

IFS=' ' read -r -a RAW_LOCATION_CANDIDATES <<< "${AZURE_LOCATION_CANDIDATES:-$LOCATION westus2 westus3 centralus eastus2 eastus}"
IFS=' ' read -r -a RAW_SIZE_CANDIDATES <<< "${AZURE_VM_SIZE_CANDIDATES:-$VM_SIZE Standard_B2ms}"

LOCATION_CANDIDATES=()
for item in "${RAW_LOCATION_CANDIDATES[@]}"; do
  [[ " ${LOCATION_CANDIDATES[*]} " == *" ${item} "* ]] || LOCATION_CANDIDATES+=("$item")
done

SIZE_CANDIDATES=()
for item in "${RAW_SIZE_CANDIDATES[@]}"; do
  [[ " ${SIZE_CANDIDATES[*]} " == *" ${item} "* ]] || SIZE_CANDIDATES+=("$item")
done

VM_CREATED="false"
for TRY_LOCATION in "${LOCATION_CANDIDATES[@]}"; do
  for TRY_SIZE in "${SIZE_CANDIDATES[@]}"; do
    echo "Trying VM create in ${TRY_LOCATION} with ${TRY_SIZE}..."
    if az vm create \
      --resource-group "$RESOURCE_GROUP" \
      --name "$VM_NAME" \
      --location "$TRY_LOCATION" \
      --image Ubuntu2204 \
      --size "$TRY_SIZE" \
      --admin-username "$ADMIN_USER" \
      --generate-ssh-keys \
      --public-ip-sku Standard \
      --output table; then
      LOCATION="$TRY_LOCATION"
      VM_SIZE="$TRY_SIZE"
      VM_CREATED="true"
      break 2
    fi
  done
done

if [ "$VM_CREATED" != "true" ]; then
  echo "Could not create an Azure VM with the candidate regions/sizes." >&2
  exit 1
fi

PRIORITY=1000
for PORT in 22 8080 8081 8090 16686 9090; do
  az vm open-port \
    --resource-group "$RESOURCE_GROUP" \
    --name "$VM_NAME" \
    --port "$PORT" \
    --priority "$PRIORITY" \
    --output none || true
  PRIORITY="$((PRIORITY + 10))"
done

IP="$(az vm show \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --show-details \
  --query publicIps \
  --output tsv)"

echo "Waiting for SSH on ${IP}..."
for _ in {1..60}; do
  if ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 "${ADMIN_USER}@${IP}" "true" >/dev/null 2>&1; then
    break
  fi
  sleep 5
done

echo "Installing Docker on VM..."
ssh -o StrictHostKeyChecking=no "${ADMIN_USER}@${IP}" 'bash -s' < "$(dirname "$0")/install-docker.sh"

echo "Copying project to VM..."
tar \
  --exclude='.git' \
  --exclude='frontend/node_modules' \
  --exclude='frontend/dist' \
  --exclude='node_modules' \
  --exclude='__pycache__' \
  --exclude='.pytest_cache' \
  -czf /tmp/meshcontrol-deploy.tgz .

ssh "${ADMIN_USER}@${IP}" "mkdir -p '${REMOTE_DIR}'"
scp /tmp/meshcontrol-deploy.tgz "${ADMIN_USER}@${IP}:/tmp/meshcontrol-deploy.tgz"
ssh "${ADMIN_USER}@${IP}" "tar -xzf /tmp/meshcontrol-deploy.tgz -C '${REMOTE_DIR}'"

echo "Starting Docker Compose stack..."
ssh "${ADMIN_USER}@${IP}" "cd '${REMOTE_DIR}' && docker compose up --build -d"

echo
echo "Azure deployment started."
echo "Frontend:   http://${IP}:8080"
echo "Gateway:    http://${IP}:8081"
echo "Healer API: http://${IP}:8090"
echo "Jaeger:     http://${IP}:16686"
echo "Prometheus: http://${IP}:9090"
echo
echo "Google OAuth production/local-demo settings:"
echo "Authorized JavaScript origin: http://${IP}:8080"
echo "Authorized redirect URI:      http://${IP}:8080/auth/google/callback"
