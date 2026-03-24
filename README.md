# Self-Healing Microservice Mesh with AI-Driven Root Cause Analysis

CMPE-273 final project — a runnable distributed-systems demo that combines a gRPC
microservice mesh, full observability (OpenTelemetry → Jaeger, Prometheus, Logfire),
and a healing agent that uses an LLM (Azure GPT-5.3) to identify root causes and
apply remediation actions, with a deterministic rule-based fallback so the demo
never depends on the LLM staying up.

```
                       ┌──────────────────┐
                       │  React UI :5173  │  Mesh Control dashboard
                       └────────┬─────────┘
                                │ HTTP (REST + JSON)
                  ┌─────────────┴─────────────┐
                  ▼                           ▼
          ┌──────────────┐            ┌──────────────┐
          │ Gateway:8080 │            │ Healer :8090 │
          │  (FastAPI)   │            │  (FastAPI)   │
          └──────┬───────┘            └──────┬───────┘
                 │ gRPC                      │ gRPC (Control)
                 ▼                           │
          ┌─────────────┐                    │
          │ Order:50052 │◄───────────────────┤
          └──┬───┬───┬──┘                    │
       gRPC  │   │   │                       │
        ┌────┘   │   └────┐                  │
        ▼        ▼        ▼                  │
   ┌─────────┐ ┌────────┐ ┌─────────────┐    │
   │Auth     │ │Invento │ │Notification │◄───┤
   │:50051   │ │ry:50053│ │:50054       │    │
   └─────────┘ └────────┘ └─────────────┘    │
                                              │
   ┌─────────┐ ┌────────┐ ┌─────────────┐    │
   │Payments │ │Fraud   │ │Shipping     │    │
   │:50055   │ │:50056  │ │:50057       │◄───┤
   └─────────┘ └────────┘ └─────────────┘    │
                                              │
                ┌───────────────────┐         │
                │ Recommendation    │◄────────┘
                │ :50058 → Inventory│
                └───────────────────┘

Infra: etcd:2379 (discovery)  ·  NATS:4222 (events + chaos channel)
       OTel collector:4317 → Jaeger:16686  ·  Prometheus:9090
```

## Six real e-commerce flows

Each flow exercises a different subset of services. Inject a failure on any
service; the healing agent walks the dependency graph, identifies the
deepest suspect as the root cause, and applies remediation in 7–10 seconds.

| Flow | Endpoint | Hops |
|---|---|---|
| Checkout | `POST /checkout` | gateway → order → auth → inventory → fraud → payments → shipping → notification |
| Refund | `POST /refund` | gateway → order → auth → payments → inventory → notification |
| Cart merge | `POST /cart/merge` | gateway → order → auth → inventory |
| Restock | `POST /inventory/restock` | gateway → auth → inventory → recommendation |
| Fraud review | `POST /fraud/review` | gateway → order → auth → fraud → notification |
| Recommendations | `GET /recommendations/{user}` | gateway → recommendation → inventory |

## Quick start

```bash
cp .env.example .env       # add OPENAI_* keys to enable LLM-driven RCA
make up                    # docker compose up --build -d  (16 containers)
make smoke                 # basic end-to-end check
```

Open:

| URL | Purpose |
|---|---|
| http://localhost:5173 | Dashboard (Mesh Control) |
| http://localhost:8080/docs | Gateway API (FastAPI Swagger) |
| http://localhost:8090/state | Healer state JSON |
| http://localhost:16686 | Jaeger (distributed traces) |
| http://localhost:9090 | Prometheus (metrics) |

## Demo flow

```bash
make demo
```

The script logs in, generates traffic, injects an `errors` failure into Inventory,
keeps generating traffic, and waits for the healer to act. Watch the dashboard:

1. Inventory's node turns red, the `order → inventory` edge turns red.
2. Within ~5s the healer detects degradation (2-of-3 consensus on
   error_rate / latency / health) and either calls Azure for LLM-driven RCA
   or falls back to the rule engine.
3. The agent identifies **inventory** as root cause (deepest suspect with
   no failing dependency below it) and applies `clear_failure` on inventory
   and `enable_fallback` on order.
4. The system stabilises; the IncidentCard shows the LLM's reasoning verbatim
   along with prompt/completion token counts and Azure latency.
5. After the chaos clears, the IncidentCard returns to the empty state.

Each of the 6 flows has a "Run scripted demo" button on its chip — one click
injects the curated failure for that flow and bursts traffic against it.

## Distributed-systems concepts implemented

