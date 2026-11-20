import { randomBytes } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrderRepository } from '../../../infrastructure/orders/repositories/order.repository';
import { TicketRepository } from '../../../infrastructure/tickets/repositories/ticket.repository';
import { EventRepository } from '../../../infrastructure/events/repositories/event.repository';
import { PromoCodeRepository } from '../../../infrastructure/promo-codes/repositories/promo-code.repository';
import { PromoCodeUseCases } from '../../promo-codes/use-cases/promo-code.use-cases';
import { MetricsService } from '../../../infrastructure/metrics/metrics.service';
import { StockGate } from '../../../infrastructure/redis/stock-gate.service';
import { OutboxRelay } from '../../../infrastructure/queue/outbox.relay';
import { Page, pageArgs, toPage } from '../../common/pagination';
import { CreateOrderDto, OrderQueryDto } from '../dto/order.dto';
import {
  OrderStatus,
  OrderWithItems,
} from '../../../domain/tickets/entities/order.entity';
import { EventStatus } from '../../../domain/events/entities/event.entity';

const SOLD_OUT_MESSAGE =
  'Not enough tickets available. Someone else may have just bought them.';

export interface Actor {
  id: string;
  role: string;
}

@Injectable()
export class OrderUseCases {
  constructor(
    private orderRepository: OrderRepository,
    private ticketRepository: TicketRepository,
    private eventRepository: EventRepository,
    private promoCodeUseCases: PromoCodeUseCases,
    private promoCodeRepository: PromoCodeRepository,
    private config: ConfigService,
    private outbox: OutboxRelay,
    private stockGate: StockGate,
    private metrics: MetricsService,
  ) {}

  async create(dto: CreateOrderDto, user: Actor): Promise<OrderWithItems> {
    // Collapse repeated ticket lines into one.
    const wanted = new Map<string, number>();
    for (const item of dto.items) {
      wanted.set(
        item.ticketId,
        (wanted.get(item.ticketId) ?? 0) + item.quantity,
      );
    }

    const tickets = await this.ticketRepository.findByIds([...wanted.keys()]);
    if (tickets.length !== wanted.size) {
      throw new NotFoundException('One or more tickets were not found');
    }

    const eventIds = new Set(tickets.map((t) => t.eventId));
    if (eventIds.size > 1) {
      throw new BadRequestException('An order can only contain one event');
    }
    const eventId = tickets[0].eventId;
    const event = await this.eventRepository.findById(eventId);
    if (!event || event.status !== EventStatus.PUBLISHED) {
      throw new BadRequestException('Event is not open for sales');
    }
    const now = new Date();
    if (event.endDate < now) {
      throw new BadRequestException('Event has already ended');
    }

    let totalAmount = 0;
    const items = tickets.map((ticket) => {
      const quantity = wanted.get(ticket.id)!;
      if (ticket.saleStartDate && now < ticket.saleStartDate) {
        throw new BadRequestException(
          `Sales for "${ticket.name}" have not started`,
        );
      }
      if (ticket.saleEndDate && now > ticket.saleEndDate) {
        throw new BadRequestException(`Sales for "${ticket.name}" have ended`);
      }
      if (quantity < ticket.minPerOrder || quantity > ticket.maxPerOrder) {
        throw new BadRequestException(
          `"${ticket.name}": quantity must be between ${ticket.minPerOrder} and ${ticket.maxPerOrder}`,
        );
      }
      totalAmount += ticket.price * quantity;
      return { ticketId: ticket.id, quantity, unitPrice: ticket.price };
    });

    let discountAmount = 0;
    let promo: { id: string } | undefined;
    if (dto.promoCode) {
      // A promo tied to one ticket only discounts that ticket's lines.
      const row = await this.promoCodeRepository.findByCode(dto.promoCode);
      let eligibleAmount = totalAmount;
      if (row?.ticketTypeId) {
        eligibleAmount = items
          .filter((i) => i.ticketId === row.ticketTypeId)
          .reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
        if (eligibleAmount === 0) {
          throw new BadRequestException(
            'Promo code does not apply to the selected tickets',
          );
        }
      }
      const result = await this.promoCodeUseCases.validate(
        {
          code: dto.promoCode,
          purchaseAmount: eligibleAmount,
          eventId,
        },
        user.id,
      );
      if (!result.valid || !result.promoCode) {
        throw new BadRequestException(result.message ?? 'Invalid promo code');
      }
      discountAmount = result.discountAmount;
      promo = { id: result.promoCode.id };
    }

    const holdMinutes = Number(this.config.get('ORDER_HOLD_MINUTES') ?? 15);

    // Fast path: known sold out -> no DB transaction at all.
    const ticketIds = items.map((i) => i.ticketId);
    if (await this.stockGate.anySoldOut(ticketIds)) {
      this.metrics.checkoutRejected.inc({ reason: 'sold_out_gate' });
      throw new ConflictException(SOLD_OUT_MESSAGE);
    }

    let order: OrderWithItems;
    try {
      order = await this.orderRepository.placeOrder({
        reference: OrderUseCases.generateReference(),
        userId: user.id,
        currency: this.config.get('DEFAULT_CURRENCY') ?? 'USD',
        items,
        totalAmount,
        discountAmount,
        finalAmount: totalAmount - discountAmount,
        expiresAt: new Date(now.getTime() + holdMinutes * 60_000),
        promo,
      });
    } catch (err) {
      if (err instanceof ConflictException) {
        this.metrics.checkoutRejected.inc({ reason: 'stock_conflict' });
        await this.flagSoldOut(ticketIds);
      }
      throw err;
    }
    this.metrics.ordersCreated.inc({ status: order.status });
    if (order.status === OrderStatus.PAID) {
      this.outbox.kick();
    }
    return order;
  }

