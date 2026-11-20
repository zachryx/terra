import { INestApplication } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import * as request from 'supertest';
import { randomUUID } from 'crypto';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { LogMailer } from '../src/infrastructure/notifications/log.mailer';
import { NotificationService } from '../src/application/notifications/notification.service';
import { api, createApp, createUser, PASSWORD } from './helpers';

describe('Auth & notifications (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let mailer: LogMailer;

  const http = () => request(app.getHttpServer());
  const NEW_PASSWORD = 'An0ther!Str0ngPass#2';
  const future = (h: number) =>
    new Date(Date.now() + h * 3_600_000).toISOString();

  const mailTo = (email: string) => mailer.outbox.filter((m) => m.to === email);
  const tokenFrom = (text: string) => /token=([^\s&]+)/.exec(text)![1];

  async function register(email = `${randomUUID()}@e2e.test`) {
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ email, password: PASSWORD })
      .expect(201);
    return { email, res };
  }

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    mailer = app.get(LogMailer);
  });
  afterAll(async () => {
    await app.close();
  });

  describe('registration & verification', () => {
    it('creates no session, emails a hashed single-use token, and gates login on it', async () => {
      const { email, res } = await register();
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.body.data.user.role).toBe('ATTENDEE');

      const mail = mailTo(email)[0];
      expect(mail.subject).toMatch(/verify/i);
      const raw = tokenFrom(mail.text);

      // Only a hash is stored.
      const stored = await prisma.verificationToken.findMany({
        where: { user: { email } },
      });
      expect(stored).toHaveLength(1);
      expect(stored[0].token).not.toBe(raw);

      await http()
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(400);

      await http()
        .post('/api/v1/auth/verify-email')
        .send({ token: raw })
        .expect(200);
      await http()
        .post('/api/v1/auth/verify-email')
        .send({ token: raw })
        .expect(401);

      const login = await http()
        .post('/api/v1/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      const cookie = (login.headers['set-cookie'] as unknown as string[])
        .map((c) => c.split(';')[0])
        .join('; ');
      const me = await http()
        .get('/api/v1/auth/me')
        .set('Cookie', cookie)
        .expect(200);
      expect(me.body.data.email).toBe(email);
    });

    it('rejects duplicate emails and weak passwords', async () => {
      const { email } = await register();
      await http()
        .post('/api/v1/auth/register')
        .send({ email, password: PASSWORD })
        .expect(409);
      await http()
        .post('/api/v1/auth/register')
        .send({ email: `${randomUUID()}@e2e.test`, password: 'short' })
        .expect(400);
    });

    it('resend-verification answers identically for unknown emails and sends nothing', async () => {
      const before = mailer.outbox.length;
      const res = await http()
        .post('/api/v1/auth/resend-verification')
        .send({ email: 'nobody@e2e.test' })
        .expect(202);
      expect(res.body.data.message).toMatch(/if the account/i);
      expect(mailer.outbox.length).toBe(before);
    });
  });

  describe('lockout', () => {
    it('locks an account after repeated failures, persistently, and not other accounts', async () => {
      const victim = await createUser(app);
      const bystander = await createUser(app);
      for (let i = 0; i < 5; i++) {
        await http()
          .post('/api/v1/auth/login')
          .send({ email: victim.email, password: 'Wrong!Passw0rd#9' })
          .expect(401);
      }
      // Correct password is refused while locked.
      const locked = await http()
        .post('/api/v1/auth/login')
        .send({ email: victim.email, password: PASSWORD })
        .expect(403);
      expect(locked.body.message).toMatch(/locked/i);
      expect(
        await prisma.loginAttempt.count({ where: { email: victim.email } }),
      ).toBe(5);

      await http()
        .post('/api/v1/auth/login')
        .send({ email: bystander.email, password: PASSWORD })
        .expect(200);
    });
  });

  describe('password reset', () => {
    it('is non-enumerating, single-use, and signs out existing sessions', async () => {
      const user = await createUser(app);
      await http()
        .get('/api/v1/auth/me')
        .set('Cookie', user.cookie)
        .expect(200);

      const before = mailer.outbox.length;
      await http()
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'ghost@e2e.test' })
        .expect(202);
      expect(mailer.outbox.length).toBe(before);

      await http()
        .post('/api/v1/auth/forgot-password')
        .send({ email: user.email })
        .expect(202);
      const raw = tokenFrom(mailTo(user.email).at(-1)!.text);

      await http()
        .post('/api/v1/auth/reset-password')
        .send({ token: raw, password: 'weak' })
        .expect(400);
      await http()
        .post('/api/v1/auth/reset-password')
        .send({ token: raw, password: NEW_PASSWORD })
        .expect(200);

      // Old session is dead, token can't be replayed, new password works.
      await http()
        .get('/api/v1/auth/me')
        .set('Cookie', user.cookie)
        .expect(401);
      await http()
        .post('/api/v1/auth/reset-password')
        .send({ token: raw, password: NEW_PASSWORD })
        .expect(400);
      await http()
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: PASSWORD })
        .expect(401);
      await http()
        .post('/api/v1/auth/login')
        .send({ email: user.email, password: NEW_PASSWORD })
        .expect(200);
    });
  });

  describe('sessions', () => {
    it('rotates refresh tokens (old one becomes invalid) and issues a working session', async () => {
      const user = await createUser(app);
      const refresh = /refresh_token=([^;]+)/.exec(user.cookie)![1];

      const res = await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: refresh })
        .expect(200);
      const next = (res.headers['set-cookie'] as unknown as string[])
        .map((c) => c.split(';')[0])
        .join('; ');
      expect(/refresh_token=([^;]+)/.exec(next)![1]).not.toBe(refresh);
      await http().get('/api/v1/auth/me').set('Cookie', next).expect(200);

      await http()
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: refresh })
        .expect(401);
    });

    it('logout revokes the session server-side', async () => {
      const user = await createUser(app);
      await http()
        .post('/api/v1/auth/logout')
        .set('Cookie', user.cookie)
        .expect(200);
      await http()
        .get('/api/v1/auth/me')
        .set('Cookie', user.cookie)
        .expect(401);
    });
  });

  describe('profile', () => {
    it('updates name/avatar, rejects non-https avatars and unknown fields', async () => {
      const user = await createUser(app);
      const res = await api(app, user)
        .patch('/users/me', {
          name: 'Ada',
          avatar: 'https://cdn.example.com/a.png',
        })
        .expect(200);
      expect(res.body.data.name).toBe('Ada');
      expect(res.body.data).not.toHaveProperty('password');

      await api(app, user)
        .patch('/users/me', { avatar: 'http://insecure.example.com/a.png' })
        .expect(400);
      await api(app, user).patch('/users/me', { role: 'ADMIN' }).expect(400);
    });
  });

  describe('SSO', () => {
    it('behaves as not found when a provider is not configured', async () => {
      await http().get('/api/v1/auth/google').expect(404);
      await http().get('/api/v1/auth/google/callback').expect(404);
      await http().post('/api/v1/auth/facebook').send({}).expect(404);
    });
  });

  describe('order emails', () => {
    async function paidOrder(quantity = 1, startsInHours = 100) {
      const organizer = await createUser(app, UserRole.ORGANIZER);
      const buyer = await createUser(app);
      const org = api(app, organizer);
      const event = (
        await org
          .post('/events', {
            name: 'Mail Fest',
            startDate: future(startsInHours),
            endDate: future(startsInHours + 2),
            venue: 'Hall <b>1</b>',
            capacity: 50,
          })
          .expect(201)
      ).body.data;
      await org.post(`/events/${event.id}/publish`).expect(201);
      const ticket = (
        await org
          .post('/tickets', {
            name: 'GA',
            price: 1500,
            quantity: 10,
            eventId: event.id,
          })
          .expect(201)
      ).body.data;
      const order = (
        await api(app, buyer)
          .post('/orders', { items: [{ ticketId: ticket.id, quantity }] })
          .expect(201)
      ).body.data;
      await api(app, buyer)
        .post(`/orders/${order.id}/pay/simulate`)
        .expect(201);
      return { buyer, order, event };
    }

    it('sends one confirmation with the reference, and escapes event data in HTML', async () => {
      const { buyer, order } = await paidOrder(2);
      // fire-and-forget: give it a moment
      await new Promise((r) => setTimeout(r, 300));
      const mails = mailTo(buyer.email).filter((m) =>
        m.subject.includes(order.reference),
      );
      expect(mails).toHaveLength(1);
      expect(mails[0].text).toContain('2 ticket(s)');
      expect(mails[0].text).toContain('$30.00');
      expect(mails[0].html).toContain('Hall &lt;b&gt;1&lt;/b&gt;');
      expect(mails[0].html).not.toContain('<b>1</b>');
    });

    it('sends event reminders exactly once', async () => {
      const { buyer, event } = await paidOrder(1, 12);
      const notifications = app.get(NotificationService);
      const first = await notifications.sendDueReminders(24);
      expect(first).toBeGreaterThanOrEqual(1);
      const reminders = mailTo(buyer.email).filter((m) =>
        m.subject.startsWith('Reminder'),
      );
      expect(reminders).toHaveLength(1);
      expect(
        (await prisma.event.findUniqueOrThrow({ where: { id: event.id } }))
          .reminderSentAt,
      ).not.toBeNull();

      await notifications.sendDueReminders(24);
      expect(
        mailTo(buyer.email).filter((m) => m.subject.startsWith('Reminder')),
      ).toHaveLength(1);
    });
  });
});
