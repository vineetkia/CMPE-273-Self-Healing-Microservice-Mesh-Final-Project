#!/usr/bin/env bash
# End-to-end demo: traffic -> inject -> watch healer act -> stabilize.
set -euo pipefail
GW=${GATEWAY_URL:-http://localhost:8080}
HEALER=${HEALER_URL:-http://localhost:8090}

echo "==> Login"
TOKEN=$(curl -fsS -X POST "$GW/login" -H 'Content-Type: application/json' -d '{"user":"demo"}' | python3 -c 'import json,sys;print(json.load(sys.stdin)["token"])')

echo "==> Generating baseline traffic for 5s"
for i in $(seq 1 8); do
  curl -fsS -X POST "$GW/orders" -H 'Content-Type: application/json' \
       -d "{\"token\":\"$TOKEN\",\"sku\":\"sku-1\",\"qty\":1}" >/dev/null &
  sleep 0.6
done
wait

echo "==> Injecting failure on inventory"
bash "$(dirname "$0")/inject_failure.sh" inventory errors 0.7 0 45

echo "==> Generating traffic during failure (20s)"
for i in $(seq 1 25); do
  curl -fsS -X POST "$GW/orders" -H 'Content-Type: application/json' \
       -d "{\"token\":\"$TOKEN\",\"sku\":\"sku-1\",\"qty\":1}" || true
  echo
  sleep 0.8
done

echo "==> Healer state:"
curl -fsS "$HEALER/state" | python3 -m json.tool | head -60

echo "==> Done. Open http://localhost:5173 for the dashboard."
