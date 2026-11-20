import { Injectable } from '@nestjs/common';
import { Payment, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { INSTANCE_ID } from '../../queue/instance-id';
import { TicketIssuer } from '../../orders/ticket-issuer';
import { OrderStatus } from '../../../domain/tickets/entities/order.entity';

export type SettleResult =
  | 'settled'
  | 'duplicate'
  | 'unknown_payment'
  | 'amount_mismatch'
  | 'needs_refund'
  | 'ignored';

export interface LedgerEntry {
  id: string;
  provider: string;
  type: string;
}

@Injectable()
export class PaymentRepository {
  constructor(
    private prisma: PrismaService,
    private issuer: TicketIssuer,
  ) {}

  upsertPending(data: {
    orderId: string;
    provider: string;
    providerRef: string;
    amount: number;
    currency: string;
  }): Promise<Payment> {
    return this.prisma.payment.upsert({
      where: { providerRef: data.providerRef },
      create: data,
      update: {},
    });
  }

  findByProviderRef(providerRef: string): Promise<Payment | null> {
    return this.prisma.payment.findUnique({ where: { providerRef } });
  }

  findSucceededForOrder(orderId: string): Promise<Payment | null> {
    return this.prisma.payment.findFirst({
      where: { orderId, status: PaymentStatus.SUCCEEDED },
    });
  }

  /**
   * Applies a "payment succeeded" event exactly once. The ledger row, payment
   * update, order transition and ticket issuance commit together or not at all.
   */
  async settleSuccess(
    entry: LedgerEntry,
    providerRef: string,
    amount: number,
  ): Promise<SettleResult> {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { providerRef } });
      if (!payment) return 'unknown_payment';
      if (payment.amount !== amount) return 'amount_mismatch';

      const inserted = await tx.$executeRaw`
        INSERT INTO "WebhookEvent" ("id", "provider", "type")
        VALUES (${entry.id}, ${entry.provider}, ${entry.type})
        ON CONFLICT ("id") DO NOTHING`;
      if (inserted === 0) return 'duplicate';

      await tx.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.SUCCEEDED },
      });

      const moved = await tx.order.updateMany({
        where: { id: payment.orderId, status: OrderStatus.PENDING },
        data: {
          status: OrderStatus.PAID,
          paymentId: payment.id,
          expiresAt: null,
        },
      });
      if (moved.count === 1) {
        await this.issuer.issueInTx(tx, payment.orderId);
        // Same transaction as the state change: if this commits, the event exists.
        await tx.outboxEvent.create({
          data: {
            type: 'order.paid',
            payload: { orderId: payment.orderId, originId: INSTANCE_ID },
          },
        });
        return 'settled';
      }

      const order = await tx.order.findUniqueOrThrow({
        where: { id: payment.orderId },
      });
      // Paid after the hold expired / order was cancelled: money taken, no tickets.
      return order.status === OrderStatus.CANCELLED
        ? 'needs_refund'
        : 'ignored';
    });
  }

  async recordFailure(entry: LedgerEntry, providerRef: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const inserted = await tx.$executeRaw`
        INSERT INTO "WebhookEvent" ("id", "provider", "type")
        VALUES (${entry.id}, ${entry.provider}, ${entry.type})
        ON CONFLICT ("id") DO NOTHING`;
      if (inserted === 0) return;
      await tx.payment.updateMany({
        where: { providerRef, status: PaymentStatus.PENDING },
        data: { status: PaymentStatus.FAILED },
      });
    });
  }

  markRefunded(paymentId: string): Promise<Payment> {
    return this.prisma.payment.update({
      where: { id: paymentId },
      data: { status: PaymentStatus.REFUNDED },
    });
  }
}