  /** After a stock conflict, remember which tickets are actually exhausted. */
  private async flagSoldOut(ticketIds: string[]): Promise<void> {
    const rows = await this.ticketRepository.findByIds(ticketIds);
    await Promise.all(
      rows
        .filter((t) => t.sold >= t.quantity)
        .map((t) => this.stockGate.markSoldOut(t.id)),
    );
  }

  async findById(id: string, user: Actor): Promise<OrderWithItems> {
    const order = await this.orderRepository.findById(id);
    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== user.id && user.role !== 'ADMIN') {
      throw new ForbiddenException('You can only view your own orders');
    }
    return order;
  }

  async findAll(
    query: OrderQueryDto,
    user: Actor,
  ): Promise<Page<OrderWithItems>> {
    const rows = await this.orderRepository.findAll(
      {
        userId: user.role === 'ADMIN' ? undefined : user.id,
        status: query.status,
      },
      pageArgs(query),
    );
    return toPage(rows, query);
  }

  async cancel(id: string, user: Actor): Promise<OrderWithItems> {
    await this.findById(id, user); // existence + ownership
    const released = await this.orderRepository.releaseOrder(
      id,
      [OrderStatus.PENDING],
      OrderStatus.CANCELLED,
    );
    if (!released) {
      throw new BadRequestException('Only pending orders can be cancelled');
    }
    return this.findById(id, user);
  }

  /**
   * Called by the expiry job. Releases expired holds oldest-first and keeps
   * going in batches until the backlog is clear (bounded by `maxBatches`, so a
   * huge backlog can't pin the worker; the next run continues where this stopped).
   * Returns how many orders were released.
   */
  async expireStaleOrders(batchSize = 100, maxBatches = 50): Promise<number> {
    let released = 0;
    for (let batch = 0; batch < maxBatches; batch++) {
      const ids = await this.orderRepository.findExpiredPendingIds(
        new Date(),
        batchSize,
      );
      if (ids.length === 0) break;

      let progressed = 0;
      for (const id of ids) {
        if (
          await this.orderRepository.releaseOrder(
            id,
            [OrderStatus.PENDING],
            OrderStatus.CANCELLED,
          )
        ) {
          released++;
          progressed++;
        }
      }
      // Another worker is draining the same rows; stop rather than spin.
      if (progressed === 0 || ids.length < batchSize) break;
    }
    return released;
  }

  static generateReference(): string {
    // Crockford-ish base32, no ambiguous characters.
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    const bytes = randomBytes(10);
    let out = '';
    for (const b of bytes) out += alphabet[b % alphabet.length];
    return `ORD-${out}`;
  }
}
