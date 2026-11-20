import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { api, createApp, createUser, TestUser } from './helpers';

describe('Pagination (e2e)', () => {
  let app: INestApplication;
  let organizer: TestUser;
  const future = (d: number) =>
    new Date(Date.now() + d * 86_400_000).toISOString();

  beforeAll(async () => {
    app = await createApp();
    organizer = await createUser(app, UserRole.ORGANIZER);
    // 5 events for this organizer, created in order
    for (let i = 0; i < 5; i++) {
      await api(app, organizer)
        .post('/events', {
          name: `Page ${i}`,
          startDate: future(100 + i),
          endDate: future(101 + i),
          venue: 'V',
          capacity: 10,
        })
        .expect(201);
    }
  });
  afterAll(async () => {
    await app.close();
  });

  it('walks my-events in pages with no gaps or repeats', async () => {
    const a = api(app, organizer);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await a
        .get(`/events/my-events?limit=2${cursor ? `&cursor=${cursor}` : ''}`)
        .expect(200);
      expect(res.body.data.items.length).toBeLessThanOrEqual(2);
      seen.push(...res.body.data.items.map((e: any) => e.id));
      cursor = res.body.data.nextCursor;
      pages++;
    } while (cursor);

    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(pages).toBe(3); // 2 + 2 + 1
  });

  it('returns newest first and a null cursor on the last page', async () => {
    const res = await api(app, organizer)
      .get('/events/my-events?limit=100')
      .expect(200);
    expect(res.body.data.nextCursor).toBeNull();
    expect(res.body.data.items[0].name).toBe('Page 4');
  });

  it('caps page size, defaults it, and rejects bad input', async () => {
    const a = api(app, organizer);
    await a.get('/events?limit=101').expect(400);
    await a.get('/events?limit=0').expect(400);
    await a.get('/events?cursor=not-a-uuid').expect(400);
    const res = await a.get('/events').expect(200);
    expect(res.body.data.items.length).toBeLessThanOrEqual(20);
    expect(res.body.data).toHaveProperty('nextCursor');
  });

  it('hides past events unless asked for them', async () => {
    const past = (
      await api(app, organizer)
        .post('/events', {
          name: 'Ancient',
          startDate: future(-12),
          endDate: future(-11),
          venue: 'V',
          capacity: 10,
        })
        .expect(201)
    ).body.data;
    await api(app, organizer).post(`/events/${past.id}/publish`).expect(201);

    const ids = async (qs: string) => {
      const out: string[] = [];
      let cursor: string | null = null;
      do {
        const r = await api(app, organizer)
          .get(`/events?limit=100${qs}${cursor ? `&cursor=${cursor}` : ''}`)
          .expect(200);
        out.push(...r.body.data.items.map((e: any) => e.id));
        cursor = r.body.data.nextCursor;
      } while (cursor);
      return out;
    };
    expect(await ids('')).not.toContain(past.id);
    expect(await ids('&includePast=true')).toContain(past.id);
  });
});
