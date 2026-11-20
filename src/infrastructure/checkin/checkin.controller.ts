import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Response } from 'express';
import { UserRole } from '@prisma/client';
import { CheckinUseCases } from '../../application/checkin/checkin.use-cases';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

export class CheckinDto {
  @IsString()
  @MaxLength(128)
  code: string;

  /** Optional guard so a gate can reject tickets from another event. */
  @IsUUID()
  @IsOptional()
  eventId?: string;
}

@ApiTags('check-in')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class CheckinController {
  constructor(private checkin: CheckinUseCases) {}

  @Get('orders/:id/tickets')
  tickets(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.checkin.listOrderTickets(id, user);
  }

  @Get('issued-tickets/:id/qr')
  async qr(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const png = await this.checkin.qrPng(id, user);
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.end(png);
  }

  @Post('checkin')
  @HttpCode(200)
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  scan(@Body() dto: CheckinDto, @CurrentUser() user: any) {
    return this.checkin.checkIn(dto.code, user, dto.eventId);
  }

  @Get('events/:id/checkin-stats')
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  stats(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.checkin.stats(id, user);
  }
}
