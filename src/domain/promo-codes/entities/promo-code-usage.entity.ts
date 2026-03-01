export interface PromoCodeUsage {
  id: string;
  promoCodeId: string;
  userId: string;
  orderId: string;
  discountAmount: number;
  createdAt: Date;
}

export interface CreatePromoCodeUsageInput {
  promoCodeId: string;
  userId: string;
  orderId: string;
  discountAmount: number;
}
