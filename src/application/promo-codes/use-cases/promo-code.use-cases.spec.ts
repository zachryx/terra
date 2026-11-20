import { PromoCodeUseCases } from './promo-code.use-cases';
import { DiscountType } from '../../../domain/promo-codes/entities/promo-code.entity';

describe('PromoCodeUseCases.calculateDiscount', () => {
  it('floors percentage discounts so we never over-discount', () => {
    // 15% of 999 = 149.85 -> 149
    expect(
      PromoCodeUseCases.calculateDiscount(DiscountType.PERCENTAGE, 15, 999),
    ).toBe(149);
  });

  it('applies fixed discounts in minor units', () => {
    expect(
      PromoCodeUseCases.calculateDiscount(DiscountType.FIXED, 500, 2000),
    ).toBe(500);
  });

  it('caps a fixed discount at the purchase amount', () => {
    expect(
      PromoCodeUseCases.calculateDiscount(DiscountType.FIXED, 5000, 2000),
    ).toBe(2000);
  });

  it('handles 100% and zero values', () => {
    expect(
      PromoCodeUseCases.calculateDiscount(DiscountType.PERCENTAGE, 100, 1234),
    ).toBe(1234);
    expect(
      PromoCodeUseCases.calculateDiscount(DiscountType.PERCENTAGE, 0, 1234),
    ).toBe(0);
  });
});
