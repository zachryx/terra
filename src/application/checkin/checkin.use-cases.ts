import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { TicketIssuer } from '../../infrastructure/orders/ticket-issuer';
import { Actor } from '../orders/use-cases/order.use-cases';
import * as QRCode from 'qrcode';

@Injectable()
export class CheckinUseCases {
  constructor(
    private prisma: PrismaService,
    private issuer: TicketIssuer,
  ) {}

  /** Tickets for an order. Owner or admin only. */
  async listOrderTickets(orderId: string, user: Actor) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { userId: true },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== user.id && user.role !== 'ADMIN') {
      throw new ForbiddenException('You can only view your own tickets');
    }
    return this.prisma.issuedTicket.findMany({
      where: { orderId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        code: true,
        status: true,
        eventId: true,
        ticket: { select: { name: true, ticketType: true } },
        checkedInAt: true,
      },
    });
  }

  async qrPng(issuedTicketId: string, user: Actor): Promise<Buffer> {
    const ticket = await this.prisma.issuedTicket.findUnique({
      where: { id: issuedTicketId },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');
    if (ticket.ownerId !== user.id && user.role !== 'ADMIN') {
      throw new ForbiddenException('You can only view your own tickets');
    }
    if (ticket.status === 'VOID') {
      throw new BadRequestException('Ticket is void');
    }
    return QRCode.toBuffer(ticket.code, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
    });
  }

  /** Scan a ticket code at the door. */
  async checkIn(code: string, user: Actor, expectedEventId?: string) {
    const id = this.issuer.verify(code);
    if (!id) {
      throw new BadRequestException({
        message: 'Invalid ticket code',
        code: 'INVALID_CODE',
      });
    }

    const ticket = await this.prisma.issuedTicket.findUnique({
      where: { id },
      include: {
        event: { select: { organizerId: true, name: true } },
        ticket: { select: { name: true, ticketType: true } },
      },
    });
    if (!ticket) {
      throw new BadRequestException({
        message: 'Invalid ticket code',
        code: 'INVALID_CODE',
      });
    }
    if (user.role !== 'ADMIN' && ticket.event.organizerId !== user.id) {
      throw new ForbiddenException(
        'You can only check in tickets for your own events',
      );
    }
    if (expectedEventId && ticket.eventId !== expectedEventId) {
      throw new BadRequestException({
        message: 'Ticket is for a different event',
        code: 'WRONG_EVENT',
      });
    }
    if (ticket.status === 'VOID') {
      throw new BadRequestException({
        message: 'Ticket is void (refunded or cancelled)',
        code: 'VOID',
      });
    }

    // Compare-and-set: of any number of simultaneous scans, exactly one wins.
    const now = new Date();
    const won = await this.prisma.issuedTicket.updateMany({
      where: { id, status: 'VALID' },
      data: { status: 'CHECKED_IN', checkedInAt: now, checkedInBy: user.id },
    });
    if (won.count === 0) {
      const current = await this.prisma.issuedTicket.findUniqueOrThrow({
        where: { id },
      });
      throw new ConflictException({
        message: 'Ticket already checked in',
        code: 'ALREADY_CHECKED_IN',
        checkedInAt: current.checkedInAt,
      });
    }

    return {
      id,
      eventId: ticket.eventId,
      eventName: ticket.event.name,
      ticketName: ticket.ticket.name,
      ticketType: ticket.ticket.ticketType,
      checkedInAt: now,
    };
  }

  async stats(eventId: string, user: Actor) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { organizerId: true, capacity: true },
    });
    if (!event) throw new NotFoundException('Event not found');
    if (user.role !== 'ADMIN' && event.organizerId !== user.id) {
      throw new ForbiddenException(
        'You can only view stats for your own events',
      );
    }

    const grouped = await this.prisma.issuedTicket.groupBy({
      by: ['status'],
      where: { eventId },
      _count: { _all: true },
    });
    const count = (s: string) =>
      grouped.find((g) => g.status === s)?._count._all ?? 0;
    const checkedIn = count('CHECKED_IN');
    const valid = count('VALID');
    const issued = checkedIn + valid;
    return {
      eventId,
      capacity: event.capacity,
      issued,
      checkedIn,
      remaining: valid,
      void: count('VOID'),
      checkInRate:
        issued === 0 ? 0 : Math.round((checkedIn / issued) * 1000) / 10,
    };
  }
}
