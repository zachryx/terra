#!/usr/bin/env bash
# Repeatable load run: fresh fixtures -> API -> k6 -> invariant check.
# Extra env (e.g. LOG_REQUESTS=false REDIS_URL=...) is passed to the API.
set -u
cd "$(dirname "$0")/.."
OUT="${OUT:-/tmp/k6-last.txt}"
export DATABASE_URL="${DATABASE_URL:-postgresql://user:password@localhost:5444/terra}"
export JWT_SECRET="${JWT_SECRET:-lt-secret}" TICKET_SIGNING_SECRET="${TICKET_SIGNING_SECRET:-lt-ticket}"
export PORT="${PORT:-3996}" THROTTLE_LIMIT=1000000 STRICT_THROTTLE_LIMIT=1000000 NODE_ENV="${NODE_ENV:-development}"

USERS="${USERS:-200}" STOCK="${STOCK:-500}" npx ts-node --transpile-only loadtest/prepare.ts | tail -1
node dist/src/main.js > "${APP_LOG:-/tmp/lt-app.log}" 2>&1 &
APP=$!
trap 'kill $APP 2>/dev/null; wait $APP 2>/dev/null' EXIT
for _ in $(seq 1 40); do curl -sf "localhost:$PORT/api/v1/health" >/dev/null && break; sleep 1; done

docker run --rm --network host -v "$PWD/loadtest:/lt" grafana/k6 run --quiet --no-color \
  -e BASE_URL="http://localhost:$PORT/api/v1" -e BROWSE_RPS="${BROWSE_RPS:-200}" \
  -e BURST_VUS="${BURST_VUS:-100}" /lt/scenarios.js > "$OUT" 2>&1

grep -E "p\(95\)|orders_(created|conflict|unexpected)|http_reqs|dropped_iterations|http_req_failed\.\." "$OUT" | sed 's/^ *//'
HOT=$(python3 -c "import json;print(json.load(open('loadtest/fixtures.json'))['hotTicketId'])")
docker exec terra-db-1 psql -U user -d terra -tAc "select 'INVARIANT hot sold='||sold||' / '||quantity||case when sold<=quantity then ' OK' else ' OVERSOLD' end from \"Ticket\" where id='$HOT'"
grep -ac "status=50[0-9]" "${APP_LOG:-/tmp/lt-app.log}" | sed 's/^/5xx logged: /'
