#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-mesh-aca-rg}"
APPS=(etcd nats jaeger otelcollector auth order inventory notification payments fraud shipping recommendation gateway healer frontend prometheus)

for app in "${APPS[@]}"; do
  if az containerapp show --name "$app" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
    echo "Starting ${app}"
    az containerapp update --name "$app" --resource-group "$RESOURCE_GROUP" --min-replicas 1 --max-replicas 1 -o none
  fi
done

echo "Container Apps scaled back to one replica."
