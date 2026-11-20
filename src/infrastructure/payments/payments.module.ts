import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentController } from './controllers/payment.controller';
import { PaymentRepository } from './repositories/payment.repository';
import { FakeGateway } from './gateways/fake.gateway';
import { StripeGateway } from './gateways/stripe.gateway';
import { PaymentUseCases } from '../../application/payments/payment.use-cases';
import { PAYMENT_GATEWAY } from '../../domain/payments/payment-gateway.interface';
import { PrismaModule } from '../prisma/prisma.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [PrismaModule, OrdersModule, NotificationsModule],
  controllers: [PaymentController],
  providers: [
    PaymentRepository,
    PaymentUseCases,
    FakeGateway,
    {
      provide: PAYMENT_GATEWAY,
      inject: [ConfigService, FakeGateway],
      useFactory: (config: ConfigService, fake: FakeGateway) => {
        const provider = config.get<string>('PAYMENT_PROVIDER') ?? 'fake';
        if (provider === 'stripe') return new StripeGateway(config);
        if (provider === 'fake') return fake;
        throw new Error(`Unknown PAYMENT_PROVIDER "${provider}"`);
      },
    },
  ],
  exports: [PaymentUseCases],
})
export class PaymentsModule {}
