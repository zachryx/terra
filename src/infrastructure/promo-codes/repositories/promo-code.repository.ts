import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IPromoCodeRepository } from '../../../domain/promo-codes/repositories/promo-code.repository.interface';
import {
  CreatePromoCodeInput,
  UpdatePromoCodeInput,
  PromoCodeFilters,
} from '../../../domain/promo-codes/entities/promo-code.entity';

@Injectable()
export class PromoCodeRepository implements IPromoCodeRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: CreatePromoCodeInput): Promise<any> {
    return this.prisma.promoCode.create({
      data: {
        code: data.code.toUpperCase(),
        description: data.description,
        discountType: data.discountType || 'PERCENTAGE',
        discountValue: data.discountValue,
        minPurchaseAmount: data.minPurchaseAmount,
        maxUses: data.maxUses,
        maxUsesPerUser: data.maxUsesPerUser || 1,
        isActive: data.isActive ?? true,
        startsAt: data.startsAt,
        expiresAt: data.expiresAt,
        eventId: data.eventId,
        ticketTypeId: data.ticketTypeId,
      },
    });
  }

  async findById(id: string): Promise<any> {
    return this.prisma.promoCode.findUnique({
      where: { id },
    });
  }

  async findByCode(code: string): Promise<any> {
    return this.prisma.promoCode.findUnique({
      where: { code: code.toUpperCase() },
    });
  }

  async findAll(filters?: PromoCodeFilters): Promise<any[]> {
    const where: any = {};

    if (filters?.eventId) {
      where.eventId = filters.eventId;
    }
    if (filters?.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    return this.prisma.promoCode.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByEventId(eventId: string): Promise<any[]> {
    return this.prisma.promoCode.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async update(id: string, data: UpdatePromoCodeInput): Promise<any> {
    return this.prisma.promoCode.update({
      where: { id },
      data: data as any,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.promoCode.delete({
      where: { id },
    });
  }

  async incrementUsageCount(id: string): Promise<any> {
    return this.prisma.promoCode.update({
      where: { id },
      data: {
        usedCount: { increment: 1 },
      },
    });
  }
}
