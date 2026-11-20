import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { createHash } from 'crypto';
import Redis from 'ioredis';
import * as request from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import {
  api,
  createApp,
  createUser,
  TEST_REDIS_URL,
  TestUser,
} from './helpers';

// Needs a real Redis: TEST_REDIS_URL=redis://localhost:6379 npm run test:e2e
const maybe = TEST_REDIS_URL ? describe : describe.skip;

maybe('Redis-backed scale features (e2e)', () => {
  let a: INestApplication;
  let b: INestApplication; // a second "replica" sharing the same Redis
  let redis: Redis;
  let prisma: PrismaService;
  let organizer: TestUser;
  const future = (d: number) =>
    new Date(Date.now() + d * 86_400_000).toISOString();
  const http = (app: INestApplication) => request(app.getHttpServer());
  const authKey = (cookie: string) =>
    'terra:auth:' +
    createHash('sha256')
      .update(/access_token=([^;]+)/.exec(cookie)![1])
      .digest('hex');

  async function flush(pattern: string) {
    const keys = await redis.keys(pattern);
    if (keys.length) await redis.del(...keys);
  }

  beforeAll(async () => {
    redis = new Redis(TEST_REDIS_URL!);
    await flush('terra:throttle:*');
    const env = { TICKET_CACHE_TTL_SECONDS: '30', STRICT_THROTTLE_LIMIT: '4' };
    a = await createApp({ redisUrl: TEST_REDIS_URL, env });
    b = await createApp({ redisUrl: TEST_REDIS_URL, env });
    prisma = a.get(PrismaService);
    organizer = await createUser(a, UserRole.ORGANIZER);
    await flush('terra:throttle:*'); // setup logins counted against the strict limit
  });
  afterAll(async () => {
    await a.close();
    await b.close();
    await redis.quit();
  });

  it('shares rate limits across replicas', async () => {
    await flush('terra:throttle:*');
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) {
      const app = i % 2 === 0 ? a : b; // alternate replicas
      const res = await http(app)
        .post('/api/v1/auth/login')
        .send({ email: `nobody${i}@limit.test`, password: 'x' });
      statuses.push(res.status);
    }
    // Limit is 4 per minute in total, not per replica.
    expect(statuses.slice(0, 4).every((s) => s !== 429)).toBe(true);
    expect(statuses.slice(4)).toEqual([429, 429, 429]);
  });

  it('caches auth, never stores the password hash, and logout takes effect on every replica at once', async () => {
    await flush('terra:throttle:*');
    const user = await createUser(a);
    await http(a).get('/api/v1/auth/me').set('Cookie', user.cookie).expect(200);

    const cached = await redis.get(authKey(user.cookie));
    expect(cached).not.toBeNull();
    expect(cached).not.toMatch(/password|\$2[aby]\$/);

    await http(b).get('/api/v1/auth/me').set('Cookie', user.cookie).expect(200);
    await http(a)
      .post('/api/v1/auth/logout')
      .set('Cookie', user.cookie)
      .expect(200);

    // Not "within 30s": immediately, on the other replica.
    await http(b).get('/api/v1/auth/me').set('Cookie', user.cookie).expect(401);
    expect(await redis.get(authKey(user.cookie))).toBeNull();
  });

  it('password reset revokes cached sessions immediately', async () => {
    await flush('terra:throttle:*');
    const user = await createUser(a);
    await http(a).get('/api/v1/auth/me').set('Cookie', user.cookie).expect(200);
    expect(await redis.get(authKey(user.cookie))).not.toBeNull();

    // Issue a reset token directly (the mail path is covered elsewhere).
    const raw = 'reset-token-for-redis-test-0123456789';
    await prisma.verificationToken.create({
      data: {
        userId: user.id,
        type: 'PASSWORD_RESET',
        token: createHash('sha256').update(raw).digest('hex'),
        expiresAt: new Date(Date.now() + 3600_000),
      },
    });
    await http(b)
      .post('/api/v1/auth/reset-password')
      .send({ token: raw, password: 'An0ther!Str0ngPass#2' })
      .expect(200);

    await http(a).get('/api/v1/auth/me').set('Cookie', user.cookie).expect(401);
  });

  it('caches the attendee ticket view briefly but never the organizer view', async () => {
    await flush('terra:throttle:*');
    const org = api(a, organizer);
    const event = (
      await org
        .post('/events', {
          name: 'Cache Fest',
          startDate: future(5),
          endDate: future(6),
          venue: 'V',
          capacity: 100,
        })
        .expect(201)
    ).body.data;
    await org.post(`/events/${event.id}/publish`).expect(201);
    const t = (
      await org
        .post('/tickets', {
          name: 'GA',
          price: 1000,
          quantity: 10,
          eventId: event.id,
        })
        .expect(201)
    ).body.data;
    const attendee = await createUser(a);

    const priceSeenBy = async (who: TestUser, app: INestApplication) =>
      (await api(app, who).get(`/tickets/event/${event.id}`).expect(200)).body
        .data[0].price;

    expect(await priceSeenBy(attendee, a)).toBe(1000); // now cached
    await org.put(`/tickets/${t.id}`, { price: 2000 }).expect(200);

    expect(await priceSeenBy(attendee, b)).toBe(1000); // stale within TTL, served from shared cache
    expect(await priceSeenBy(organizer, a)).toBe(2000); // organizer is never served from the cache
  });

  it('does not let organizer/admin traffic write into the shared events cache', async () => {
    await flush('terra:throttle:*');
    await flush('terra:events:list:*');
    await api(a, organizer).get('/events?limit=5').expect(200);
    expect(await redis.keys('terra:events:list:*')).toHaveLength(0);

    const attendee = await createUser(a);
    await api(a, attendee).get('/events?limit=5').expect(200);
    expect(await redis.keys('terra:events:list:*')).toHaveLength(1);
  });

  it('rejects checkout from Redis once a ticket is sold out, and reopens when stock returns', async () => {
    await flush('terra:throttle:*');
    const org = api(a, organizer);
    const event = (
      await org
        .post('/events', {
          name: 'Gate Fest',
          startDate: future(5),
          endDate: future(6),
          venue: 'V',
          capacity: 10,
        })
        .expect(201)
    ).body.data;
    await org.post(`/events/${event.id}/publish`).expect(201);
    const t = (
      await org
        .post('/tickets', {
          name: 'GA',
          price: 500,
          quantity: 2,
          eventId: event.id,
        })
        .expect(201)
    ).body.data;
    const [first, second] = await Promise.all([createUser(a), createUser(b)]);
    const flag = `terra:soldout:${t.id}`;

    const order = (
      await api(a, first)
        .post('/orders', { items: [{ ticketId: t.id, quantity: 2 }] })
        .expect(201)
    ).body.data;
    expect(await redis.get(flag)).toBeNull();

    // Second buyer is turned away; the failure plants the flag...
    await api(b, second)
      .post('/orders', { items: [{ ticketId: t.id, quantity: 1 }] })
      .expect(409);
    expect(await redis.get(flag)).not.toBeNull();

    // ...and once it's there, the rejection no longer touches Postgres.
    const before = await prisma.order.count({ where: { userId: second.id } });
    await api(a, second)
      .post('/orders', { items: [{ ticketId: t.id, quantity: 1 }] })
      .expect(409);
    expect(await prisma.order.count({ where: { userId: second.id } })).toBe(
      before,
    );

    // Cancelling returns stock AND clears the flag, so the buyer can try again at once.
    await api(a, first).post(`/orders/${order.id}/cancel`).expect(201);
    expect(await redis.get(flag)).toBeNull();
    await api(b, second)
      .post('/orders', { items: [{ ticketId: t.id, quantity: 1 }] })
      .expect(201);
  });
});

maybe('Redis outage (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Nothing listens here: every Redis command fails.
    app = await createApp({ redisUrl: 'redis://127.0.0.1:6399' });
  });
  afterAll(async () => {
    await app.close();
  });

  it('keeps serving requests when Redis is unreachable (fails open)', async () => {
    const user = await createUser(app);
    await http(app).get('/api/v1/health').expect(200);
    await http(app)
      .get('/api/v1/auth/me')
      .set('Cookie', user.cookie)
      .expect(200);
    await api(app, user).get('/events').expect(200);
    await api(app, user).get('/orders').expect(200);
  });

  function http(a: INestApplication) {
    return request(a.getHttpServer());
  }
});
