import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { RedisModule } from './infrastructure/redis/redis.module';
import { REDIS_CLIENT } from './infrastructure/redis/redis.constants';
import { RedisThrottlerStorage } from './infrastructure/redis/redis-throttler.storage';
import { STRICT_THROTTLE_KEY } from './infrastructure/common/throttle/strict-throttle.decorator';
import { ExceptionModule } from './infrastructure/exceptions/exceptions.module';
import { LoggerModule } from './infrastructure/logger/logger.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { AuthModule } from './infrastructure/auth/auth.module';
import { EventsModule } from './infrastructure/events/events.module';
import { TicketsModule } from './infrastructure/tickets/tickets.module';
import { PromoCodesModule } from './infrastructure/promo-codes/promo-codes.module';
import { OrdersModule } from './infrastructure/orders/orders.module';
import { PaymentsModule } from './infrastructure/payments/payments.module';
import { CheckinModule } from './infrastructure/checkin/checkin.module';
import { NotificationsModule } from './infrastructure/notifications/notifications.module';
import { AnalyticsModule } from './infrastructure/analytics/analytics.module';
import { QueueModule } from './infrastructure/queue/queue.module';
import { JobsModule } from './infrastructure/queue/jobs.module';
import { HealthModule } from './infrastructure/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    QueueModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: (config: ConfigService, redis: Redis | null) => ({
        storage: redis
          ? new RedisThrottlerStorage(
              redis,
              config.get('REDIS_NAMESPACE') ?? 'terra',
            )
          : undefined,
        throttlers: [
          {
            name: 'default',
            ttl: 60_000,
            limit: Number(config.get('THROTTLE_LIMIT') ?? 120),
          },
          {
            // Applies only to routes tagged with @StrictThrottle().
            name: 'strict',
            ttl: 60_000,
            limit: Number(config.get('STRICT_THROTTLE_LIMIT') ?? 10),
            skipIf: (ctx) =>
              !Reflect.getMetadata(STRICT_THROTTLE_KEY, ctx.getHandler()),
          },
        ],
      }),
    }),
    ExceptionModule,
    LoggerModule,
    PrismaModule,
    AuthModule,
    EventsModule,
    TicketsModule,
    PromoCodesModule,
    OrdersModule,
    PaymentsModule,
    CheckinModule,
    NotificationsModule,
    AnalyticsModule,
    JobsModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
