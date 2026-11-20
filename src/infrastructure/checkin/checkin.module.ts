import { Module } from '@nestjs/common';
import { CheckinController } from './checkin.controller';
import { CheckinUseCases } from '../../application/checkin/checkin.use-cases';
import { PrismaModule } from '../prisma/prisma.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [PrismaModule, OrdersModule],
  controllers: [CheckinController],
  providers: [CheckinUseCases],
})
export class CheckinModule {}
