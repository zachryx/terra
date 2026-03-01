import {
  Order,
  CreateOrderInput,
  UpdateOrderInput,
  OrderFilters,
  OrderItem,
} from '../entities/order.entity';

export interface IOrderRepository {
  create(data: CreateOrderInput): Promise<Order>;
  findById(id: string): Promise<Order | null>;
  findAll(filters?: OrderFilters): Promise<Order[]>;
  findByUserId(userId: string): Promise<Order[]>;
  update(id: string, data: UpdateOrderInput): Promise<Order>;
  updateStatus(id: string, status: string): Promise<Order>;
  delete(id: string): Promise<void>;
  getOrderItems(orderId: string): Promise<OrderItem[]>;
}
