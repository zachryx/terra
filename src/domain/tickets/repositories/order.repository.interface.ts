import {
  OrderFilters,
  OrderStatus,
  OrderWithItems,
  PlaceOrderInput,
} from '../entities/order.entity';

export interface IOrderRepository {
  /**
   * Atomically reserves stock, enforces promo limits and persists the order.
   * Throws if any ticket is sold out or the promo can no longer be used.
   */
  placeOrder(input: PlaceOrderInput): Promise<OrderWithItems>;

  findById(id: string): Promise<OrderWithItems | null>;
  findAll(filters?: OrderFilters): Promise<OrderWithItems[]>;

  /**
   * Moves an order from one of `from` to `to` and gives back its stock and
   * promo usage. Returns false (and does nothing) if the order was no longer
   * in a `from` state, which makes it safe against concurrent settlement.
   */
  releaseOrder(
    orderId: string,
    from: OrderStatus[],
    to: OrderStatus,
  ): Promise<boolean>;

  findExpiredPendingIds(now: Date, limit: number): Promise<string[]>;
}
