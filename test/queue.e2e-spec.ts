import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import Redis from 'ioredis';
import * as request from 'supertest';
import { randomUUID } from 'crypto';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { LogMailer } from '../src/infrastructure/notifications/log.mailer';
import { INSTANCE_ID } from '../src/infrastructure/queue/instance-id';
import { OutboxRelay } from '../src/infrastructure/queue/outbox.relay';
import { JOB_QUEUE, IJobQueue } from '../src/domain/queue/job-queue.interface';
import {
  api,
  createApp,
  createUser,
  PASSWORD,
  TEST_QUEUE_PREFIX,
  TEST_REDIS_URL,
  TestUser,
} from './helpers';

const maybe = TEST_REDIS_URL ? describe : describe.skip;

async function eventually<T>(fn: () => Promise<T> | T, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`condition not met in ${ms}ms${last ? `: ${last}` : ''}`);
}

maybe('Queue, outbox and dead letters (e2e)', () => {
  let a: INestApplication;
  let b: INestApplication; // second replica, same Redis, competing workers
  let prisma: PrismaService;
  let organizer: TestUser;
  const future = (d: number) =>
    new Date(Date.now() + d * 86_400_000).toISOString();

  const mailers = () => [a.get(LogMailer), b.get(LogMailer)];
  const sentTo = (email: string) =>
    mailers().flatMap((m) => m.outbox.filter((x) => x.to === email));

  /** Makes the next `n` mail sends fail across both replicas, then behave. */
  function failSends(n: number | 'always') {
    let remaining = n;
    const restores = mailers().map((m) => {
      const original = m.send.bind(m);
      const spy = jest.spyOn(m, 'send').mockImplementation(async (msg) => {
        if (remaining === 'always' || remaining > 0) {
          if (remaining !== 'always') remaining--;
          throw new Error('smtp down (simulated)');
        }
        return original(msg);
      });
      return () => spy.mockRestore();
    });
    return () => restores.forEach((r) => r());
  }

  async function paidOrder() {
    const org = api(a, organizer);
    const event = (
      await org
        .post('/events', {
          name: 'Queue Fest',
          startDate: future(5),
          endDate: future(6),
          venue: 'V',
          capacity: 50,
        })
        .expect(201)
    ).body.data;
    await org.post(`/events/${event.id}/publish`).expect(201);
    const t = (
      await org
        .post('/tickets', {
          name: 'GA',
          price: 900,
          quantity: 10,
          eventId: event.id,
        })
        .expect(201)
    ).body.data;
    const buyer = await createUser(a);
    const order = (
      await api(a, buyer)
        .post('/orders', { items: [{ ticketId: t.id, quantity: 1 }] })
        .expect(201)
    ).body.data;
    await api(a, buyer).post(`/orders/${order.id}/pay/simulate`).expect(201);
    return { buyer, order };
  }

  beforeAll(async () => {
    const env = {
      JOB_BACKOFF_MS: '20',
      JOB_ATTEMPTS: '3',
      STRICT_THROTTLE_LIMIT: '100000',
    };
    a = await createApp({ redisUrl: TEST_REDIS_URL, env });
    b = await createApp({ redisUrl: TEST_REDIS_URL, env });
    prisma = a.get(PrismaService);
    organizer = await createUser(a, UserRole.ORGANIZER);
  });
  afterAll(async () => {
    await a.close();
    await b.close();
    // Leave no queue keys behind in the shared Redis.
    const redis = new Redis(TEST_REDIS_URL!);
    const keys = await redis.keys(`${TEST_QUEUE_PREFIX}:*`);
    if (keys.length) await redis.del(...keys);
    await redis.quit();
  });

  it('runs in durable (BullMQ) mode with one set of schedules shared by both replicas', async () => {
    expect(a.get<IJobQueue>(JOB_QUEUE).mode).toBe('bull');
    const fromA = (await a.get<IJobQueue>(JOB_QUEUE).schedules()).sort();
    const fromB = (await b.get<IJobQueue>(JOB_QUEUE).schedules()).sort();
    expect(fromA).toEqual(fromB);
    for (const name of [
      'outbox.relay',
      'orders.expire-sweep',
      'events.reminders',
      'maintenance.cleanup',
    ]) {
      expect(fromA.filter((k) => k.includes(name))).toHaveLength(1); // not one per replica
    }
  });

  it('sends exactly one order confirmation even when the relay runs concurrently on both replicas', async () => {
    const { buyer, order } = await paidOrder();

    await Promise.all([
      ...Array.from({ length: 4 }, () => a.get(OutboxRelay).run()),
      ...Array.from({ length: 4 }, () => b.get(OutboxRelay).run()),
    ]);

    await eventually(() =>
      sentTo(buyer.email).some((m) => m.subject.includes(order.reference)),
    );
    await new Promise((r) => setTimeout(r, 400)); // give any duplicate time to show up
    expect(
      sentTo(buyer.email).filter((m) => m.subject.includes(order.reference)),
    ).toHaveLength(1);

    const events = await prisma.outboxEvent.findMany({
      where: { payload: { path: ['orderId'], equals: order.id } },
    });
    expect(events).toHaveLength(1);
    await eventually(
      async () =>
        (await prisma.outboxEvent.findUnique({ where: { id: events[0].id } }))!
          .processedAt,
    );
    const stored = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(stored.confirmationSentAt).not.toBeNull();
  });

  it('recovers an event that was committed but never delivered', async () => {
    const { buyer, order } = await paidOrder();
    await eventually(() => sentTo(buyer.email).length === 1);

    // Simulate the crash window: DB says paid, the event is committed but was
    // never delivered, so no job exists and nothing was sent. (Normally a
    // repeat enqueue is deduplicated by jobId; here the first delivery is erased.)
    const redis = new Redis(TEST_REDIS_URL!);
    try {
      const jobId = `order-confirmation-${order.id}`;
      await redis.del(`${TEST_QUEUE_PREFIX}:terra:${jobId}`);
      await redis.zrem(`${TEST_QUEUE_PREFIX}:terra:completed`, jobId);
    } finally {
      await redis.quit();
    }
    await prisma.order.update({
      where: { id: order.id },
      data: { confirmationSentAt: null },
    });
    mailers().forEach((m) => (m.outbox.length = 0));
    await prisma.outboxEvent.create({
      data: {
        type: 'order.paid',
        payload: { orderId: order.id, originId: INSTANCE_ID },
      },
    });

    await b.get(OutboxRelay).run();
    await eventually(() =>
      sentTo(buyer.email).some((m) => m.subject.includes(order.reference)),
    );
    expect(sentTo(buyer.email)).toHaveLength(1);
  });

  it('retries a failing send with backoff and delivers it', async () => {
    const restore = failSends(2); // fails twice, third attempt succeeds (attempts=3)
    try {
      const email = `${randomUUID()}@retry.test`;
      await request(a.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: PASSWORD })
        .expect(201); // registration is not blocked by the mail outage

      await eventually(() => sentTo(email).length === 1);
      expect(sentTo(email)[0].subject).toMatch(/verify/i);
    } finally {
      restore();
    }
  });

  it('dead-letters a job after its last retry, without storing the secret token', async () => {
    const since = new Date();
    const restore = failSends('always');
    try {
      await request(b.getHttpServer())
        .post('/api/v1/auth/forgot-password')
        .send({ email: (await createUser(a)).email })
        .expect(202);

      const dead = await eventually(() =>
        prisma.deadLetter.findFirst({
          where: { jobName: 'email.password-reset', createdAt: { gte: since } },
        }),
      );
      expect(dead.attempts).toBe(3);
      expect(dead.error).toMatch(/smtp down/);
      expect(JSON.stringify(dead.payload)).toBe('{"redacted":true}');
    } finally {
      restore();
    }
  });

  it('keeps secrets out of Redis once a sensitive job has finished', async () => {
    const redis = new Redis(TEST_REDIS_URL!);
    try {
      const email = `${randomUUID()}@secret.test`;
      await request(a.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ email, password: PASSWORD })
        .expect(201);
      await eventually(() => sentTo(email).length === 1);
      const token = /token=([^\s&]+)/.exec(sentTo(email)[0].text)![1];

      await new Promise((r) => setTimeout(r, 300));
      const keys = await redis.keys(`${TEST_QUEUE_PREFIX}:terra:*`);
      for (const k of keys) {
        const type = await redis.type(k);
        const dump =
          type === 'hash'
            ? JSON.stringify(await redis.hgetall(k))
            : type === 'string'
              ? await redis.get(k)
              : '';
        expect(dump ?? '').not.toContain(token);
      }
    } finally {
      await redis.quit();
    }
  });
});
