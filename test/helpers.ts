import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import * as request from 'supertest';
import { UserRole } from '@prisma/client';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';

export const PASSWORD = 'Str0ng!Passw0rd#1';

export async function createApp(): Promise<INestApplication> {
  process.env.JWT_SECRET ??= 'e2e-test-secret';
  process.env.TICKET_SIGNING_SECRET ??= 'e2e-ticket-secret';
  process.env.PAYMENT_PROVIDER = 'fake';
  process.env.MAIL_PROVIDER = 'log';
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication({ rawBody: true });
  configureApp(app);
  await app.init();
  // One real listener (ephemeral port) shared by all requests; supertest would
  // otherwise open a new server per call and reset connections under bursts.
  await app.listen(0);
  return app;
}

export interface TestUser {
  id: string;
  email: string;
  cookie: string;
}

/**
 * Inserts a verified user directly (cheap bcrypt cost) and logs in through the
 * real endpoint, so authentication itself is exercised.
 */
export async function createUser(
  app: INestApplication,
  role: UserRole = UserRole.ATTENDEE,
): Promise<TestUser> {
  const prisma = app.get(PrismaService);
  const email = `${randomUUID()}@e2e.test`;
  const user = await prisma.user.create({
    data: {
      email,
      password: await bcrypt.hash(PASSWORD, 4),
      role,
      isVerified: true,
    },
  });
  const res = await request(app.getHttpServer())
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD })
    .expect(200);
  const cookie = (res.headers['set-cookie'] as unknown as string[])
    .map((c) => c.split(';')[0])
    .join('; ');
  return { id: user.id, email, cookie };
}

export function api(app: INestApplication, user: TestUser) {
  const server = app.getHttpServer();
  return {
    get: (url: string) =>
      request(server).get(`/api/v1${url}`).set('Cookie', user.cookie),
    patch: (url: string, body?: object) =>
      request(server)
        .patch(`/api/v1${url}`)
        .set('Cookie', user.cookie)
        .send(body ?? {}),
    post: (url: string, body?: object) =>
      request(server)
        .post(`/api/v1${url}`)
        .set('Cookie', user.cookie)
        .send(body ?? {}),
  };
}
