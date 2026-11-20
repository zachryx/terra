import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule, NotificationsModule, OrdersModule],
  providers: [JobsService],
})
export class JobsModule {}
