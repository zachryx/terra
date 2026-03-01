import {
  PromoCodeUsage,
  CreatePromoCodeUsageInput,
} from '../entities/promo-code-usage.entity';

export interface IPromoCodeUsageRepository {
  create(data: CreatePromoCodeUsageInput): Promise<PromoCodeUsage>;
  findByPromoCodeId(promoCodeId: string): Promise<PromoCodeUsage[]>;
  findByUserId(userId: string): Promise<PromoCodeUsage[]>;
  countByPromoCodeId(promoCodeId: string): Promise<number>;
  countByUserAndPromoCode(userId: string, promoCodeId: string): Promise<number>;
}
