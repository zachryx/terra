import { Module } from '@nestjs/common';
import { PromoCodeController } from './controllers/promo-code.controller';
import { PromoCodeRepository } from './repositories/promo-code.repository';
import { PromoCodeUsageRepository } from './repositories/promo-code-usage.repository';
import { PromoCodeUseCases } from '../../application/promo-codes/use-cases/promo-code.use-cases';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [PromoCodeController],
  providers: [PromoCodeRepository, PromoCodeUsageRepository, PromoCodeUseCases],
  exports: [PromoCodeRepository, PromoCodeUseCases],
})
export class PromoCodesModule {}
