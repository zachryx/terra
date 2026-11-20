import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as request from 'supertest';
import { api, createApp, createUser } from './helpers';

describe('Observability (e2e)', () => {
  let app: INestApplication;
  const http = (a: INestApplication = app) => request(a.getHttpServer());
  const future = (d: number) =>
    new Date(Date.now() + d * 86_400_000).toISOString();

  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => {
    await app.close();
  });

  describe('health', () => {
    it('liveness is a bare "process is up"', async () => {
      const res = await http().get('/api/v1/health/live').expect(200);
      expect(res.body.data.status).toBe('ok');
      expect(res.body.data.checks).toBeUndefined();
    });

    it('readiness reports each dependency; Redis disabled is not a problem', async () => {
      const res = await http().get('/api/v1/health/ready').expect(200);
      expect(res.body.data).toMatchObject({
        status: 'ok',
        checks: { database: 'up', redis: 'disabled', queue: 'inline' },
      });
      await http().get('/api/v1/health').expect(200); // legacy path still works
    });

    it('reports "degraded", not down, when Redis is configured but unreachable', async () => {
      const broken = await createApp({ redisUrl: 'redis://127.0.0.1:6399' });
      try {
        const res = await http(broken).get('/api/v1/health/ready').expect(200);
        expect(res.body.data.status).toBe('degraded');
        expect(res.body.data.checks.redis).toBe('down');
        expect(res.body.data.checks.database).toBe('up');
        await http(broken).get('/api/v1/health/live').expect(200);
      } finally {
        await broken.close();
      }
    });
  });

  describe('request ids', () => {
    it('mints one when absent and echoes a well-formed inbound one', async () => {
      const minted = await http().get('/api/v1/health/live').expect(200);
      expect(minted.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

      const echoed = await http()
        .get('/api/v1/health/live')
        .set('X-Request-Id', 'client-trace-12345')
        .expect(200);
      expect(echoed.headers['x-request-id']).toBe('client-trace-12345');
    });

    it('replaces malformed ids instead of reflecting them', async () => {
      const res = await http()
        .get('/api/v1/health/live')
        .set('X-Request-Id', 'bad id with spaces & <script>')
        .expect(200);
      expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('puts the id in error bodies so a report can be traced', async () => {
      const res = await http()
        .get('/api/v1/orders')
        .set('X-Request-Id', 'trace-me-please-1')
        .expect(401);
      expect(res.body.requestId).toBe('trace-me-please-1');
    });
  });

  describe('metrics', () => {
    it('exposes request timings by route pattern (not raw URLs) and business counters', async () => {
      const organizer = await createUser(app, UserRole.ORGANIZER);
      const org = api(app, organizer);
      const event = (
        await org
          .post('/events', {
            name: 'Metrics Fest',
            startDate: future(5),
            endDate: future(6),
            venue: 'V',
            capacity: 20,
          })
          .expect(201)
      ).body.data;
      await org.post(`/events/${event.id}/publish`).expect(201);
      const t = (
        await org
          .post('/tickets', {
            name: 'GA',
            price: 100,
            quantity: 1,
            eventId: event.id,
          })
          .expect(201)
      ).body.data;
      const [a, b] = [await createUser(app), await createUser(app)];
      await api(app, a)
        .post('/orders', { items: [{ ticketId: t.id, quantity: 1 }] })
        .expect(201);
      await api(app, b)
        .post('/orders', { items: [{ ticketId: t.id, quantity: 1 }] })
        .expect(409);
      await api(app, a).get(`/events/${event.id}`).expect(200);

      const body = (await http().get('/api/v1/metrics').expect(200))
        .text as string;

      expect(body).toMatch(
        /terra_http_request_duration_seconds_bucket\{[^}]*route="\/api\/v1\/events\/:id"/,
      );
      expect(body).not.toContain(event.id); // no per-id label explosion
      expect(body).toMatch(
        /terra_orders_created_total\{status="PENDING"\} [1-9]/,
      );
      expect(body).toMatch(
        /terra_checkout_rejected_total\{reason="(stock_conflict|sold_out_gate)"\} [1-9]/,
      );
      expect(body).toMatch(/status="409"/);
      expect(body).toContain('terra_outbox_pending');
      expect(body).toContain('terra_dead_letters');
      expect(body).toContain('process_cpu_user_seconds_total'); // default runtime metrics
    });

    it('can be locked behind a bearer token', async () => {
      const locked = await createApp({
        env: { METRICS_TOKEN: 'scrape-token-1234567890' },
      });
      try {
        await http(locked).get('/api/v1/metrics').expect(401);
        await http(locked)
          .get('/api/v1/metrics')
          .set('Authorization', 'Bearer wrong-token-0000000000')
          .expect(401);
        await http(locked)
          .get('/api/v1/metrics')
          .set('Authorization', 'Bearer scrape-token-1234567890')
          .expect(200);
      } finally {
        await locked.close();
        delete process.env.METRICS_TOKEN;
      }
    });
  });
});
