import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as request from 'supertest';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { FakeGateway } from '../src/infrastructure/payments/gateways/fake.gateway';
import { verifyTicketCode } from '../src/domain/tickets/ticket-code';
import { api, createApp, createUser, TestUser } from './helpers';

describe('Payments & fulfilment (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let gateway: FakeGateway;
  let organizer: TestUser;

  const future = (d: number) =>
    new Date(Date.now() + d * 86_400_000).toISOString();

  async function setup(quantity = 10, price = 2000) {
    const org = api(app, organizer);
    const event = (
      await org
        .post('/events', {
          name: 'Pay Fest',
          startDate: future(5),
          endDate: future(6),
          venue: 'Hall',
          capacity: 500,
        })
        .expect(201)
    ).body.data;
    await org.post(`/events/${event.id}/publish`).expect(201);
    const ticket = (
      await org
        .post('/tickets', { name: 'GA', price, quantity, eventId: event.id })
        .expect(201)
    ).body.data;
    return { event, ticket };
  }

  async function placeOrder(buyer: TestUser, ticketId: string, quantity = 2) {
    return (
      await api(app, buyer)
        .post('/orders', { items: [{ ticketId, quantity }] })
        .expect(201)
    ).body.data;
  }

  function sendWebhook(
    payload: Record<string, unknown>,
    signatureOverride?: string,
  ) {
    const raw = JSON.stringify(payload);
    return request(app.getHttpServer())
      .post('/api/v1/payments/webhook')
      .set('Content-Type', 'application/json')
      .set(FakeGateway.SIGNATURE_HEADER, signatureOverride ?? gateway.sign(raw))
      .send(raw);
  }

  const succeeded = (
    orderId: string,
    amount: number,
    id = `evt_${orderId}`,
  ) => ({
    id,
    type: 'payment.succeeded',
    providerRef: `fake_pi_${orderId}`,
    amount,
  });

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    gateway = app.get(FakeGateway);
    organizer = await createUser(app, UserRole.ORGANIZER);
  });
  afterAll(async () => {
    await app.close();
  });

  it('pay → signed webhook → order PAID with one valid signed ticket per unit', async () => {
    const { ticket } = await setup();
    const buyer = await createUser(app);
    const order = await placeOrder(buyer, ticket.id, 3);

    const pay = (
      await api(app, buyer).post(`/orders/${order.id}/pay`).expect(201)
    ).body.data;
    expect(pay.amount).toBe(6000);
    expect(pay.provider).toBe('fake');
    expect(pay.clientSecret).toBeTruthy();

    // Paying again returns the same payment (idempotent).
    const again = (
      await api(app, buyer).post(`/orders/${order.id}/pay`).expect(201)
    ).body.data;
    expect(again.paymentId).toBe(pay.paymentId);

    await sendWebhook(succeeded(order.id, 6000)).expect(200);

    const stored = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(stored.status).toBe('PAID');
    const tickets = await prisma.issuedTicket.findMany({
      where: { orderId: order.id },
    });
    expect(tickets).toHaveLength(3);
    for (const t of tickets) {
      expect(verifyTicketCode(t.code, process.env.TICKET_SIGNING_SECRET!)).toBe(
        t.id,
      );
      expect(t.ownerId).toBe(buyer.id);
    }
  });

  it('is idempotent: replaying the same webhook does not issue more tickets', async () => {
    const { ticket } = await setup();
    const buyer = await createUser(app);
    const order = await placeOrder(buyer, ticket.id, 2);
    await api(app, buyer).post(`/orders/${order.id}/pay`).expect(201);

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        sendWebhook(succeeded(order.id, 4000, 'evt_same')),
      ),
    );
    results.forEach((r) => expect(r.status).toBe(200));
    expect(
      results.filter((r) => r.body.data.result === 'settled'),
    ).toHaveLength(1);
    expect(
      await prisma.issuedTicket.count({ where: { orderId: order.id } }),
    ).toBe(2);
  });

  it('rejects webhooks with a bad or missing signature', async () => {
    await sendWebhook(succeeded('x', 1), 'deadbeef').expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/payments/webhook')
      .send({ id: 'e', type: 'payment.succeeded' })
      .expect(400);
  });

  it('does not mark an order paid when the amount does not match', async () => {
    const { ticket } = await setup();
    const buyer = await createUser(app);
    const order = await placeOrder(buyer, ticket.id, 1);
    await api(app, buyer).post(`/orders/${order.id}/pay`).expect(201);

    const res = await sendWebhook(succeeded(order.id, 1)).expect(200);
    expect(res.body.data.result).toBe('amount_mismatch');
    const stored = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(stored.status).toBe('PENDING');
    expect(
      await prisma.issuedTicket.count({ where: { orderId: order.id } }),
    ).toBe(0);
  });

  it("refuses to take payment for someone else's order", async () => {
    const { ticket } = await setup();
    const owner = await createUser(app);
    const other = await createUser(app);
    const order = await placeOrder(owner, ticket.id, 1);
    await api(app, other).post(`/orders/${order.id}/pay`).expect(403);
  });

  it('auto-refunds a payment that lands after the order was cancelled', async () => {
    const { ticket } = await setup();
    const buyer = await createUser(app);
    const order = await placeOrder(buyer, ticket.id, 2);
    await api(app, buyer).post(`/orders/${order.id}/pay`).expect(201);
    await api(app, buyer).post(`/orders/${order.id}/cancel`).expect(201);

    const res = await sendWebhook(succeeded(order.id, 4000)).expect(200);
    expect(res.body.data.result).toBe('needs_refund');

    const payment = await prisma.payment.findUniqueOrThrow({
      where: { providerRef: `fake_pi_${order.id}` },
    });
    expect(payment.status).toBe('REFUNDED');
    expect(
      await prisma.issuedTicket.count({ where: { orderId: order.id } }),
    ).toBe(0);
  });

  it('refund voids tickets, restores stock, and is limited to the event organizer', async () => {
    const { ticket } = await setup();
    const buyer = await createUser(app);
    const order = await placeOrder(buyer, ticket.id, 2);
    await api(app, buyer).post(`/orders/${order.id}/pay`).expect(201);
    await sendWebhook(succeeded(order.id, 4000)).expect(200);

    const otherOrganizer = await createUser(app, UserRole.ORGANIZER);
    await api(app, otherOrganizer)
      .post(`/orders/${order.id}/refund`)
      .expect(403);
    await api(app, buyer).post(`/orders/${order.id}/refund`).expect(403);

    await api(app, organizer).post(`/orders/${order.id}/refund`).expect(201);

    const stored = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(stored.status).toBe('REFUNDED');
    const tickets = await prisma.issuedTicket.findMany({
      where: { orderId: order.id },
    });
    expect(tickets.every((t) => t.status === 'VOID')).toBe(true);
    expect(
      (await prisma.ticket.findUniqueOrThrow({ where: { id: ticket.id } }))
        .sold,
    ).toBe(0);

    // Can't refund twice.
    await api(app, organizer).post(`/orders/${order.id}/refund`).expect(400);
  });

  it('refuses to refund an order with checked-in tickets', async () => {
    const { ticket } = await setup();
    const buyer = await createUser(app);
    const order = await placeOrder(buyer, ticket.id, 1);
    await api(app, buyer).post(`/orders/${order.id}/pay`).expect(201);
    await sendWebhook(succeeded(order.id, 2000)).expect(200);
    await prisma.issuedTicket.updateMany({
      where: { orderId: order.id },
      data: { status: 'CHECKED_IN', checkedInAt: new Date() },
    });
    await api(app, organizer).post(`/orders/${order.id}/refund`).expect(400);
  });

  it('issues tickets immediately for fully discounted (free) orders', async () => {
    const { event, ticket } = await setup();
    const code = `FREE${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    await api(app, organizer)
      .post('/promo-codes', {
        code,
        discountType: 'PERCENTAGE',
        discountValue: 100,
        eventId: event.id,
      })
      .expect(201);
    const buyer = await createUser(app);
    const order = (
      await api(app, buyer)
        .post('/orders', {
          items: [{ ticketId: ticket.id, quantity: 2 }],
          promoCode: code,
        })
        .expect(201)
    ).body.data;
    expect(order.status).toBe('PAID');
    expect(
      await prisma.issuedTicket.count({ where: { orderId: order.id } }),
    ).toBe(2);
  });

  it('dev simulate endpoint drives the real webhook path', async () => {
    const { ticket } = await setup();
    const buyer = await createUser(app);
    const order = await placeOrder(buyer, ticket.id, 1);
    const res = await api(app, buyer)
      .post(`/orders/${order.id}/pay/simulate`)
      .expect(201);
    expect(res.body.data.result).toBe('settled');
    const stored = await prisma.order.findUniqueOrThrow({
      where: { id: order.id },
    });
    expect(stored.status).toBe('PAID');
  });
});
