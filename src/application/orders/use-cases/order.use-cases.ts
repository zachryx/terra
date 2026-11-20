import { randomBytes } from 'crypto';
import {
  BadRequestException,
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
import { NotificationService } from '../../notifications/notification.service';
import { Page, pageArgs, toPage } from '../../common/pagination';
import { CreateOrderDto, OrderQueryDto } from '../dto/order.dto';
import {
  OrderStatus,
  OrderWithItems,
} from '../../../domain/tickets/entities/order.entity';
import { EventStatus } from '../../../domain/events/entities/event.entity';

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
    private notifications: NotificationService,
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

    const order = await this.orderRepository.placeOrder({
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
    if (order.status === OrderStatus.PAID) {
      void this.notifications.sendOrderConfirmation(order.id);
    }
    return order;
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

  /** Called by the expiry job. Returns how many orders were released. */
  async expireStaleOrders(limit = 100): Promise<number> {
    const ids = await this.orderRepository.findExpiredPendingIds(
      new Date(),
      limit,
    );
    let released = 0;
    for (const id of ids) {
      if (
        await this.orderRepository.releaseOrder(
          id,
          [OrderStatus.PENDING],
          OrderStatus.CANCELLED,
        )
      ) {
        released++;
      }
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
