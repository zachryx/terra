import { Module } from '@nestjs/common';
import { OrderController } from './controllers/order.controller';
import { OrderRepository } from './repositories/order.repository';
import { TicketIssuer } from './ticket-issuer';
import { OrderExpiryService } from './order-expiry.service';
import { OrderUseCases } from '../../application/orders/use-cases/order.use-cases';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';
import { TicketsModule } from '../tickets/tickets.module';
import { PromoCodesModule } from '../promo-codes/promo-codes.module';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    EventsModule,
    TicketsModule,
    PromoCodesModule,
  ],
  controllers: [OrderController],
  providers: [OrderRepository, OrderUseCases, OrderExpiryService, TicketIssuer],
  exports: [OrderRepository, OrderUseCases, TicketIssuer],
})
export class OrdersModule {}
