export enum OrderStatus {
  PENDING = 'PENDING',
  PAID = 'PAID',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
}

export interface Order {
  id: string;
  userId: string;
  totalAmount: number;
  status: OrderStatus;
  paymentId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderItem {
  id: string;
  orderId: string;
  ticketId: string;
  quantity: number;
  price: number;
}

export interface CreateOrderInput {
  userId: string;
  items: CreateOrderItemInput[];
}

export interface CreateOrderItemInput {
  ticketId: string;
  quantity: number;
  price: number;
}

export interface UpdateOrderInput {
  status?: OrderStatus;
  paymentId?: string;
}

export interface OrderFilters {
  userId?: string;
  status?: OrderStatus;
}
