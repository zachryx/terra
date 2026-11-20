/**
 * Creates load-test fixtures directly in the DB (cheap bcrypt) and writes
 * loadtest/fixtures.json for the k6 scripts.
 *
 *   USERS=200 STOCK=500 npx ts-node --transpile-only loadtest/prepare.ts
 */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { writeFileSync } from 'fs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const PASSWORD = 'Load!Test#Passw0rd1';
const USERS = Number(process.env.USERS ?? 200);
const STOCK = Number(process.env.STOCK ?? 500);

async function main() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL as string }),
  });
  const run = Date.now().toString(36);
  const hash = await bcrypt.hash(PASSWORD, 4);

  const organizer = await prisma.user.create({
    data: { email: `lt-org-${run}@load.test`, password: hash, role: 'ORGANIZER', isVerified: true },
  });
  await prisma.user.createMany({
    data: Array.from({ length: USERS }, (_, i) => ({
      email: `lt-${run}-${i}@load.test`,
      password: hash,
      isVerified: true,
    })),
  });

  const day = 86_400_000;
  const event = await prisma.event.create({
    data: {
      name: `Load Test ${run}`,
      startDate: new Date(Date.now() + 10 * day),
      endDate: new Date(Date.now() + 11 * day),
      venue: 'k6 Arena',
      capacity: STOCK * 2,
      status: 'PUBLISHED',
      organizerId: organizer.id,
    },
  });
  const hot = await prisma.ticket.create({
    data: { eventId: event.id, name: 'Hot', price: 1000, quantity: STOCK, maxPerOrder: 4 },
  });
  const plenty = await prisma.ticket.create({
    data: { eventId: event.id, name: 'Plenty', price: 500, quantity: STOCK * 100, maxPerOrder: 4 },
  });

  writeFileSync(
    'loadtest/fixtures.json',
    JSON.stringify(
      {
        password: PASSWORD,
        emails: Array.from({ length: USERS }, (_, i) => `lt-${run}-${i}@load.test`),
        eventId: event.id,
        hotTicketId: hot.id,
        hotStock: STOCK,
        plentyTicketId: plenty.id,
      },
      null,
      2,
    ),
  );
  console.log(`fixtures: ${USERS} users, hot ticket stock ${STOCK}, event ${event.id}`);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
