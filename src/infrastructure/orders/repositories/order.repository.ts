import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { IOrderRepository } from '../../../domain/tickets/repositories/order.repository.interface';
import {
  OrderFilters,
  OrderStatus,
  OrderWithItems,
  PlaceOrderInput,
} from '../../../domain/tickets/entities/order.entity';

type Tx = Prisma.TransactionClient;

@Injectable()
export class OrderRepository implements IOrderRepository {
  constructor(private prisma: PrismaService) {}

  async placeOrder(input: PlaceOrderInput): Promise<OrderWithItems> {
    return this.prisma.$transaction(async (tx) => {
      // Lock tickets in a stable order so concurrent multi-ticket orders
      // can't deadlock each other.
      const items = [...input.items].sort((a, b) =>
        a.ticketId.localeCompare(b.ticketId),
      );
      for (const item of items) {
        // Single atomic statement: the capacity check and the increment can't
        // be separated, so two buyers can never both take the last ticket.
        const affected = await tx.$executeRaw`
          UPDATE "Ticket"
          SET "sold" = "sold" + ${item.quantity}::int
          WHERE "id" = ${item.ticketId}
            AND "sold" + ${item.quantity}::int <= "quantity"`;
        if (affected === 0) {
          throw new ConflictException(
            'Not enough tickets available. Someone else may have just bought them.',
          );
        }
      }

      if (input.promo) {
        await this.reservePromo(tx, input.promo.id, input.userId);
      }

      const order = await tx.order.create({
        data: {
          reference: input.reference,
          userId: input.userId,
          currency: input.currency,
          totalAmount: input.totalAmount,
          discountAmount: input.discountAmount,
          finalAmount: input.finalAmount,
          status:
            input.finalAmount === 0 ? OrderStatus.PAID : OrderStatus.PENDING,
          expiresAt: input.finalAmount === 0 ? null : input.expiresAt,
          promoCodeId: input.promo?.id,
          items: {
            create: input.items.map((i) => ({
              ticketId: i.ticketId,
              quantity: i.quantity,
              price: i.unitPrice,
            })),
          },
        },
        include: { items: true },
      });

      if (input.promo) {
        await tx.promoCodeUsage.create({
          data: {
            promoCodeId: input.promo.id,
            userId: input.userId,
            orderId: order.id,
            discountAmount: input.discountAmount,
          },
        });
      }

      return order as OrderWithItems;
    });
  }

  private async reservePromo(tx: Tx, promoCodeId: string, userId: string) {
    // Serialise concurrent redemptions by the same user so the per-user limit
    // can't be raced past with parallel requests.
    const lockKey = `${promoCodeId}:${userId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}::text))`;

    const promo = await tx.promoCode.findUnique({
      where: { id: promoCodeId },
      select: { maxUsesPerUser: true },
    });
    const userUses = await tx.promoCodeUsage.count({
      where: { promoCodeId, userId },
    });
    if (!promo || userUses >= promo.maxUsesPerUser) {
      throw new BadRequestException('You have already used this promo code');
    }

    // Atomic global limit check + increment.
    const affected = await tx.$executeRaw`
      UPDATE "PromoCode"
      SET "usedCount" = "usedCount" + 1
      WHERE "id" = ${promoCodeId}
        AND "isActive" = true
        AND ("maxUses" IS NULL OR "usedCount" < "maxUses")`;
    if (affected === 0) {
      throw new BadRequestException('Promo code usage limit reached');
    }
  }

  async releaseOrder(
    orderId: string,
    from: OrderStatus[],
    to: OrderStatus,
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      // Compare-and-set on status: only one caller wins a transition.
      const moved = await tx.order.updateMany({
        where: { id: orderId, status: { in: from } },
        data: { status: to, expiresAt: null },
      });
      if (moved.count === 0) return false;

      const items = await tx.orderItem.findMany({ where: { orderId } });
      for (const item of [...items].sort((a, b) =>
        a.ticketId.localeCompare(b.ticketId),
      )) {
        await tx.$executeRaw`
          UPDATE "Ticket"
          SET "sold" = GREATEST("sold" - ${item.quantity}::int, 0)
          WHERE "id" = ${item.ticketId}`;
      }

      const usages = await tx.promoCodeUsage.findMany({ where: { orderId } });
      for (const usage of usages) {
        await tx.promoCodeUsage.delete({ where: { id: usage.id } });
        await tx.$executeRaw`
          UPDATE "PromoCode"
          SET "usedCount" = GREATEST("usedCount" - 1, 0)
          WHERE "id" = ${usage.promoCodeId}`;
      }
      return true;
    });
  }

  async findById(id: string): Promise<OrderWithItems | null> {
    return this.prisma.order.findUnique({
      where: { id },
      include: { items: true },
    }) as Promise<OrderWithItems | null>;
  }

  async findAll(filters?: OrderFilters): Promise<OrderWithItems[]> {
    return this.prisma.order.findMany({
      where: { userId: filters?.userId, status: filters?.status },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    }) as Promise<OrderWithItems[]>;
  }

  async findExpiredPendingIds(now: Date, limit: number): Promise<string[]> {
    const rows = await this.prisma.order.findMany({
      where: { status: OrderStatus.PENDING, expiresAt: { lt: now } },
      select: { id: true },
      take: limit,
    });
    return rows.map((r) => r.id);
  }
}
