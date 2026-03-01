import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IPromoCodeUsageRepository } from '../../../domain/promo-codes/repositories/promo-code-usage.repository.interface';
import { CreatePromoCodeUsageInput } from '../../../domain/promo-codes/entities/promo-code-usage.entity';
import { PromoCodeUsage as PromoCodeUsageModel } from '@prisma/client';

@Injectable()
export class PromoCodeUsageRepository implements IPromoCodeUsageRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: CreatePromoCodeUsageInput): Promise<PromoCodeUsageModel> {
    return this.prisma.promoCodeUsage.create({
      data: {
        promoCodeId: data.promoCodeId,
        userId: data.userId,
        orderId: data.orderId,
        discountAmount: data.discountAmount,
      },
    });
  }

  async findByPromoCodeId(promoCodeId: string): Promise<PromoCodeUsageModel[]> {
    return this.prisma.promoCodeUsage.findMany({
      where: { promoCodeId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByUserId(userId: string): Promise<PromoCodeUsageModel[]> {
    return this.prisma.promoCodeUsage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async countByPromoCodeId(promoCodeId: string): Promise<number> {
    return this.prisma.promoCodeUsage.count({
      where: { promoCodeId },
    });
  }

  async countByUserAndPromoCode(
    userId: string,
    promoCodeId: string,
  ): Promise<number> {
    return this.prisma.promoCodeUsage.count({
      where: {
        userId,
        promoCodeId,
      },
    });
  }
}
