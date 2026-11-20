import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const n = (v: unknown) => Number(v ?? 0);

/** Read-side queries. All money is integer minor units. */
@Injectable()
export class AnalyticsRepository {
  constructor(private prisma: PrismaService) {}

  /** Orders hold a single event, so "belongs to event" = any item's ticket is in it. */
  private orderInEvents(ids: string[]) {
    return Prisma.sql`EXISTS (
      SELECT 1 FROM "OrderItem" oi
      JOIN "Ticket" t ON t."id" = oi."ticketId"
      WHERE oi."orderId" = o."id" AND t."eventId" IN (${Prisma.join(ids)}))`;
  }

  async orderTotals(eventIds: string[], status: 'PAID' | 'REFUNDED') {
    if (eventIds.length === 0)
      return { orders: 0, gross: 0, discounts: 0, net: 0 };
    const [row] = await this.prisma.$queryRaw<any[]>`
      SELECT COUNT(*)::int AS orders,
             COALESCE(SUM(o."totalAmount"), 0)::bigint AS gross,
             COALESCE(SUM(o."discountAmount"), 0)::bigint AS discounts,
             COALESCE(SUM(o."finalAmount"), 0)::bigint AS net
      FROM "Order" o
      WHERE o."status"::text = ${status} AND ${this.orderInEvents(eventIds)}`;
    return {
      orders: n(row.orders),
      gross: n(row.gross),
      discounts: n(row.discounts),
      net: n(row.net),
    };
  }

  async ticketsSold(eventIds: string[]): Promise<number> {
    if (eventIds.length === 0) return 0;
    const [row] = await this.prisma.$queryRaw<any[]>`
      SELECT COALESCE(SUM(oi."quantity"), 0)::bigint AS qty
      FROM "OrderItem" oi
      JOIN "Order" o ON o."id" = oi."orderId"
      JOIN "Ticket" t ON t."id" = oi."ticketId"
      WHERE o."status" = 'PAID' AND t."eventId" IN (${Prisma.join(eventIds)})`;
    return n(row.qty);
  }

  async byTicket(eventId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT t."id", t."name", t."ticketType"::text AS "ticketType", t."price",
             t."quantity" AS capacity,
             COALESCE(SUM(oi."quantity") FILTER (WHERE o."status" = 'PAID'), 0)::bigint AS sold,
             COALESCE(SUM(oi."quantity" * oi."price") FILTER (WHERE o."status" = 'PAID'), 0)::bigint AS revenue
      FROM "Ticket" t
      LEFT JOIN "OrderItem" oi ON oi."ticketId" = t."id"
      LEFT JOIN "Order" o ON o."id" = oi."orderId"
      WHERE t."eventId" = ${eventId}
      GROUP BY t."id"
      ORDER BY t."price" ASC, t."name" ASC`;
    return rows.map((r) => ({
      ticketId: r.id as string,
      name: r.name as string,
      ticketType: r.ticketType as string,
      price: n(r.price),
      capacity: n(r.capacity),
      sold: n(r.sold),
      revenue: n(r.revenue),
    }));
  }

  async promoImpact(eventIds: string[]) {
    if (eventIds.length === 0) return [];
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT p."code", COUNT(*)::int AS orders,
             COALESCE(SUM(o."discountAmount"), 0)::bigint AS discount,
             COALESCE(SUM(o."finalAmount"), 0)::bigint AS revenue
      FROM "Order" o
      JOIN "PromoCode" p ON p."id" = o."promoCodeId"
      WHERE o."status" = 'PAID' AND ${this.orderInEvents(eventIds)}
      GROUP BY p."code"
      ORDER BY discount DESC`;
    return rows.map((r) => ({
      code: r.code as string,
      orders: n(r.orders),
      discount: n(r.discount),
      revenue: n(r.revenue),
    }));
  }

  async dailySales(eventId: string, days: number) {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT to_char(date_trunc('day', o."createdAt"), 'YYYY-MM-DD') AS day,
             SUM(oi."quantity")::bigint AS tickets,
             SUM(oi."quantity" * oi."price")::bigint AS gross
      FROM "OrderItem" oi
      JOIN "Order" o ON o."id" = oi."orderId"
      JOIN "Ticket" t ON t."id" = oi."ticketId"
      WHERE o."status" = 'PAID' AND t."eventId" = ${eventId} AND o."createdAt" >= ${since}
      GROUP BY 1 ORDER BY 1`;
    return rows.map((r) => ({
      day: r.day as string,
      tickets: n(r.tickets),
      gross: n(r.gross),
    }));
  }

  async attendance(eventIds: string[]) {
    if (eventIds.length === 0) return { issued: 0, checkedIn: 0 };
    const grouped = await this.prisma.issuedTicket.groupBy({
      by: ['status'],
      where: { eventId: { in: eventIds } },
      _count: { _all: true },
    });
    const c = (s: string) =>
      grouped.find((g) => g.status === s)?._count._all ?? 0;
    return { issued: c('VALID') + c('CHECKED_IN'), checkedIn: c('CHECKED_IN') };
  }

  attendees(eventId: string) {
    return this.prisma.issuedTicket.findMany({
      where: { eventId, status: { not: 'VOID' } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        status: true,
        checkedInAt: true,
        order: {
          select: {
            reference: true,
            user: { select: { name: true, email: true } },
          },
        },
        ticket: { select: { name: true, ticketType: true } },
      },
    });
  }
}
