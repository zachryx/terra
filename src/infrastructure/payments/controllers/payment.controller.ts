import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Request } from 'express';
import { PaymentUseCases } from '../../../application/payments/payment.use-cases';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { FakeGateway } from '../gateways/fake.gateway';
import {
  IPaymentGateway,
  PAYMENT_GATEWAY,
} from '../../../domain/payments/payment-gateway.interface';
import { UserRole } from '@prisma/client';

@ApiTags('payments')
@Controller()
export class PaymentController {
  constructor(
    private paymentUseCases: PaymentUseCases,
    @Inject(PAYMENT_GATEWAY) private gateway: IPaymentGateway,
    private config: ConfigService,
  ) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('orders/:id/pay')
  pay(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.paymentUseCases.startPayment(id, user);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  @Post('orders/:id/refund')
  refund(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.paymentUseCases.refundOrder(id, user);
  }

  /** Provider -> Terra. Authenticated by signature, not by cookie. */
  @Public()
  @SkipThrottle()
  @Post('payments/webhook')
  @HttpCode(200)
  webhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('stripe-signature') stripeSignature?: string,
    @Headers(FakeGateway.SIGNATURE_HEADER) fakeSignature?: string,
  ) {
    if (!req.rawBody) {
      throw new BadRequestException('Raw body unavailable');
    }
    return this.paymentUseCases.handleWebhook(
      req.rawBody,
      stripeSignature ?? fakeSignature,
    );
  }

  /**
   * Dev/demo only: simulates the provider confirming payment by sending a
   * correctly signed webhook through the real handler. Disabled in production
   * and whenever a real provider is configured.
   */
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  @Post('orders/:id/pay/simulate')
  async simulate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
  ) {
    if (
      !(this.gateway instanceof FakeGateway) ||
      this.config.get('NODE_ENV') === 'production'
    ) {
      throw new ForbiddenException('Payment simulation is disabled');
    }
    const started = await this.paymentUseCases.startPayment(id, user);
    const body = Buffer.from(
      JSON.stringify({
        id: `evt_sim_${id}`,
        type: 'payment.succeeded',
        providerRef: `fake_pi_${id}`,
        amount: started.amount,
      }),
    );
    return this.paymentUseCases.handleWebhook(body, this.gateway.sign(body));
  }
}
