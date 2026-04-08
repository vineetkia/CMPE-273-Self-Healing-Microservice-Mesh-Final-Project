#!/usr/bin/env bash
set -euo pipefail

RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-mesh-aca-rg}"

az group delete --name "$RESOURCE_GROUP" --yes
