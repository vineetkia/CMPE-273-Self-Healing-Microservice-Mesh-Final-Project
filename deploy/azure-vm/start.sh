#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-mesh-demo-rg}"
VM_NAME="${AZURE_VM_NAME:-mesh-demo-vm}"

az vm start \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --output table

az vm show \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --show-details \
  --query "{name:name, publicIp:publicIps, powerState:powerState}" \
  --output table
