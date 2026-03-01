import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ExceptionModule } from './infrastructure/exceptions/exceptions.module';
import { LoggerModule } from './infrastructure/logger/logger.module';
import { PrismaModule } from './infrastructure/prisma/prisma.module';
import { AuthModule } from './infrastructure/auth/auth.module';
import { EventsModule } from './infrastructure/events/events.module';
import { TicketsModule } from './infrastructure/tickets/tickets.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ExceptionModule,
    LoggerModule,
    PrismaModule,
    AuthModule,
    EventsModule,
    TicketsModule,
  ],
  providers: [],
})
export class AppModule {}
