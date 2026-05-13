#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-mesh-demo-rg}"
VM_NAME="${AZURE_VM_NAME:-mesh-demo-vm}"

# Deallocate stops compute billing for the VM. Storage/IP resources can still have small charges.
az vm deallocate \
  --resource-group "$RESOURCE_GROUP" \
  --name "$VM_NAME" \
  --output table
