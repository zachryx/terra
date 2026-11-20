import {
  IsString,
  IsInt,
  IsEnum,
  IsOptional,
  Min,
  IsDateString,
} from 'class-validator';
import { TicketType } from '../../../domain/tickets/entities/ticket.entity';

export class CreateTicketDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(TicketType)
  @IsOptional()
  ticketType?: TicketType;

  /** Minor units (e.g. cents). */
  @IsInt()
  @Min(0)
  price: number;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxPerOrder?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  minPerOrder?: number;

  @IsDateString()
  @IsOptional()
  saleStartDate?: string;

  @IsDateString()
  @IsOptional()
  saleEndDate?: string;

  @IsString()
  eventId: string;
}

export class UpdateTicketDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsEnum(TicketType)
  @IsOptional()
  ticketType?: TicketType;

  @IsInt()
  @Min(0)
  @IsOptional()
  price?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  quantity?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  maxPerOrder?: number;

  @IsInt()
  @Min(1)
  @IsOptional()
  minPerOrder?: number;

  @IsDateString()
  @IsOptional()
  saleStartDate?: string;

  @IsDateString()
  @IsOptional()
  saleEndDate?: string;
}

export class TicketQueryDto {
  @IsString()
  @IsOptional()
  eventId?: string;

  @IsEnum(TicketType)
  @IsOptional()
  ticketType?: TicketType;
}
