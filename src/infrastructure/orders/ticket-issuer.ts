import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  createTicketCode,
  verifyTicketCode,
} from '../../domain/tickets/ticket-code';

/** Creates one signed IssuedTicket per purchased unit. */
@Injectable()
export class TicketIssuer {
  constructor(private config: ConfigService) {}

  get secret(): string {
    const secret = this.config.get<string>('TICKET_SIGNING_SECRET');
    if (!secret) throw new Error('TICKET_SIGNING_SECRET must be set');
    return secret;
  }

  verify(code: string): string | null {
    return verifyTicketCode(code, this.secret);
  }

  /** Idempotent: does nothing if the order already has tickets. */
  async issueInTx(tx: Prisma.TransactionClient, orderId: string) {
    if ((await tx.issuedTicket.count({ where: { orderId } })) > 0) return;

    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: {
        items: { include: { ticket: { select: { eventId: true } } } },
      },
    });

    const rows: Prisma.IssuedTicketCreateManyInput[] = [];
    for (const item of order.items) {
      for (let i = 0; i < item.quantity; i++) {
        const id = randomUUID();
        rows.push({
          id,
          code: createTicketCode(id, this.secret),
          orderId,
          ticketId: item.ticketId,
          eventId: item.ticket.eventId,
          ownerId: order.userId,
        });
      }
    }
    await tx.issuedTicket.createMany({ data: rows });
  }
}
