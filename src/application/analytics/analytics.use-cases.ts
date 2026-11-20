import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AnalyticsRepository } from '../../infrastructure/analytics/analytics.repository';
import { Actor } from '../orders/use-cases/order.use-cases';
import { toCsv } from './csv';

const DASHBOARD_EVENT_LIMIT = 20;

@Injectable()
export class AnalyticsUseCases {
  constructor(
    private repo: AnalyticsRepository,
    private prisma: PrismaService,
  ) {}

  private async ownedEvent(eventId: string, user: Actor) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        name: true,
        organizerId: true,
        capacity: true,
        status: true,
      },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (user.role !== 'ADMIN' && event.organizerId !== user.id) {
      throw new ForbiddenException(
        'You can only view analytics for your own events',
      );
    }
    return event;
  }

  private async summary(eventIds: string[]) {
    const [paid, refunded, ticketsSold, attendance] = await Promise.all([
      this.repo.orderTotals(eventIds, 'PAID'),
      this.repo.orderTotals(eventIds, 'REFUNDED'),
      this.repo.ticketsSold(eventIds),
      this.repo.attendance(eventIds),
    ]);
    return {
      paidOrders: paid.orders,
      ticketsSold,
      grossRevenue: paid.gross,
      discounts: paid.discounts,
      netRevenue: paid.net,
      refundedOrders: refunded.orders,
      refundedAmount: refunded.net,
      attendance: {
        ...attendance,
        checkInRate:
          attendance.issued === 0
            ? 0
            : Math.round((attendance.checkedIn / attendance.issued) * 1000) /
              10,
      },
    };
  }

  async eventReport(eventId: string, user: Actor, days = 30) {
    const event = await this.ownedEvent(eventId, user);
    const [summary, tickets, promos, daily] = await Promise.all([
      this.summary([eventId]),
      this.repo.byTicket(eventId),
      this.repo.promoImpact([eventId]),
      this.repo.dailySales(eventId, days),
    ]);
    return {
      event: {
        id: event.id,
        name: event.name,
        capacity: event.capacity,
        status: event.status,
      },
      ...summary,
      sellThroughRate:
        event.capacity === 0
          ? 0
          : Math.round((summary.ticketsSold / event.capacity) * 1000) / 10,
      tickets,
      promos,
      daily,
    };
  }

  async dashboard(user: Actor) {
    const events = await this.prisma.event.findMany({
      where: user.role === 'ADMIN' ? {} : { organizerId: user.id },
      select: { id: true, name: true, status: true, startDate: true },
      orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
    });
    // Totals cover every event; the per-event table is capped so the cost
    // doesn't grow with the number of events an organizer has run.
    const total = await this.summary(events.map((e) => e.id));
    const perEvent = await Promise.all(
      events.slice(0, DASHBOARD_EVENT_LIMIT).map(async (e) => {
        const s = await this.summary([e.id]);
        return {
          id: e.id,
          name: e.name,
          status: e.status,
          startDate: e.startDate,
          ticketsSold: s.ticketsSold,
          netRevenue: s.netRevenue,
          checkedIn: s.attendance.checkedIn,
        };
      }),
    );
    return { events: events.length, ...total, perEvent };
  }

  /** Attendee export. Voided (refunded/cancelled) tickets are excluded. */
  async attendeesCsv(eventId: string, user: Actor): Promise<string> {
    await this.ownedEvent(eventId, user);
    const rows = await this.repo.attendees(eventId);
    return toCsv(
      ['Order', 'Name', 'Email', 'Ticket', 'Type', 'Status', 'Checked in at'],
      rows.map((r) => [
        r.order.reference,
        r.order.user.name,
        r.order.user.email,
        r.ticket.name,
        r.ticket.ticketType,
        r.status,
        r.checkedInAt?.toISOString(),
      ]),
    );
  }
}
