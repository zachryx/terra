export enum DiscountType {
  PERCENTAGE = 'PERCENTAGE',
  FIXED = 'FIXED',
}

export interface PromoCode {
  id: string;
  code: string;
  description: string | null;
  discountType: string;
  discountValue: number;
  minPurchaseAmount: number | null;
  maxUses: number | null;
  usedCount: number;
  maxUsesPerUser: number;
  isActive: boolean;
  startsAt: Date | null;
  expiresAt: Date | null;
  eventId: string | null;
  ticketTypeId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePromoCodeInput {
  code: string;
  description?: string;
  discountType?: string;
  discountValue: number;
  minPurchaseAmount?: number;
  maxUses?: number;
  maxUsesPerUser?: number;
  isActive?: boolean;
  startsAt?: Date;
  expiresAt?: Date;
  eventId?: string;
  ticketTypeId?: string;
}

export interface UpdatePromoCodeInput {
  description?: string;
  discountType?: DiscountType;
  discountValue?: number;
  minPurchaseAmount?: number;
  maxUses?: number;
  maxUsesPerUser?: number;
  isActive?: boolean;
  startsAt?: Date;
  expiresAt?: Date;
}

export interface PromoCodeFilters {
  eventId?: string;
  isActive?: boolean;
}

export interface ValidatePromoCodeInput {
  code: string;
  userId: string;
  purchaseAmount: number;
  eventId?: string;
  ticketTypeId?: string;
}
