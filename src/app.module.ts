import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ExceptionModule } from './infrastructure/exceptions/exceptions.module';
import { LoggerModule } from './infrastructure/logger/logger.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { AuthModule } from './infrastructure/auth/auth.module';
import { EventsModule } from './infrastructure/events/events.module';
import { TicketsModule } from './infrastructure/tickets/tickets.module';
import { PromoCodesModule } from './infrastructure/promo-codes/promo-codes.module';
import { OrdersModule } from './infrastructure/orders/orders.module';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthModule } from './infrastructure/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    ExceptionModule,
    LoggerModule,
    PrismaModule,
    AuthModule,
    EventsModule,
    TicketsModule,
    PromoCodesModule,
    OrdersModule,
    HealthModule,
  ],
  providers: [],
})
export class AppModule {}
