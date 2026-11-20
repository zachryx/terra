// k6 scenarios for Terra.  See loadtest/README.md
import http from 'k6/http';
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import { Counter } from 'k6/metrics';

const fx = JSON.parse(open('./fixtures.json'));
const BASE = __ENV.BASE_URL || 'http://localhost:3000/api/v1';
const emails = new SharedArray('emails', () => fx.emails);

const sold = new Counter('orders_created');
const soldOut = new Counter('orders_conflict_409');
const unexpected = new Counter('orders_unexpected');

export const options = {
  scenarios: {
    // Read-heavy traffic: public browsing.
    browse: {
      executor: 'constant-arrival-rate',
      rate: Number(__ENV.BROWSE_RPS || 200),
      timeUnit: '1s',
      duration: __ENV.DURATION || '30s',
      preAllocatedVUs: 100,
      maxVUs: 400,
      exec: 'browse',
    },
    // Flash sale: everyone hits the same scarce ticket at once.
    checkout_burst: {
      executor: 'per-vu-iterations',
      vus: Number(__ENV.BURST_VUS || 100),
      iterations: Number(__ENV.BURST_ITERS || 5),
      maxDuration: '60s',
      exec: 'checkout',
      startTime: '2s',
    },
  },
  thresholds: {
    'http_req_duration{scenario:browse}': ['p(95)<500'],
    'http_req_failed{scenario:browse}': ['rate<0.01'],
    orders_unexpected: ['count==0'],
  },
};

export function setup() {
  // One session per distinct user, reused across iterations.
  const sessions = [];
  for (let i = 0; i < emails.length; i++) {
    const res = http.post(
      `${BASE}/auth/login`,
      JSON.stringify({ email: emails[i], password: fx.password }),
      { headers: { 'Content-Type': 'application/json' }, tags: { name: 'login' } },
    );
    const cookies = res.cookies;
    if (res.status === 200 && cookies.access_token) {
      sessions.push(cookies.access_token[0].value);
    }
  }
  return { sessions };
}

export function browse(data) {
  const token = data.sessions[Math.floor(Math.random() * data.sessions.length)];
  const headers = { Authorization: `Bearer ${token}` };
  const r = Math.random();
  const res =
    r < 0.5
      ? http.get(`${BASE}/events`, { headers, tags: { name: 'GET /events' } })
      : http.get(`${BASE}/tickets/event/${fx.eventId}`, { headers, tags: { name: 'GET /tickets/event' } });
  check(res, { 'browse 200': (x) => x.status === 200 });
}

export function checkout(data) {
  const token = data.sessions[(__VU - 1) % data.sessions.length];
  const res = http.post(
    `${BASE}/orders`,
    JSON.stringify({ items: [{ ticketId: fx.hotTicketId, quantity: 2 }] }),
    {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      tags: { name: 'POST /orders (hot)' },
    },
  );
  if (res.status === 201) sold.add(1);
  else if (res.status === 409 || res.status === 400) soldOut.add(1);
  else unexpected.add(1);
}
