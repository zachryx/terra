import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  IPaymentGateway,
  PAYMENT_GATEWAY,
} from '../../domain/payments/payment-gateway.interface';
import { PaymentRepository } from '../../infrastructure/payments/repositories/payment.repository';
import { OrderRepository } from '../../infrastructure/orders/repositories/order.repository';
import { OrderStatus } from '../../domain/tickets/entities/order.entity';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { Actor } from '../orders/use-cases/order.use-cases';

@Injectable()
export class PaymentUseCases {
  private readonly logger = new Logger(PaymentUseCases.name);

  constructor(
    @Inject(PAYMENT_GATEWAY) private gateway: IPaymentGateway,
    private paymentRepository: PaymentRepository,
    private orderRepository: OrderRepository,
    private prisma: PrismaService,
  ) {}

  get provider(): string {
    return this.gateway.provider;
  }

  async startPayment(orderId: string, user: Actor) {
    const order = await this.orderRepository.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');
    if (order.userId !== user.id) {
      throw new ForbiddenException('You can only pay for your own orders');
    }
    if (order.status !== OrderStatus.PENDING) {
      throw new BadRequestException(`Order is ${order.status.toLowerCase()}`);
    }
    if (order.expiresAt && order.expiresAt < new Date()) {
      throw new BadRequestException('Order has expired');
    }

    const owner = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: { email: true },
    });
    const created = await this.gateway.createPayment({
      idempotencyKey: order.id,
      orderId: order.id,
      reference: order.reference,
      amount: order.finalAmount,
      currency: order.currency,
      customerEmail: owner?.email,
    });
    const payment = await this.paymentRepository.upsertPending({
      orderId: order.id,
      provider: this.gateway.provider,
      providerRef: created.providerRef,
      amount: order.finalAmount,
      currency: order.currency,
    });

    return {
      paymentId: payment.id,
      provider: this.gateway.provider,
      clientSecret: created.clientSecret,
      amount: payment.amount,
      currency: payment.currency,
    };
  }

  /** Entry point for provider webhooks. Safe to call repeatedly with the same event. */
  async handleWebhook(rawBody: Buffer, signature: string | undefined) {
    const event = this.gateway.parseWebhook(rawBody, signature);
    const entry = {
      id: event.id,
      provider: this.gateway.provider,
      type: event.type,
    };

    if (event.type === 'payment.succeeded') {
      const result = await this.paymentRepository.settleSuccess(
        entry,
        event.providerRef,
        event.amount,
      );
      if (result === 'needs_refund') {
        await this.refundLatePayment(event.providerRef);
      } else if (result === 'amount_mismatch') {
        this.logger.error(
          `Amount mismatch for ${event.providerRef}; order left unpaid`,
        );
      }
      return { received: true, result };
    }

    if (event.type === 'payment.failed') {
      await this.paymentRepository.recordFailure(entry, event.providerRef);
      return { received: true, result: 'failed_recorded' };
    }

    return { received: true, result: 'ignored' };
  }

  private async refundLatePayment(providerRef: string) {
    const payment = await this.paymentRepository.findByProviderRef(providerRef);
    if (!payment) return;
    await this.gateway.refund({
      idempotencyKey: payment.orderId,
      providerRef,
      amount: payment.amount,
    });
    await this.paymentRepository.markRefunded(payment.id);
    this.logger.warn(`Auto-refunded late payment for order ${payment.orderId}`);
  }

  /** Refund a paid order: organizer of the event or an admin. */
  async refundOrder(orderId: string, user: Actor) {
    const order = await this.orderRepository.findById(orderId);
    if (!order) throw new NotFoundException('Order not found');

    const organizerId = await this.orderRepository.findOrganizerId(orderId);
    if (user.role !== 'ADMIN' && organizerId !== user.id) {
      throw new ForbiddenException(
        'Only the event organizer or an admin can refund this order',
      );
    }
    if (order.status !== OrderStatus.PAID) {
      throw new BadRequestException('Only paid orders can be refunded');
    }

    const checkedIn = await this.prisma.issuedTicket.count({
      where: { orderId, status: 'CHECKED_IN' },
    });
    if (checkedIn > 0) {
      throw new BadRequestException(
        'Cannot refund an order with checked-in tickets',
      );
    }

    const payment = await this.paymentRepository.findSucceededForOrder(orderId);
    if (payment) {
      // Gateway first, keyed by order, so a retry after a partial failure is safe.
      await this.gateway.refund({
        idempotencyKey: order.id,
        providerRef: payment.providerRef!,
        amount: payment.amount,
      });
      await this.paymentRepository.markRefunded(payment.id);
    }

    await this.orderRepository.releaseOrder(
      orderId,
      [OrderStatus.PAID],
      OrderStatus.REFUNDED,
    );
    return this.orderRepository.findById(orderId);
  }
}
