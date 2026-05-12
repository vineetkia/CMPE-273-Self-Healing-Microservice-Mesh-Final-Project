#!/usr/bin/env bash
# Verifies the system is up and a basic order can be placed.
set -euo pipefail

GW=${GATEWAY_URL:-http://localhost:8080}
HEALER=${HEALER_URL:-http://localhost:8090}

echo "[1/5] gateway health"
curl -fsS "$GW/health" >/dev/null

echo "[2/5] all services discovered"
curl -fsS "$GW/topology" | grep -q '"order"'

echo "[3/5] login"
TOKEN=$(curl -fsS -X POST "$GW/login" -H 'Content-Type: application/json' -d '{"user":"demo","password":"x"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')
echo "  token=$TOKEN"

echo "[4/5] place order"
RESULT=$(curl -fsS -X POST "$GW/orders" -H 'Content-Type: application/json' -d "{\"token\":\"$TOKEN\",\"sku\":\"sku-1\",\"qty\":1}")
echo "  $RESULT"
echo "$RESULT" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true'

echo "[5/5] healer reachable"
curl -fsS "$HEALER/health" >/dev/null

echo "OK"
