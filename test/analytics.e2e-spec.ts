import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { api, createApp, createUser, TestUser } from './helpers';

describe('Analytics (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let organizer: TestUser;
  const future = (d: number) =>
    new Date(Date.now() + d * 86_400_000).toISOString();

  /**
   * Event with GA (1000) and VIP (5000):
   *   A paid  2×GA                      total 2000 disc    0 net 2000
   *   B paid  1×VIP with 50% promo      total 5000 disc 2500 net 2500
   *   C paid → refunded 1×GA            total 1000          net 1000 (refunded)
   *   D pending 3×GA                    must be excluded from revenue
   */
  let eventId: string;
  let csvEmail: string;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    organizer = await createUser(app, UserRole.ORGANIZER);
    const org = api(app, organizer);

    const event = (
      await org
        .post('/events', {
          name: 'Numbers Fest',
          startDate: future(5),
          endDate: future(6),
          venue: 'Hall',
          capacity: 200,
        })
        .expect(201)
    ).body.data;
    eventId = event.id;
    await org.post(`/events/${eventId}/publish`).expect(201);
    const ga = (
      await org
        .post('/tickets', { name: 'GA', price: 1000, quantity: 50, eventId })
        .expect(201)
    ).body.data;
    const vip = (
      await org
        .post('/tickets', {
          name: 'VIP',
          ticketType: 'VIP',
          price: 5000,
          quantity: 10,
          eventId,
        })
        .expect(201)
    ).body.data;
    await org
      .post('/promo-codes', {
        code: `HALF${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
        discountType: 'PERCENTAGE',
        discountValue: 50,
        eventId,
      })
      .expect(201);
    const promo = await prisma.promoCode.findFirstOrThrow({
      where: { eventId },
    });

    const buy = async (
      items: { ticketId: string; quantity: number }[],
      promoCode?: string,
    ) => {
      const buyer = await createUser(app);
      const order = (
        await api(app, buyer).post('/orders', { items, promoCode }).expect(201)
      ).body.data;
      return { buyer, order };
    };

    const a = await buy([{ ticketId: ga.id, quantity: 2 }]);
    await api(app, a.buyer)
      .post(`/orders/${a.order.id}/pay/simulate`)
      .expect(201);

    const b = await buy([{ ticketId: vip.id, quantity: 1 }], promo.code);
    await api(app, b.buyer)
      .post(`/orders/${b.order.id}/pay/simulate`)
      .expect(201);

    const c = await buy([{ ticketId: ga.id, quantity: 1 }]);
    await api(app, c.buyer)
      .post(`/orders/${c.order.id}/pay/simulate`)
      .expect(201);
    await org.post(`/orders/${c.order.id}/refund`).expect(201);

    await buy([{ ticketId: ga.id, quantity: 3 }]); // D: left pending

    // Check in one of A's tickets.
    const aTickets = (
      await api(app, a.buyer).get(`/orders/${a.order.id}/tickets`).expect(200)
    ).body.data;
    await org.post('/checkin', { code: aTickets[0].code }).expect(200);

    // A buyer whose name tries to execute as a spreadsheet formula.
    await prisma.user.update({
      where: { id: a.buyer.id },
      data: { name: '=HYPERLINK("http://evil.test","click")' },
    });
    csvEmail = a.buyer.email;
  });
  afterAll(async () => {
    await app.close();
  });

  it('reports revenue, discounts, refunds and sell-through correctly', async () => {
    const r = (
      await api(app, organizer).get(`/events/${eventId}/analytics`).expect(200)
    ).body.data;
    expect(r.paidOrders).toBe(2);
    expect(r.ticketsSold).toBe(3); // 2 GA + 1 VIP; refunded & pending excluded
    expect(r.grossRevenue).toBe(7000);
    expect(r.discounts).toBe(2500);
    expect(r.netRevenue).toBe(4500);
    expect(r.refundedOrders).toBe(1);
    expect(r.refundedAmount).toBe(1000);
    expect(r.sellThroughRate).toBe(1.5); // 3 / 200
    expect(r.attendance).toEqual({
      issued: 3,
      checkedIn: 1,
      checkInRate: 33.3,
    });
  });

  it('breaks sales down per ticket and per promo code', async () => {
    const r = (
      await api(app, organizer).get(`/events/${eventId}/analytics`).expect(200)
    ).body.data;
    const ga = r.tickets.find((t: any) => t.name === 'GA');
    const vip = r.tickets.find((t: any) => t.name === 'VIP');
    expect(ga).toMatchObject({ sold: 2, revenue: 2000, capacity: 50 });
    expect(vip).toMatchObject({ sold: 1, revenue: 5000, ticketType: 'VIP' });
    expect(r.promos).toHaveLength(1);
    expect(r.promos[0]).toMatchObject({
      orders: 1,
      discount: 2500,
      revenue: 2500,
    });
    expect(r.daily).toHaveLength(1);
    expect(r.daily[0]).toMatchObject({ tickets: 3, gross: 7000 });
  });

  it("dashboard totals only the organizer's own events", async () => {
    const stranger = await createUser(app, UserRole.ORGANIZER);
    const empty = (
      await api(app, stranger).get('/analytics/dashboard').expect(200)
    ).body.data;
    expect(empty.events).toBe(0);
    expect(empty.netRevenue).toBe(0);

    const mine = (
      await api(app, organizer).get('/analytics/dashboard').expect(200)
    ).body.data;
    const row = mine.perEvent.find((e: any) => e.id === eventId);
    expect(row).toMatchObject({
      ticketsSold: 3,
      netRevenue: 4500,
      checkedIn: 1,
    });
  });

  it('restricts analytics and exports to the event owner (or admin) and organizers', async () => {
    const other = await createUser(app, UserRole.ORGANIZER);
    const attendee = await createUser(app);
    await api(app, other).get(`/events/${eventId}/analytics`).expect(403);
    await api(app, other).get(`/events/${eventId}/attendees.csv`).expect(403);
    await api(app, attendee).get(`/events/${eventId}/analytics`).expect(403);
    await api(app, attendee).get('/analytics/dashboard').expect(403);

    const admin = await createUser(app, UserRole.ADMIN);
    await api(app, admin).get(`/events/${eventId}/analytics`).expect(200);
  });

  it('exports attendees as CSV, excludes refunded tickets, and defuses formulas', async () => {
    const res = await api(app, organizer)
      .get(`/events/${eventId}/attendees.csv`)
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');

    const lines = (res.text as string).trim().split('\r\n');
    expect(lines[0]).toBe('Order,Name,Email,Ticket,Type,Status,Checked in at');
    expect(lines).toHaveLength(1 + 3); // refunded order's ticket is void → excluded
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil.test"",""click"")"`);
    expect(res.text).toContain(csvEmail);
    expect(res.text).not.toMatch(/(^|,)=HYPERLINK/m);
  });
});
