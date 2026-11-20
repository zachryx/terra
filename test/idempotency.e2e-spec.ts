import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { api, createApp, createUser, TestUser } from './helpers';

describe('Idempotency-Key on checkout (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let organizer: TestUser;
  const future = (d: number) =>
    new Date(Date.now() + d * 86_400_000).toISOString();

  async function ticket(quantity = 20) {
    const org = api(app, organizer);
    const event = (
      await org
        .post('/events', {
          name: 'Idem Fest',
          startDate: future(5),
          endDate: future(6),
          venue: 'V',
          capacity: 100,
        })
        .expect(201)
    ).body.data;
    await org.post(`/events/${event.id}/publish`).expect(201);
    return (
      await org
        .post('/tickets', {
          name: 'GA',
          price: 700,
          quantity,
          eventId: event.id,
        })
        .expect(201)
    ).body.data;
  }

  const place = (
    buyer: TestUser,
    ticketId: string,
    qty: number,
    key?: string,
  ) => {
    const req = request(app.getHttpServer())
      .post('/api/v1/orders')
      .set('Cookie', buyer.cookie);
    if (key) req.set('Idempotency-Key', key);
    return req.send({ items: [{ ticketId, quantity: qty }] });
  };
  const soldOf = async (id: string) =>
    (await prisma.ticket.findUniqueOrThrow({ where: { id } })).sold;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    organizer = await createUser(app, UserRole.ORGANIZER);
  });
  afterAll(async () => {
    await app.close();
  });

  it('replays the original order instead of buying twice', async () => {
    const t = await ticket();
    const buyer = await createUser(app);
    const key = randomUUID();

    const first = await place(buyer, t.id, 2, key).expect(201);
    const second = await place(buyer, t.id, 2, key).expect(201);

    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.reference).toBe(first.body.data.reference);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(await soldOf(t.id)).toBe(2); // not 4
    expect(await prisma.order.count({ where: { userId: buyer.id } })).toBe(1);
  });

  it('rejects the same key with a different request', async () => {
    const t = await ticket();
    const buyer = await createUser(app);
    const key = randomUUID();
    await place(buyer, t.id, 1, key).expect(201);
    const res = await place(buyer, t.id, 3, key).expect(422);
    expect(res.body.message).toMatch(/different request/i);
    expect(await soldOf(t.id)).toBe(1);
  });

  it('lets exactly one of many simultaneous duplicates through', async () => {
    const t = await ticket();
    const buyer = await createUser(app);
    const key = randomUUID();

    const results = await Promise.all(
      Array.from({ length: 8 }, () => place(buyer, t.id, 1, key)),
    );
    const created = results.filter(
      (r) => r.status === 201 && !r.headers['idempotent-replayed'],
    );
    expect(created).toHaveLength(1);
    for (const r of results) expect([201, 409]).toContain(r.status);
    expect(await prisma.order.count({ where: { userId: buyer.id } })).toBe(1);
    expect(await soldOf(t.id)).toBe(1);
  });

  it('scopes keys per user and releases the key after a failed attempt', async () => {
    const t = await ticket(1);
    const a = await createUser(app);
    const b = await createUser(app);
    const key = randomUUID();

    // Sold out for 2 -> fails, key released
    await place(a, t.id, 2, key).expect(409);
    await place(a, t.id, 1, key).expect(201); // same key, new (valid) request is allowed

    // Another user may reuse the same key string independently
    await place(b, t.id, 1, key).expect(409); // (sold out, but not an idempotency clash)
    expect(await soldOf(t.id)).toBe(1);
  });

  it('validates the header format and is optional', async () => {
    const t = await ticket();
    const buyer = await createUser(app);
    await place(buyer, t.id, 1, 'short').expect(400);
    await place(buyer, t.id, 1).expect(201); // no header: normal behaviour
  });
});
