import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { PromoCodeRepository } from '../../../infrastructure/promo-codes/repositories/promo-code.repository';
import { PromoCodeUsageRepository } from '../../../infrastructure/promo-codes/repositories/promo-code-usage.repository';
import { EventRepository } from '../../../infrastructure/events/repositories/event.repository';
import {
  CreatePromoCodeDto,
  UpdatePromoCodeDto,
  PromoCodeQueryDto,
  ValidatePromoCodeDto,
} from '../dto/promo-code.dto';
import { PromoCode as PromoCodeModel } from '@prisma/client';

export interface ValidatePromoCodeResult {
  valid: boolean;
  discountAmount: number;
  finalAmount: number;
  promoCode?: PromoCodeModel;
  message?: string;
}

@Injectable()
export class PromoCodeUseCases {
  constructor(
    private promoCodeRepository: PromoCodeRepository,
    private promoCodeUsageRepository: PromoCodeUsageRepository,
    private eventRepository: EventRepository,
  ) {}

  async create(
    dto: CreatePromoCodeDto,
    userId: string,
    userRole: string,
  ): Promise<PromoCodeModel> {
    if (dto.eventId) {
      const event = await this.eventRepository.findById(dto.eventId);
      if (!event) {
        throw new NotFoundException('Event not found');
      }
      if (event.organizerId !== userId && userRole !== 'ADMIN') {
        throw new ForbiddenException(
          'You can only create promo codes for your own events',
        );
      }
    }

    const existingCode = await this.promoCodeRepository.findByCode(dto.code);
    if (existingCode) {
      throw new ConflictException('Promo code already exists');
    }

    if (dto.discountType === 'PERCENTAGE' && dto.discountValue > 100) {
      throw new BadRequestException('Percentage discount cannot exceed 100%');
    }

    return this.promoCodeRepository.create({
      code: dto.code,
      description: dto.description,
      discountType: dto.discountType as any,
      discountValue: dto.discountValue,
      minPurchaseAmount: dto.minPurchaseAmount,
      maxUses: dto.maxUses,
      maxUsesPerUser: dto.maxUsesPerUser,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      eventId: dto.eventId,
      ticketTypeId: dto.ticketTypeId,
    });
  }

  async findById(id: string): Promise<PromoCodeModel> {
    const promoCode = await this.promoCodeRepository.findById(id);
    if (!promoCode) {
      throw new NotFoundException('Promo code not found');
    }
    return promoCode;
  }

  async findAll(query: PromoCodeQueryDto): Promise<PromoCodeModel[]> {
    return this.promoCodeRepository.findAll({
      eventId: query.eventId,
      isActive: query.isActive,
    });
  }

  async findByEventId(eventId: string): Promise<PromoCodeModel[]> {
    return this.promoCodeRepository.findByEventId(eventId);
  }

  async update(
    id: string,
    dto: UpdatePromoCodeDto,
    userId: string,
    userRole: string,
  ): Promise<PromoCodeModel> {
    const promoCode = await this.findById(id);

    if (promoCode.eventId) {
      const event = await this.eventRepository.findById(promoCode.eventId);
      if (event && event.organizerId !== userId && userRole !== 'ADMIN') {
        throw new ForbiddenException(
          'You can only update promo codes for your own events',
        );
      }
    }

    if (
      dto.discountType === 'PERCENTAGE' &&
      dto.discountValue &&
      dto.discountValue > 100
    ) {
      throw new BadRequestException('Percentage discount cannot exceed 100%');
    }

    const updateData: any = { ...dto };
    if (dto.startsAt) {
      updateData.startsAt = new Date(dto.startsAt);
    }
    if (dto.expiresAt) {
      updateData.expiresAt = new Date(dto.expiresAt);
    }

    return this.promoCodeRepository.update(id, updateData);
  }

  async delete(id: string, userId: string, userRole: string): Promise<void> {
    const promoCode = await this.findById(id);

    if (promoCode.eventId) {
      const event = await this.eventRepository.findById(promoCode.eventId);
      if (event && event.organizerId !== userId && userRole !== 'ADMIN') {
        throw new ForbiddenException(
          'You can only delete promo codes for your own events',
        );
      }
    }

    return this.promoCodeRepository.delete(id);
  }

  async validate(
    dto: ValidatePromoCodeDto,
    userId: string,
  ): Promise<ValidatePromoCodeResult> {
    const promoCode = await this.promoCodeRepository.findByCode(dto.code);

    if (!promoCode) {
      return {
        valid: false,
        discountAmount: 0,
        finalAmount: dto.purchaseAmount,
        message: 'Invalid promo code',
      };
    }

    if (!promoCode.isActive) {
      return {
        valid: false,
        discountAmount: 0,
        finalAmount: dto.purchaseAmount,
        promoCode,
        message: 'Promo code is inactive',
      };
    }

    const now = new Date();
    if (promoCode.startsAt && now < promoCode.startsAt) {
      return {
        valid: false,
        discountAmount: 0,
        finalAmount: dto.purchaseAmount,
        promoCode,
        message: 'Promo code is not yet active',
      };
    }

    if (promoCode.expiresAt && now > promoCode.expiresAt) {
      return {
        valid: false,
        discountAmount: 0,
        finalAmount: dto.purchaseAmount,
        promoCode,
        message: 'Promo code has expired',
      };
    }

    if (promoCode.maxUses && promoCode.usedCount >= promoCode.maxUses) {
      return {
        valid: false,
        discountAmount: 0,
        finalAmount: dto.purchaseAmount,
        promoCode,
        message: 'Promo code usage limit reached',
      };
    }

    if (
      promoCode.minPurchaseAmount &&
      dto.purchaseAmount < promoCode.minPurchaseAmount
    ) {
      return {
        valid: false,
        discountAmount: 0,
        finalAmount: dto.purchaseAmount,
        promoCode,
        message: `Minimum purchase amount of ${promoCode.minPurchaseAmount} required`,
      };
    }

    const userUsageCount =
      await this.promoCodeUsageRepository.countByUserAndPromoCode(
        userId,
        promoCode.id,
      );
    if (userUsageCount >= promoCode.maxUsesPerUser) {
      return {
        valid: false,
        discountAmount: 0,
        finalAmount: dto.purchaseAmount,
        promoCode,
        message: 'You have already used this promo code',
      };
    }

    let discountAmount = 0;
    if (promoCode.discountType === 'PERCENTAGE') {
      discountAmount = (dto.purchaseAmount * promoCode.discountValue) / 100;
    } else {
      discountAmount = promoCode.discountValue;
    }

    const finalAmount = Math.max(0, dto.purchaseAmount - discountAmount);

    return {
      valid: true,
      discountAmount,
      finalAmount,
      promoCode,
      message: 'Promo code applied successfully',
    };
  }

  async applyPromoCode(
    promoCodeId: string,
    userId: string,
    orderId: string,
    discountAmount: number,
  ): Promise<void> {
    await this.promoCodeUsageRepository.create({
      promoCodeId,
      userId,
      orderId,
      discountAmount,
    });

    await this.promoCodeRepository.incrementUsageCount(promoCodeId);
  }
}
