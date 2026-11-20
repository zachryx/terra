import { Module } from '@nestjs/common';
import { OrderController } from './controllers/order.controller';
import { OrderRepository } from './repositories/order.repository';
import { OrderExpiryService } from './order-expiry.service';
import { OrderUseCases } from '../../application/orders/use-cases/order.use-cases';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';
import { TicketsModule } from '../tickets/tickets.module';
import { PromoCodesModule } from '../promo-codes/promo-codes.module';

@Module({
  imports: [PrismaModule, EventsModule, TicketsModule, PromoCodesModule],
  controllers: [OrderController],
  providers: [OrderRepository, OrderUseCases, OrderExpiryService],
  exports: [OrderRepository, OrderUseCases],
})
export class OrdersModule {}
