import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as request from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { OrderUseCases } from '../src/application/orders/use-cases/order.use-cases';
import { api, createApp, createUser, PASSWORD, TestUser } from './helpers';

describe('Checkout (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let organizer: TestUser;

  const future = (days: number) =>
    new Date(Date.now() + days * 86_400_000).toISOString();

  async function createPublishedEvent(ticket: {
    quantity: number;
    price?: number;
    maxPerOrder?: number;
  }) {
    const org = api(app, organizer);
    const event = (
      await org
        .post('/events', {
          name: 'E2E Fest',
          startDate: future(10),
          endDate: future(11),
          venue: 'Main Hall',
          capacity: 1000,
        })
        .expect(201)
    ).body.data;
    await org.post(`/events/${event.id}/publish`).expect(201);
    const t = (
      await org
        .post('/tickets', {
          name: 'General',
          price: ticket.price ?? 1000,
          quantity: ticket.quantity,
          maxPerOrder: ticket.maxPerOrder ?? 10,
          eventId: event.id,
        })
        .expect(201)
    ).body.data;
    return { event, ticket: t };
  }

  async function createPromo(
    eventId: string,
    over: Record<string, unknown> = {},
  ) {
    const code = `P${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
    const res = await api(app, organizer)
      .post('/promo-codes', {
        code,
        discountType: 'PERCENTAGE',
        discountValue: 50,
        eventId,
        ...over,
      })
      .expect(201);
    return { code, id: res.body.data.id as string };
  }

  const soldOf = async (ticketId: string) =>
    (await prisma.ticket.findUniqueOrThrow({ where: { id: ticketId } })).sold;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    organizer = await createUser(app, UserRole.ORGANIZER);
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects self-registration as ADMIN', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email: 'evil@e2e.test', password: PASSWORD, role: 'ADMIN' })
      .expect(400);
  });

  it('rejects unauthenticated checkout', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/orders')
      .send({ items: [] })
      .expect(401);
  });

  it('prices an order from the server-side ticket price and snapshots it', async () => {
    const { ticket } = await createPublishedEvent({
      quantity: 10,
      price: 2500,
    });
    const buyer = await createUser(app);
    const res = await api(app, buyer)
      .post('/orders', { items: [{ ticketId: ticket.id, quantity: 3 }] })
      .expect(201);
    const order = res.body.data;
    expect(order.totalAmount).toBe(7500);
    expect(order.finalAmount).toBe(7500);
    expect(order.status).toBe('PENDING');
    expect(order.reference).toMatch(/^ORD-[0-9A-Z]{10}$/);
    expect(order.items[0].price).toBe(2500);
    expect(await soldOf(ticket.id)).toBe(3);
  });

  it('never oversells under concurrent purchases of the last tickets', async () => {
    const { ticket } = await createPublishedEvent({ quantity: 5 });
    const buyers = await Promise.all(
      Array.from({ length: 12 }, () => createUser(app)),
    );

    const results = await Promise.all(
      buyers.map((b) =>
        api(app, b).post('/orders', {
          items: [{ ticketId: ticket.id, quantity: 1 }],
        }),
      ),
    );

    const ok = results.filter((r) => r.status === 201).length;
    const conflict = results.filter((r) => r.status === 409).length;
    expect(ok).toBe(5);
    expect(conflict).toBe(7);
    expect(await soldOf(ticket.id)).toBe(5);
  });

  it('enforces a promo global usage limit under concurrency', async () => {
    const { event, ticket } = await createPublishedEvent({ quantity: 50 });
    const promo = await createPromo(event.id, { maxUses: 2 });
    const buyers = await Promise.all(
      Array.from({ length: 6 }, () => createUser(app)),
    );

    const results = await Promise.all(
      buyers.map((b) =>
        api(app, b).post('/orders', {
          items: [{ ticketId: ticket.id, quantity: 1 }],
          promoCode: promo.code,
        }),
      ),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    const stored = await prisma.promoCode.findUniqueOrThrow({
      where: { id: promo.id },
    });
    expect(stored.usedCount).toBe(2);
    // Failed attempts must not leak stock reservations.
    expect(await soldOf(ticket.id)).toBe(2);
  });

  it('enforces the per-user promo limit under parallel requests', async () => {
    const { event, ticket } = await createPublishedEvent({ quantity: 50 });
    const promo = await createPromo(event.id, { maxUsesPerUser: 1 });
    const buyer = await createUser(app);

    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        api(app, buyer).post('/orders', {
          items: [{ ticketId: ticket.id, quantity: 1 }],
          promoCode: promo.code,
        }),
      ),
    );

    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(await soldOf(ticket.id)).toBe(1);
  });

  it('applies percentage discounts in minor units', async () => {
    const { event, ticket } = await createPublishedEvent({
      quantity: 10,
      price: 999,
    });
    const promo = await createPromo(event.id, { discountValue: 15 });
    const buyer = await createUser(app);
    const res = await api(app, buyer)
      .post('/orders', {
        items: [{ ticketId: ticket.id, quantity: 1 }],
        promoCode: promo.code,
      })
      .expect(201);
    expect(res.body.data.discountAmount).toBe(149); // floor(149.85)
    expect(res.body.data.finalAmount).toBe(850);
  });

  it('marks a fully discounted order as paid immediately', async () => {
    const { event, ticket } = await createPublishedEvent({ quantity: 10 });
    const promo = await createPromo(event.id, { discountValue: 100 });
    const buyer = await createUser(app);
    const res = await api(app, buyer)
      .post('/orders', {
        items: [{ ticketId: ticket.id, quantity: 1 }],
        promoCode: promo.code,
      })
      .expect(201);
    expect(res.body.data.finalAmount).toBe(0);
    expect(res.body.data.status).toBe('PAID');
  });

  it('cancelling releases stock and the promo redemption, only once', async () => {
    const { event, ticket } = await createPublishedEvent({ quantity: 10 });
    const promo = await createPromo(event.id, { maxUses: 1 });
    const buyer = await createUser(app);
    const order = (
      await api(app, buyer)
        .post('/orders', {
          items: [{ ticketId: ticket.id, quantity: 4 }],
          promoCode: promo.code,
        })
        .expect(201)
    ).body.data;
    expect(await soldOf(ticket.id)).toBe(4);

    await api(app, buyer).post(`/orders/${order.id}/cancel`).expect(201);
    expect(await soldOf(ticket.id)).toBe(0);
    const stored = await prisma.promoCode.findUniqueOrThrow({
      where: { id: promo.id },
    });
    expect(stored.usedCount).toBe(0);

    // second cancel is rejected and doesn't double-release
    await api(app, buyer).post(`/orders/${order.id}/cancel`).expect(400);
    expect(await soldOf(ticket.id)).toBe(0);
  });

  it("does not let one user read or cancel another user's order", async () => {
    const { ticket } = await createPublishedEvent({ quantity: 10 });
    const owner = await createUser(app);
    const other = await createUser(app);
    const order = (
      await api(app, owner)
        .post('/orders', { items: [{ ticketId: ticket.id, quantity: 1 }] })
        .expect(201)
    ).body.data;
    await api(app, other).get(`/orders/${order.id}`).expect(403);
    await api(app, other).post(`/orders/${order.id}/cancel`).expect(403);
  });

  it('releases stock for expired pending orders', async () => {
    const { ticket } = await createPublishedEvent({ quantity: 10 });
    const buyer = await createUser(app);
    const order = (
      await api(app, buyer)
        .post('/orders', { items: [{ ticketId: ticket.id, quantity: 2 }] })
        .expect(201)
    ).body.data;
    await prisma.order.update({
      where: { id: order.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    // Another suite's cron (same shared DB) may release it first, so only the
    // end state is asserted, not who performed the release.
    await app.get(OrderUseCases).expireStaleOrders();
    expect(await soldOf(ticket.id)).toBe(0);
    const stored = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(stored.status).toBe('CANCELLED');
  });

  it('drains an expiry backlog larger than one batch, oldest first', async () => {
    const { ticket } = await createPublishedEvent({ quantity: 20 });
    const orderIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const buyer = await createUser(app);
      const o = (
        await api(app, buyer)
          .post('/orders', { items: [{ ticketId: ticket.id, quantity: 1 }] })
          .expect(201)
      ).body.data;
      orderIds.push(o.id);
    }
    expect(await soldOf(ticket.id)).toBe(5);
    await prisma.order.updateMany({
      where: { id: { in: orderIds } },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    // Batches of 2 => needs several passes within a single call.
    await app.get(OrderUseCases).expireStaleOrders(2, 100);

    expect(await soldOf(ticket.id)).toBe(0);
    const left = await prisma.order.count({
      where: { id: { in: orderIds }, status: 'PENDING' },
    });
    expect(left).toBe(0);
  });

  it('rejects orders for unpublished events and out-of-range quantities', async () => {
    const org = api(app, organizer);
    const draft = (
      await org
        .post('/events', {
          name: 'Draft',
          startDate: future(5),
          endDate: future(6),
          venue: 'X',
          capacity: 100,
        })
        .expect(201)
    ).body.data;
    const dt = (
      await org
        .post('/tickets', {
          name: 'T',
          price: 100,
          quantity: 10,
          eventId: draft.id,
        })
        .expect(201)
    ).body.data;
    const buyer = await createUser(app);
    await api(app, buyer)
      .post('/orders', { items: [{ ticketId: dt.id, quantity: 1 }] })
      .expect(400);

    const { ticket } = await createPublishedEvent({
      quantity: 50,
      maxPerOrder: 2,
    });
    await api(app, buyer)
      .post('/orders', { items: [{ ticketId: ticket.id, quantity: 3 }] })
      .expect(400);
  });
});
