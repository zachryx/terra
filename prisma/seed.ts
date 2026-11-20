/**
 * Demo data: three users, two events, tickets, promo codes and a few paid
 * orders with signed tickets. Safe to re-run (skips if the demo already exists).
 *
 *   npm run seed
 */
import 'dotenv/config';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '@prisma/client';
import { createTicketCode } from '../src/domain/tickets/ticket-code';

const PASSWORD = 'Demo!Passw0rd#1';

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.env.SEED_FORCE) {
    throw new Error('Refusing to seed in production (set SEED_FORCE=1 to override)');
  }
  const secret = process.env.TICKET_SIGNING_SECRET;
  if (!secret) throw new Error('TICKET_SIGNING_SECRET must be set');

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL as string }),
  });

  try {
    const hash = await bcrypt.hash(PASSWORD, 12);
    const user = (email: string, name: string, role: UserRole) =>
      prisma.user.upsert({
        where: { email },
        update: {},
        create: { email, name, role, password: hash, isVerified: true },
      });

    const admin = await user('admin@terra.demo', 'Terra Admin', UserRole.ADMIN);
    const organizer = await user('organizer@terra.demo', 'Olu Organizer', UserRole.ORGANIZER);
    const attendee = await user('attendee@terra.demo', 'Ada Attendee', UserRole.ATTENDEE);

    if ((await prisma.event.count({ where: { organizerId: organizer.id } })) > 0) {
      console.log('Demo events already exist; nothing to do.');
      return;
    }

    const day = 86_400_000;
    const at = (days: number, hour = 18) => {
      const d = new Date(Date.now() + days * day);
      d.setUTCHours(hour, 0, 0, 0);
      return d;
    };

    const summit = await prisma.event.create({
      data: {
        name: 'Lagos Tech Summit',
        description: 'A day of talks, workshops and networking for builders.',
        startDate: at(21, 9),
        endDate: at(21, 18),
        venue: 'Landmark Centre, Lagos',
        capacity: 400,
        status: 'PUBLISHED',
        organizerId: organizer.id,
      },
    });
    const concert = await prisma.event.create({
      data: {
        name: 'Sunset Sessions Live',
        description: 'Open-air live music at golden hour.',
        startDate: at(45, 17),
        endDate: at(45, 23),
        venue: 'Muri Okunola Park, Lagos',
        capacity: 1000,
        status: 'PUBLISHED',
        organizerId: organizer.id,
      },
    });
    await prisma.event.create({
      data: {
        name: 'Founders Dinner (draft)',
        startDate: at(60, 19),
        endDate: at(60, 22),
        venue: 'TBD',
        capacity: 40,
        status: 'DRAFT',
        organizerId: organizer.id,
      },
    });

    const mk = (eventId: string, name: string, ticketType: any, price: number, quantity: number) =>
      prisma.ticket.create({ data: { eventId, name, ticketType, price, quantity } });
    const earlyBird = await mk(summit.id, 'Early Bird', 'EARLY_BIRD', 1500000, 100); // 15,000.00
    const general = await mk(summit.id, 'General Admission', 'GENERAL', 2500000, 250);
    const vip = await mk(summit.id, 'VIP', 'VIP', 7500000, 50);
    await mk(concert.id, 'General', 'GENERAL', 1000000, 800);
    await mk(concert.id, 'VIP Lounge', 'VIP', 4000000, 200);

    const welcome = await prisma.promoCode.create({
      data: {
        code: 'WELCOME10',
        description: '10% off the Summit',
        discountType: 'PERCENTAGE',
        discountValue: 10,
        maxUses: 100,
        maxUsesPerUser: 1,
        eventId: summit.id,
      },
    });
    await prisma.promoCode.create({
      data: {
        code: 'EARLYBIRD5000',
        description: 'Flat 5,000 off',
        discountType: 'FIXED',
        discountValue: 500000,
        eventId: summit.id,
      },
    });

    // A few paid orders, issued exactly as the payment webhook would.
    const place = async (
      ticket: { id: string; price: number },
      quantity: number,
      promo?: { id: string; discount: number },
    ) => {
      const total = ticket.price * quantity;
      const discount = promo?.discount ?? 0;
      const order = await prisma.order.create({
        data: {
          reference: `ORD-${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`,
          userId: attendee.id,
          currency: 'NGN',
          totalAmount: total,
          discountAmount: discount,
          finalAmount: total - discount,
          status: 'PAID',
          promoCodeId: promo?.id,
          items: { create: [{ ticketId: ticket.id, quantity, price: ticket.price }] },
        },
      });
      await prisma.ticket.update({ where: { id: ticket.id }, data: { sold: { increment: quantity } } });
      if (promo) {
        await prisma.promoCodeUsage.create({
          data: { promoCodeId: promo.id, userId: attendee.id, orderId: order.id, discountAmount: discount },
        });
        await prisma.promoCode.update({ where: { id: promo.id }, data: { usedCount: { increment: 1 } } });
      }
      await prisma.issuedTicket.createMany({
        data: Array.from({ length: quantity }, () => {
          const id = randomUUID();
          return {
            id,
            code: createTicketCode(id, secret),
            orderId: order.id,
            ticketId: ticket.id,
            eventId: summit.id,
            ownerId: attendee.id,
          };
        }),
      });
      return order;
    };

    await place(earlyBird, 2);
    await place(general, 1, { id: welcome.id, discount: Math.floor(general.price * 0.1) });
    await place(vip, 1);

    console.log('Seeded demo data. Sign in with any of:');
    for (const u of [admin, organizer, attendee]) {
      console.log(`  ${u.role.padEnd(9)} ${u.email}  /  ${PASSWORD}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
