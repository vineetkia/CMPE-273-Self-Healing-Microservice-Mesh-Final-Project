#!/usr/bin/env bash
set -euo pipefail
GW=${GATEWAY_URL:-http://localhost:8080}
SVC=${1:-inventory}
MODE=${2:-errors}        # errors | latency | grey | none
RATE=${3:-0.6}
LAT=${4:-1200}
DUR=${5:-60}

curl -fsS -X POST "$GW/chaos/inject" \
    -H 'Content-Type: application/json' \
    -d "{\"service\":\"$SVC\",\"mode\":\"$MODE\",\"error_rate\":$RATE,\"latency_ms\":$LAT,\"duration_s\":$DUR}"
echo
