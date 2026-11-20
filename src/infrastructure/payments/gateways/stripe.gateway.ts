import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  CreatedPayment,
  CreatePaymentParams,
  GatewayEvent,
  IPaymentGateway,
} from '../../../domain/payments/payment-gateway.interface';

@Injectable()
export class StripeGateway implements IPaymentGateway {
  readonly provider = 'stripe';
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(config: ConfigService) {
    const key = config.get<string>('STRIPE_SECRET_KEY');
    const webhookSecret = config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!key || !webhookSecret) {
      throw new Error(
        'STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are required when PAYMENT_PROVIDER=stripe',
      );
    }
    this.stripe = new Stripe(key);
    this.webhookSecret = webhookSecret;
  }

  async createPayment(params: CreatePaymentParams): Promise<CreatedPayment> {
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: params.amount,
        currency: params.currency.toLowerCase(),
        receipt_email: params.customerEmail,
        automatic_payment_methods: { enabled: true },
        metadata: { orderId: params.orderId, reference: params.reference },
      },
      { idempotencyKey: `pi-${params.idempotencyKey}` },
    );
    return { providerRef: intent.id, clientSecret: intent.client_secret! };
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): GatewayEvent {
    if (!signature) throw new BadRequestException('Missing webhook signature');
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
    } catch {
      throw new BadRequestException('Invalid webhook signature');
    }

    if (
      event.type === 'payment_intent.succeeded' ||
      event.type === 'payment_intent.payment_failed'
    ) {
      const intent = event.data.object as Stripe.PaymentIntent;
      return {
        id: event.id,
        type:
          event.type === 'payment_intent.succeeded'
            ? 'payment.succeeded'
            : 'payment.failed',
        providerRef: intent.id,
        amount: intent.amount_received ?? 0,
      };
    }
    return { id: event.id, type: 'ignored', providerRef: '', amount: 0 };
  }

  async refund(params: {
    idempotencyKey: string;
    providerRef: string;
    amount: number;
  }): Promise<void> {
    await this.stripe.refunds.create(
      { payment_intent: params.providerRef, amount: params.amount },
      { idempotencyKey: `refund-${params.idempotencyKey}` },
    );
  }
}
