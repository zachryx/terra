import {
  IsString,
  IsNumber,
  IsOptional,
  Min,
  Max,
  IsBoolean,
  IsDateString,
  IsEnum,
} from 'class-validator';

export class CreatePromoCodeDto {
  @IsString()
  code: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  discountType?: string;

  @IsNumber()
  @Min(0)
  discountValue: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  minPurchaseAmount?: number;

  @IsNumber()
  @Min(1)
  @IsOptional()
  maxUses?: number;

  @IsNumber()
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

  @IsString()
  @IsOptional()
  discountType?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  discountValue?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  minPurchaseAmount?: number;

  @IsNumber()
  @Min(1)
  @IsOptional()
  maxUses?: number;

  @IsNumber()
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

export class PromoCodeQueryDto {
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

  @IsNumber()
  @Min(0)
  purchaseAmount: number;

  @IsString()
  @IsOptional()
  eventId?: string;

  @IsString()
  @IsOptional()
  ticketTypeId?: string;
}
