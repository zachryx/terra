import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { api, createApp, createUser, listIds, TestUser } from './helpers';

describe('Events, tickets & promo codes (e2e)', () => {
  let app: INestApplication;
  let organizer: TestUser;
  let other: TestUser;
  let admin: TestUser;
  let attendee: TestUser;
  const future = (d: number) =>
    new Date(Date.now() + d * 86_400_000).toISOString();
  const uniq = () => Math.random().toString(36).slice(2, 9).toUpperCase();

  const eventBody = (over: Record<string, unknown> = {}) => ({
    name: 'Catalog Fest',
    startDate: future(10),
    endDate: future(11),
    venue: 'Arena',
    capacity: 100,
    ...over,
  });

  async function newEvent(publish = false, who = organizer) {
    const e = (await api(app, who).post('/events', eventBody()).expect(201))
      .body.data;
    if (publish)
      await api(app, who).post(`/events/${e.id}/publish`).expect(201);
    return e;
  }

  beforeAll(async () => {
    app = await createApp();
    organizer = await createUser(app, UserRole.ORGANIZER);
    other = await createUser(app, UserRole.ORGANIZER);
    admin = await createUser(app, UserRole.ADMIN);
    attendee = await createUser(app);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('events', () => {
    it('only organizers/admins can create; dates must be ordered', async () => {
      await api(app, attendee).post('/events', eventBody()).expect(403);
      await api(app, organizer)
        .post(
          '/events',
          eventBody({ startDate: future(5), endDate: future(4) }),
        )
        .expect(400);
      const ok = await api(app, organizer)
        .post('/events', eventBody())
        .expect(201);
      expect(ok.body.data.status).toBe('DRAFT');
    });

    it('hides drafts from other users in lists and by id, but not from owner/admin', async () => {
      const draft = await newEvent(false);
      const published = await newEvent(true);

      const forAttendee = await listIds(api(app, attendee), '/events');
      expect(forAttendee).not.toContain(draft.id);
      expect(forAttendee).toContain(published.id);
      expect(await listIds(api(app, other), '/events')).not.toContain(draft.id);
      expect(await listIds(api(app, organizer), '/events')).toContain(draft.id);
      expect(await listIds(api(app, admin), '/events')).toContain(draft.id);

      await api(app, attendee).get(`/events/${draft.id}`).expect(404);
      await api(app, organizer).get(`/events/${draft.id}`).expect(200);
      await api(app, attendee).get(`/events/${published.id}`).expect(200);
    });

    it('blocks other organizers from editing, publishing, cancelling or deleting', async () => {
      const e = await newEvent(false);
      await api(app, other)
        .put(`/events/${e.id}`, { name: 'Hijack' })
        .expect(403);
      await api(app, other).post(`/events/${e.id}/publish`).expect(403);
      await api(app, other).post(`/events/${e.id}/cancel`).expect(403);
      await api(app, other).delete(`/events/${e.id}`).expect(403);
    });

    it('validates updated date ranges and refuses to set status directly', async () => {
      const e = await newEvent(false);
      await api(app, organizer)
        .put(`/events/${e.id}`, { endDate: future(1) }) // before existing start
        .expect(400);
      await api(app, organizer)
        .put(`/events/${e.id}`, { status: 'PUBLISHED' })
        .expect(400);
      const res = await api(app, organizer)
        .put(`/events/${e.id}`, { name: 'Renamed' })
        .expect(200);
      expect(res.body.data.name).toBe('Renamed');
    });

    it('lists my events and deletes an event without orders', async () => {
      const e = await newEvent(false);
      const mine = await api(app, organizer)
        .get('/events/my-events')
        .expect(200);
      expect(mine.body.data.items.map((x: any) => x.id)).toContain(e.id);
      await api(app, organizer).delete(`/events/${e.id}`).expect(200);
      await api(app, organizer).get(`/events/${e.id}`).expect(404);
    });

    it('refuses to delete an event that has orders (409, not a 500)', async () => {
      const e = await newEvent(true);
      const t = (
        await api(app, organizer)
          .post('/tickets', {
            name: 'GA',
            price: 100,
            quantity: 5,
            eventId: e.id,
          })
          .expect(201)
      ).body.data;
      await api(app, attendee)
        .post('/orders', { items: [{ ticketId: t.id, quantity: 1 }] })
        .expect(201);
      await api(app, organizer).delete(`/events/${e.id}`).expect(409);
    });

    it('cancelled events stop selling tickets', async () => {
      const e = await newEvent(true);
      const t = (
        await api(app, organizer)
          .post('/tickets', {
            name: 'GA',
            price: 100,
            quantity: 5,
            eventId: e.id,
          })
          .expect(201)
      ).body.data;
      await api(app, organizer).post(`/events/${e.id}/cancel`).expect(201);
      await api(app, attendee)
        .post('/orders', { items: [{ ticketId: t.id, quantity: 1 }] })
        .expect(400);
    });
  });

  describe('tickets', () => {
    it('enforces ownership and event capacity, and validates price as integer minor units', async () => {
      const e = await newEvent(false); // capacity 100
      await api(app, other)
        .post('/tickets', { name: 'X', price: 100, quantity: 5, eventId: e.id })
        .expect(403);
      await api(app, attendee)
        .post('/tickets', { name: 'X', price: 100, quantity: 5, eventId: e.id })
        .expect(403);
      await api(app, organizer)
        .post('/tickets', {
          name: 'Frac',
          price: 9.99,
          quantity: 5,
          eventId: e.id,
        })
        .expect(400);
      await api(app, organizer)
        .post('/tickets', {
          name: 'Bad',
          price: 100,
          quantity: 5,
          ticketType: 'NOPE',
          eventId: e.id,
        })
        .expect(400);

      await api(app, organizer)
        .post('/tickets', {
          name: 'A',
          price: 100,
          quantity: 60,
          eventId: e.id,
        })
        .expect(201);
      const over = await api(app, organizer)
        .post('/tickets', {
          name: 'B',
          price: 100,
          quantity: 41,
          eventId: e.id,
        })
        .expect(400);
      expect(over.body.message).toMatch(/capacity/i);
      await api(app, organizer)
        .post('/tickets', {
          name: 'B',
          price: 100,
          quantity: 40,
          eventId: e.id,
        })
        .expect(201);
    });

    it('hides tickets of draft events from other users', async () => {
      const draft = await newEvent(false);
      const t = (
        await api(app, organizer)
          .post('/tickets', {
            name: 'Hidden',
            price: 100,
            quantity: 5,
            eventId: draft.id,
          })
          .expect(201)
      ).body.data;
      await api(app, attendee).get(`/tickets/event/${draft.id}`).expect(404);
      await api(app, organizer).get(`/tickets/event/${draft.id}`).expect(200);
      expect(await listIds(api(app, attendee), '/tickets')).not.toContain(t.id);
      expect(await listIds(api(app, organizer), '/tickets')).toContain(t.id);
    });

    it('cannot shrink quantity below sold or delete a ticket that has orders', async () => {
      const e = await newEvent(true);
      const t = (
        await api(app, organizer)
          .post('/tickets', {
            name: 'GA',
            price: 100,
            quantity: 10,
            eventId: e.id,
          })
          .expect(201)
      ).body.data;
      await api(app, attendee)
        .post('/orders', { items: [{ ticketId: t.id, quantity: 4 }] })
        .expect(201);

      const low = await api(app, organizer)
        .put(`/tickets/${t.id}`, { quantity: 3 })
        .expect(400);
      expect(low.body.message).toMatch(/already sold/i);
      await api(app, organizer)
        .put(`/tickets/${t.id}`, { quantity: 4 })
        .expect(200);
      await api(app, organizer).delete(`/tickets/${t.id}`).expect(409);
      await api(app, other).put(`/tickets/${t.id}`, { price: 1 }).expect(403);
    });

    it('checks availability and deletes an unsold ticket', async () => {
      const e = await newEvent(true);
      const t = (
        await api(app, organizer)
          .post('/tickets', {
            name: 'GA',
            price: 100,
            quantity: 3,
            maxPerOrder: 2,
            eventId: e.id,
          })
          .expect(201)
      ).body.data;
      await api(app, attendee)
        .post(`/tickets/${t.id}/check-availability`, { quantity: 2 })
        .expect(201);
      await api(app, attendee)
        .post(`/tickets/${t.id}/check-availability`, { quantity: 3 })
        .expect(400);
      await api(app, organizer).delete(`/tickets/${t.id}`).expect(200);
    });
  });

  describe('promo codes', () => {
    const promoBody = (
      eventId: string,
      over: Record<string, unknown> = {},
    ) => ({
      code: `C${uniq()}`,
      discountType: 'PERCENTAGE',
      discountValue: 20,
      eventId,
      ...over,
    });

    it('is not readable by attendees, and organizers only see their own', async () => {
      const mine = await newEvent(true);
      const theirs = await newEvent(true, other);
      const myCode = (
        await api(app, organizer)
          .post('/promo-codes', promoBody(mine.id))
          .expect(201)
      ).body.data;
      const theirCode = (
        await api(app, other)
          .post('/promo-codes', promoBody(theirs.id))
          .expect(201)
      ).body.data;

      await api(app, attendee).get('/promo-codes').expect(403);
      await api(app, attendee).get(`/promo-codes/${myCode.id}`).expect(403);
      await api(app, attendee).get(`/promo-codes/event/${mine.id}`).expect(403);

      const ids = await listIds(api(app, organizer), '/promo-codes');
      expect(ids).toContain(myCode.id);
      expect(ids).not.toContain(theirCode.id);

      await api(app, organizer).get(`/promo-codes/${theirCode.id}`).expect(403);
      await api(app, organizer)
        .get(`/promo-codes/event/${theirs.id}`)
        .expect(403);
      await api(app, organizer)
        .get(`/promo-codes/event/${mine.id}`)
        .expect(200);
      await api(app, admin).get(`/promo-codes/${theirCode.id}`).expect(200);
    });

    it('only admins can create, edit or delete global (all-event) codes', async () => {
      await api(app, organizer)
        .post('/promo-codes', { code: `G${uniq()}`, discountValue: 100 })
        .expect(403);
      const g = (
        await api(app, admin)
          .post('/promo-codes', { code: `G${uniq()}`, discountValue: 10 })
          .expect(201)
      ).body.data;
      await api(app, organizer)
        .put(`/promo-codes/${g.id}`, { discountValue: 100 })
        .expect(403);
      await api(app, organizer).delete(`/promo-codes/${g.id}`).expect(403);
      await api(app, admin)
        .put(`/promo-codes/${g.id}`, { discountValue: 15 })
        .expect(200);
      await api(app, admin).delete(`/promo-codes/${g.id}`).expect(200);
    });

    it('rejects duplicate codes (case-insensitive) and >100% percentages', async () => {
      const e = await newEvent(true);
      const body = promoBody(e.id);
      await api(app, organizer).post('/promo-codes', body).expect(201);
      await api(app, organizer)
        .post('/promo-codes', { ...body, code: body.code.toLowerCase() })
        .expect(409);
      await api(app, organizer)
        .post('/promo-codes', promoBody(e.id, { discountValue: 101 }))
        .expect(400);
      await api(app, organizer)
        .post(
          '/promo-codes',
          promoBody(other.id, { eventId: e.id, discountValue: 5.5 }),
        )
        .expect(400); // fractional values are not allowed
    });

    it('updates and deletes only for the owner', async () => {
      const e = await newEvent(true);
      const c = (
        await api(app, organizer)
          .post('/promo-codes', promoBody(e.id))
          .expect(201)
      ).body.data;
      await api(app, other)
        .put(`/promo-codes/${c.id}`, { discountValue: 90 })
        .expect(403);
      await api(app, other).delete(`/promo-codes/${c.id}`).expect(403);
      await api(app, organizer)
        .put(`/promo-codes/${c.id}`, {
          discountType: 'PERCENTAGE',
          discountValue: 101,
        })
        .expect(400);
      const up = await api(app, organizer)
        .put(`/promo-codes/${c.id}`, { discountValue: 30 })
        .expect(200);
      expect(up.body.data.discountValue).toBe(30);
      await api(app, organizer).delete(`/promo-codes/${c.id}`).expect(200);
    });

    it('validate reports why a code is unusable and what a valid one is worth', async () => {
      const e = await newEvent(true);
      const otherEvent = await newEvent(true);
      const code = promoBody(e.id, {
        discountValue: 25,
        minPurchaseAmount: 1000,
      });
      await api(app, organizer).post('/promo-codes', code).expect(201);
      const v = (amount: number, eventId = e.id, c = code.code) =>
        api(app, attendee).post('/promo-codes/validate', {
          code: c,
          purchaseAmount: amount,
          eventId,
        });

      const ok = (await v(2000).expect(201)).body.data;
      expect(ok).toMatchObject({
        valid: true,
        discountAmount: 500,
        finalAmount: 1500,
      });
      expect((await v(500).expect(201)).body.data.message).toMatch(/minimum/i);
      expect(
        (await v(2000, otherEvent.id).expect(201)).body.data.message,
      ).toMatch(/not valid for this event/i);
      expect(
        (await v(2000, e.id, 'NOSUCHCODE').expect(201)).body.data.valid,
      ).toBe(false);

      const expired = promoBody(e.id, {
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      await api(app, organizer).post('/promo-codes', expired).expect(201);
      expect(
        (await v(2000, e.id, expired.code).expect(201)).body.data.message,
      ).toMatch(/expired/i);

      const notYet = promoBody(e.id, { startsAt: future(2) });
      await api(app, organizer).post('/promo-codes', notYet).expect(201);
      expect(
        (await v(2000, e.id, notYet.code).expect(201)).body.data.message,
      ).toMatch(/not yet/i);

      const off = promoBody(e.id, { isActive: false });
      await api(app, organizer).post('/promo-codes', off).expect(201);
      // isActive is not accepted on create (promo created active), so deactivate via update
      const created = (
        await api(app, organizer).get(`/promo-codes/event/${e.id}`).expect(200)
      ).body.data.find((c: any) => c.code === off.code.toUpperCase());
      await api(app, organizer)
        .put(`/promo-codes/${created.id}`, { isActive: false })
        .expect(200);
      expect(
        (await v(2000, e.id, off.code).expect(201)).body.data.message,
      ).toMatch(/inactive/i);
    });

    it('a ticket-restricted promo only discounts that ticket', async () => {
      const e = await newEvent(true);
      const org = api(app, organizer);
      const ga = (
        await org
          .post('/tickets', {
            name: 'GA',
            price: 1000,
            quantity: 20,
            eventId: e.id,
          })
          .expect(201)
      ).body.data;
      const vip = (
        await org
          .post('/tickets', {
            name: 'VIP',
            ticketType: 'VIP',
            price: 4000,
            quantity: 20,
            eventId: e.id,
          })
          .expect(201)
      ).body.data;
      const promo = promoBody(e.id, {
        discountValue: 50,
        ticketTypeId: vip.id,
      });
      await org.post('/promo-codes', promo).expect(201);

      const buyer = await createUser(app);
      const both = (
        await api(app, buyer)
          .post('/orders', {
            items: [
              { ticketId: ga.id, quantity: 1 },
              { ticketId: vip.id, quantity: 1 },
            ],
            promoCode: promo.code,
          })
          .expect(201)
      ).body.data;
      // 50% of the VIP line only (2000), not of the 5000 total.
      expect(both.totalAmount).toBe(5000);
      expect(both.discountAmount).toBe(2000);
      expect(both.finalAmount).toBe(3000);

      const buyer2 = await createUser(app);
      await api(app, buyer2)
        .post('/orders', {
          items: [{ ticketId: ga.id, quantity: 1 }],
          promoCode: promo.code,
        })
        .expect(400);
    });
  });
});