| Concept | Where |
|---|---|
| Service discovery | `shared/discovery.py` (etcd put/get) |
| Health checking | every service exposes a `Health()` rpc |
| Retries with exponential backoff | `shared/resilience.py` |
| Per-call timeouts | `stub.X(req, timeout=N)` everywhere |
| Circuit breaker | `shared/resilience.py` (closed → open → half_open) |
| Distributed tracing | OpenTelemetry → OTel Collector → Jaeger |
| Metrics | Prometheus client lib + scraper |
| Telemetry stream | NATS subject `mesh.events` |
| Failure injection | NATS subject `mesh.chaos` (latency / errors / grey) |
| Dependency graph | `agents/healer/main.py` `DEPENDENCIES` |
| 2-of-3 consensus | `agents/healer/main.py:is_suspect` |
| Symptom vs root cause | `agents/healer/main.py:find_root_cause` (deepest in DAG) |
| LLM-driven RCA + safety | `agents/healer/main.py:llm_diagnose` (allowlist, cooldown, fallback) |
| Self-healing actions | `Control()` rpc on each service |
| Graceful degradation | Order returns `ord-deferred-…` when inventory circuit is open and fallback enabled |
| Logfire instrumentation | `incident_iteration`, `llm_diagnose`, `send_control` spans |

## The healing agent

```
Every 2 seconds:
  1. OBSERVE — build per-service window stats from NATS events
  2. anomaly pre-check — if all services look fine, sleep
  3. ANALYZE (primary)  — LLM with action allowlist
     ANALYZE (fallback) — 2-of-3 consensus + dependency-graph walk
  4. PLAN — filter actions through cooldown (12s per service)
  5. ACT — gRPC Control() to each target
  6. VERIFY — record incident; sleep 5s
```

**Safety properties:**
- Action allowlist: `{clear_failure, enable_fallback, disable_fallback, mark_degraded}` × 8 services. The LLM can't propose anything else; if it tries, the rules take over.
- 12s per-service cooldown prevents action storms.
- Rule-based fallback fires on any LLM failure (timeout, malformed JSON, disallowed action).

## Repo layout

```
self-healing-mesh/
├── docker-compose.yml         16-container stack
├── Dockerfile.python          generic Python service Dockerfile
├── Makefile
├── README.md
├── .env.example               OpenAI/Azure + Logfire token slots
├── proto/mesh.proto           gRPC contracts
├── shared/                    discovery, telemetry, resilience, chaos listener
├── services/
│   ├── gateway/               REST → gRPC, scripted-demo orchestrator
│   ├── auth/                  token issue/validate
│   ├── order/                 orchestrates auth+inventory+notify+fraud+payments+shipping
│   ├── inventory/
│   ├── notification/
│   ├── payments/
│   ├── fraud/
│   ├── shipping/
│   └── recommendation/
├── agents/healer/             LLM + rule-based RCA agent (with Logfire)
├── frontend/                  React (Vite) — Mesh Control dashboard
│   ├── src/
│   │   ├── api/               flow + health + agent + commands
│   │   ├── hooks/             useFlows, useMeshState, useTraffic, useChaos, …
│   │   └── components/        TopBar, FlowSelectorBand, DependencyGraph,
│   │                          IncidentCard, IncidentHistory,
│   │                          AgentDecisionsFeed, ServiceHealth,
│   │                          FlowExerciser, TrafficGenerator, ChaosPanel,
│   │                          ServiceDrillPanel, ShortcutOverlay
│   └── public/                Login.html, Settings.html (static auxiliary pages)
├── observability/             otel-collector, prometheus configs
└── scripts/                   smoke, demo, inject_failure
```

## Manual testing

```bash
# baseline
TOKEN=$(curl -s -X POST localhost:8080/login -H 'content-type: application/json' \
  -d '{"user":"alice"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

# place an order
curl -X POST localhost:8080/checkout -H 'content-type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"sku\":\"sku-1\",\"qty\":1,\"zip\":\"94110\"}"

# inject grey failure on payments
./scripts/inject_failure.sh payments grey 0.4 600 60

# watch healer decide
watch -n1 'curl -s localhost:8090/state | python3 -m json.tool | head -60'

# clear it manually
curl -X POST 'localhost:8080/chaos/clear?service=payments'
```

## Stack

* **Backend:** Python 3.11, FastAPI, gRPC, Pydantic, asyncio
* **Service mesh primitives:** etcd, NATS (JetStream-capable, used as bus only), OpenTelemetry, Jaeger, Prometheus
* **LLM:** Azure OpenAI compatible endpoint (Azure GPT-5.3) via REST
* **Observability:** Pydantic Logfire (LLM call instrumentation)
* **Frontend:** React 18 + Vite, pure SVG dependency graph (no chart libraries), CSS variables for design tokens
* **Runtime:** Docker Compose (16 containers)

## Notes / simplifications

* In-memory state in every service (no DB). Lost on restart, but enough for the demo.
* etcd discovery is a simple key/value, no leases — good for a static topology.
* Circuit breaker is counter-based, not sliding-window — sufficient and easy to read.
* The chaos channel is NATS. Each service has a chaos listener thread that subscribes to `mesh.chaos` and updates its local `FailureState`. Gateway translates `POST /chaos/inject` into a NATS event.
* The Healer's RCA is rule-based deterministically; the LLM provides reasoning quality. The action allowlist + cooldown means a misbehaving LLM can never crash the system or take an out-of-bounds action.
