import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  CreatedPayment,
  CreatePaymentParams,
  GatewayEvent,
  IPaymentGateway,
} from '../../../domain/payments/payment-gateway.interface';

/**
 * In-process gateway for local dev, demos and tests. No external account needed.
 * Webhooks use the same shape as a real provider: a raw JSON body signed with
 * an HMAC, so signature verification is exercised for real.
 */
@Injectable()
export class FakeGateway implements IPaymentGateway {
  readonly provider = 'fake';
  static readonly SIGNATURE_HEADER = 'x-terra-signature';

  constructor(private config: ConfigService) {}

  private get secret(): string {
    return (
      this.config.get<string>('FAKE_WEBHOOK_SECRET') ??
      'dev-fake-webhook-secret'
    );
  }

  async createPayment(params: CreatePaymentParams): Promise<CreatedPayment> {
    const providerRef = `fake_pi_${params.orderId}`;
    return { providerRef, clientSecret: `${providerRef}_secret` };
  }

  sign(rawBody: Buffer | string): string {
    return createHmac('sha256', this.secret).update(rawBody).digest('hex');
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): GatewayEvent {
    const expected = Buffer.from(this.sign(rawBody));
    const given = Buffer.from(signature ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new BadRequestException('Invalid webhook signature');
    }
    let body: any;
    try {
      body = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new BadRequestException('Malformed webhook body');
    }
    const type =
      body.type === 'payment.succeeded' || body.type === 'payment.failed'
        ? body.type
        : 'ignored';
    return {
      id: String(body.id),
      type,
      providerRef: String(body.providerRef),
      amount: Number(body.amount ?? 0),
    };
  }

  async refund(): Promise<void> {
    // Nothing to call: the fake provider always accepts refunds.
  }
}
