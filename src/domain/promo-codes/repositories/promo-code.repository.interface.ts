import {
  CreatePromoCodeInput,
  UpdatePromoCodeInput,
  PromoCodeFilters,
} from '../entities/promo-code.entity';

export interface IPromoCodeRepository {
  create(data: CreatePromoCodeInput): Promise<any>;
  findById(id: string): Promise<any>;
  findByCode(code: string): Promise<any>;
  findAll(filters?: PromoCodeFilters): Promise<any[]>;
  findByEventId(eventId: string): Promise<any[]>;
  update(id: string, data: UpdatePromoCodeInput): Promise<any>;
  delete(id: string): Promise<void>;
  incrementUsageCount(id: string): Promise<any>;
}
