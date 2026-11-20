export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');

export interface CreatePaymentParams {
  /** Stable per order: calling twice must return the same payment. */
  idempotencyKey: string;
  orderId: string;
  reference: string;
  /** Minor units. */
  amount: number;
  currency: string;
  customerEmail?: string;
}

export interface CreatedPayment {
  providerRef: string;
  /** What the frontend needs to complete payment (e.g. Stripe client secret). */
  clientSecret: string;
}

export type GatewayEventType =
  | 'payment.succeeded'
  | 'payment.failed'
  | 'ignored';

export interface GatewayEvent {
  /** Provider's unique event id, used for idempotent processing. */
  id: string;
  type: GatewayEventType;
  providerRef: string;
  /** Minor units actually received (only meaningful for succeeded). */
  amount: number;
}

export interface IPaymentGateway {
  readonly provider: string;
  createPayment(params: CreatePaymentParams): Promise<CreatedPayment>;
  /** Verifies the signature and normalises the provider event. Throws if invalid. */
  parseWebhook(rawBody: Buffer, signature: string | undefined): GatewayEvent;
  refund(params: {
    idempotencyKey: string;
    providerRef: string;
    amount: number;
  }): Promise<void>;
}
