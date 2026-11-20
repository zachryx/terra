import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { createTicketCode } from '../src/domain/tickets/ticket-code';
import { api, createApp, createUser, TestUser } from './helpers';
import * as request from 'supertest';

describe('Tickets & check-in (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let organizer: TestUser;
  const future = (d: number) =>
    new Date(Date.now() + d * 86_400_000).toISOString();

  async function paidOrder(buyer: TestUser, quantity = 2, org = organizer) {
    const o = api(app, org);
    const event = (
      await o
        .post('/events', {
          name: 'Door Fest',
          startDate: future(1),
          endDate: future(2),
          venue: 'Gate',
          capacity: 100,
        })
        .expect(201)
    ).body.data;
    await o.post(`/events/${event.id}/publish`).expect(201);
    const ticket = (
      await o
        .post('/tickets', {
          name: 'GA',
          price: 500,
          quantity: 20,
          eventId: event.id,
        })
        .expect(201)
    ).body.data;
    const order = (
      await api(app, buyer)
        .post('/orders', { items: [{ ticketId: ticket.id, quantity }] })
        .expect(201)
    ).body.data;
    await api(app, buyer).post(`/orders/${order.id}/pay/simulate`).expect(201);
    const tickets = (
      await api(app, buyer).get(`/orders/${order.id}/tickets`).expect(200)
    ).body.data;
    return { event, order, tickets };
  }

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    organizer = await createUser(app, UserRole.ORGANIZER);
  });
  afterAll(async () => {
    await app.close();
  });

  it('owner can list tickets and fetch a PNG QR; others cannot', async () => {
    const buyer = await createUser(app);
    const { order, tickets } = await paidOrder(buyer);
    expect(tickets).toHaveLength(2);

    const png = await api(app, buyer)
      .get(`/issued-tickets/${tickets[0].id}/qr`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(png.headers['content-type']).toBe('image/png');
    expect((png.body as Buffer).subarray(1, 4).toString()).toBe('PNG');

    const stranger = await createUser(app);
    await api(app, stranger).get(`/orders/${order.id}/tickets`).expect(403);
    await api(app, stranger)
      .get(`/issued-tickets/${tickets[0].id}/qr`)
      .expect(403);
  });

  it('admits a valid ticket once and reports the duplicate', async () => {
    const buyer = await createUser(app);
    const { event, tickets } = await paidOrder(buyer, 1);
    const org = api(app, organizer);

    const first = await org
      .post('/checkin', { code: tickets[0].code, eventId: event.id })
      .expect(200);
    expect(first.body.data.ticketName).toBe('GA');

    const dup = await org
      .post('/checkin', { code: tickets[0].code })
      .expect(409);
    expect(dup.body.code).toBe('ALREADY_CHECKED_IN');
    expect(dup.body.checkedInAt).toBeTruthy();
  });

  it('lets exactly one of many simultaneous scans win', async () => {
    const buyer = await createUser(app);
    const { tickets } = await paidOrder(buyer, 1);
    const org = api(app, organizer);
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        org.post('/checkin', { code: tickets[0].code }),
      ),
    );
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);
  });

  it('rejects forged, tampered and cross-event codes', async () => {
    const buyer = await createUser(app);
    const { tickets } = await paidOrder(buyer, 1);
    const other = await paidOrder(buyer, 1);
    const org = api(app, organizer);

    await org.post('/checkin', { code: 'garbage' }).expect(400);
    await org
      .post('/checkin', {
        code: createTicketCode(tickets[0].id, 'attacker-secret'),
      })
      .expect(400);
    const res = await org
      .post('/checkin', { code: tickets[0].code, eventId: other.event.id })
      .expect(400);
    expect(res.body.code).toBe('WRONG_EVENT');
  });

  it('only the event organizer (or admin) can scan; attendees cannot', async () => {
    const buyer = await createUser(app);
    const { tickets } = await paidOrder(buyer, 1);
    const otherOrganizer = await createUser(app, UserRole.ORGANIZER);
    await api(app, otherOrganizer)
      .post('/checkin', { code: tickets[0].code })
      .expect(403);
    await api(app, buyer)
      .post('/checkin', { code: tickets[0].code })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/v1/checkin')
      .send({ code: tickets[0].code })
      .expect(401);
  });

  it('refuses to admit refunded (void) tickets', async () => {
    const buyer = await createUser(app);
    const { order, tickets } = await paidOrder(buyer, 1);
    await api(app, organizer).post(`/orders/${order.id}/refund`).expect(201);
    const res = await api(app, organizer)
      .post('/checkin', { code: tickets[0].code })
      .expect(400);
    expect(res.body.code).toBe('VOID');
  });

  it('reports check-in stats for the organizer only', async () => {
    const buyer = await createUser(app);
    const { event, tickets } = await paidOrder(buyer, 4);
    await api(app, organizer)
      .post('/checkin', { code: tickets[0].code })
      .expect(200);
    await api(app, organizer)
      .post('/checkin', { code: tickets[1].code })
      .expect(200);

    const stats = (
      await api(app, organizer)
        .get(`/events/${event.id}/checkin-stats`)
        .expect(200)
    ).body.data;
    expect(stats).toMatchObject({
      issued: 4,
      checkedIn: 2,
      remaining: 2,
      checkInRate: 50,
    });

    const other = await createUser(app, UserRole.ORGANIZER);
    await api(app, other).get(`/events/${event.id}/checkin-stats`).expect(403);
    expect(
      await prisma.issuedTicket.count({ where: { eventId: event.id } }),
    ).toBe(4);
  });
});
