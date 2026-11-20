import {
  IsString,
  IsInt,
  IsEnum,
  IsOptional,
  Min,
  IsBoolean,
  IsDateString,
} from 'class-validator';
import { PageQueryDto } from '../../common/pagination';
import { DiscountType } from '../../../domain/promo-codes/entities/promo-code.entity';

export class CreatePromoCodeDto {
  @IsString()
  code: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(DiscountType)
  @IsOptional()
  discountType?: DiscountType;

  @IsInt()
  @Min(0)
  discountValue: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  minPurchaseAmount?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxUses?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxUsesPerUser?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsDateString()
  @IsOptional()
  startsAt?: string;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;

  @IsString()
  @IsOptional()
  eventId?: string;

  @IsString()
  @IsOptional()
  ticketTypeId?: string;
}

export class UpdatePromoCodeDto {
  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(DiscountType)
  @IsOptional()
  discountType?: DiscountType;

  @IsInt()
  @Min(0)
  @IsOptional()
  discountValue?: number;

  @IsInt()
  @Min(0)
  @IsOptional()
  minPurchaseAmount?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxUses?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxUsesPerUser?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;

  @IsDateString()
  @IsOptional()
  startsAt?: string;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;
}

export class PromoCodeQueryDto extends PageQueryDto {
  @IsString()
  @IsOptional()
  eventId?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

export class ValidatePromoCodeDto {
  @IsString()
  code: string;

  @IsInt()
  @Min(0)
  purchaseAmount: number;

  @IsString()
  @IsOptional()
  eventId?: string;

  @IsString()
  @IsOptional()
  ticketTypeId?: string;
}
