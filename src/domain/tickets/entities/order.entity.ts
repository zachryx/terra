export enum OrderStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
}

/** All monetary values are integers in minor units (cents/kobo). */
export interface Order {
  id: string;
  reference: string;
  userId: string;
  currency: string;
  totalAmount: number;
  discountAmount: number;
  finalAmount: number;
  status: OrderStatus;
  paymentId: string | null;
  promoCodeId: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderItem {
  id: string;
  orderId: string;
  ticketId: string;
  quantity: number;
  /** Unit price snapshotted at purchase time. */
  price: number;
}

export interface OrderWithItems extends Order {
  items: OrderItem[];
}

export interface PlaceOrderItem {
  ticketId: string;
  quantity: number;
  unitPrice: number;
}

export interface PlaceOrderInput {
  reference: string;
  userId: string;
  currency: string;
  items: PlaceOrderItem[];
  totalAmount: number;
  discountAmount: number;
  finalAmount: number;
  /** Null for orders that need no payment (free). */
  expiresAt: Date | null;
  promo?: { id: string };
}

export interface OrderFilters {
  userId?: string;
  status?: OrderStatus;
}
