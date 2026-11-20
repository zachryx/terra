import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PageQueryDto } from '../../common/pagination';
import { OrderStatus } from '../../../domain/tickets/entities/order.entity';

export class OrderItemDto {
  @IsUUID()
  ticketId: string;

  @IsInt()
  @Min(1)
  @Max(100)
  quantity: number;
}

export class CreateOrderDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @IsString()
  @MaxLength(64)
  @IsOptional()
  promoCode?: string;
}

export class OrderQueryDto extends PageQueryDto {
  @IsEnum(OrderStatus)
  @IsOptional()
  status?: OrderStatus;
}
