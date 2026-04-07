#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-mesh-demo-rg}"

az group delete \
  --name "$RESOURCE_GROUP" \
  --yes
