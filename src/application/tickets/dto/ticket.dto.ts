import {
  IsString,
  IsNumber,
  IsOptional,
  Min,
  IsDateString,
} from 'class-validator';

export class CreateTicketDto {
  @IsString()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  ticketType?: string;

  @IsNumber()
  @Min(0)
  price: number;

  @IsNumber()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(1)
  @IsOptional()
  maxPerOrder?: number;

  @IsNumber()
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

  @IsString()
  @IsOptional()
  ticketType?: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  price?: number;

  @IsNumber()
  @Min(1)
  @IsOptional()
  quantity?: number;

  @IsNumber()
  @Min(1)
  @IsOptional()
  maxPerOrder?: number;

  @IsNumber()
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

  @IsString()
  @IsOptional()
  ticketType?: string;
}
