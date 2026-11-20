# Load tests

Needs Docker (runs k6 from its image), a running API and a database you don't mind filling.

```bash
# 1. API with relaxed rate limits so the limiter doesn't hide the app's own behaviour
STRICT_THROTTLE_LIMIT=1000000 THROTTLE_LIMIT=1000000 PORT=3996 node dist/src/main.js

# 2. fixtures (users, a published event, a scarce "Hot" ticket)
USERS=200 STOCK=500 npx ts-node --transpile-only loadtest/prepare.ts

# 3. run
docker run --rm --network host -v "$PWD/loadtest:/lt" grafana/k6 run \
  -e BASE_URL=http://localhost:3996/api/v1 /lt/scenarios.js
```

After the run, `sold` on the Hot ticket must equal `min(stock, orders_created * 2)` and never exceed stock.
