import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderUseCases } from '../../application/orders/use-cases/order.use-cases';

/** Releases stock held by unpaid orders once their hold window has passed. */
@Injectable()
export class OrderExpiryService {
  private readonly logger = new Logger(OrderExpiryService.name);

  constructor(private orderUseCases: OrderUseCases) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async releaseExpiredOrders() {
    try {
      const released = await this.orderUseCases.expireStaleOrders();
      if (released > 0) {
        this.logger.log(`Released ${released} expired order(s)`);
      }
    } catch (err) {
      this.logger.error('Failed to release expired orders', err as Error);
    }
  }
}
