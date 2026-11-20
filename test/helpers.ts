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

export interface AppOptions {
  /** Enable Redis for this app instance. Default: off, whatever the shell has set. */
  redisUrl?: string;
  /** Extra env applied before the app is created (e.g. STRICT_THROTTLE_LIMIT). */
  env?: Record<string, string>;
}

/** Redis used by the Redis-specific suites; they are skipped when unset. */
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL;

export async function createApp(
  opts: AppOptions = {},
): Promise<INestApplication> {
  if (opts.redisUrl) process.env.REDIS_URL = opts.redisUrl;
  else delete process.env.REDIS_URL;
  Object.assign(process.env, opts.env ?? {});
  process.env.JWT_SECRET ??= 'e2e-test-secret';
  process.env.TICKET_SIGNING_SECRET ??= 'e2e-ticket-secret';
  process.env.PAYMENT_PROVIDER = 'fake';
  // Tests create many users/orders from one IP; production limits stay default.
  process.env.THROTTLE_LIMIT ??= '100000';
  process.env.STRICT_THROTTLE_LIMIT ??= '100000';
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

/**
 * Follows `nextCursor` until exhausted and returns every item id. The shared
 * test DB holds many rows, so a new row isn't necessarily on page 1.
 */
export async function listIds(
  client: ReturnType<typeof api>,
  path: string,
  maxPages = 200,
): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  const sep = path.includes('?') ? '&' : '?';
  for (let i = 0; i < maxPages; i++) {
    const res = await client.get(
      `${path}${sep}limit=100${cursor ? `&cursor=${cursor}` : ''}`,
    );
    if (res.status !== 200) {
      throw new Error(
        `GET ${path} -> ${res.status} ${JSON.stringify(res.body)}`,
      );
    }
    ids.push(...res.body.data.items.map((x: { id: string }) => x.id));
    cursor = res.body.data.nextCursor;
    if (!cursor) break;
  }
  return ids;
}

export function api(app: INestApplication, user: TestUser) {
  const server = app.getHttpServer();
  return {
    get: (url: string) =>
      request(server).get(`/api/v1${url}`).set('Cookie', user.cookie),
    put: (url: string, body?: object) =>
      request(server)
        .put(`/api/v1${url}`)
        .set('Cookie', user.cookie)
        .send(body ?? {}),
    delete: (url: string) =>
      request(server).delete(`/api/v1${url}`).set('Cookie', user.cookie),
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
