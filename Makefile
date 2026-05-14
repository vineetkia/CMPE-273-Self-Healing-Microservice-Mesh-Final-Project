.PHONY: up down build logs smoke demo inject clear ps clean test

up:
	docker compose up --build -d

build:
	docker compose build

down:
	docker compose down

logs:
	docker compose logs -f --tail=100

ps:
	docker compose ps

smoke:
	./scripts/smoke_test.sh

demo:
	./scripts/demo.sh

inject:
	./scripts/inject_failure.sh inventory errors 0.6 0 60

clear:
	curl -fsS -X POST "http://localhost:8080/chaos/clear?service=inventory"

clean:
	docker compose down -v --rmi local

# Pure-logic unit tests (no Docker required, ~1s to run).
# Covers resilience primitives, failure-mode state machine, healer 2-of-3
# consensus, root-cause graph walk, action allowlist, telemetry window,
# auth hashing. 69 tests total.
test:
	python3 -m pytest tests/
