import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { UserRole } from '@prisma/client';
import { AnalyticsUseCases } from '../../application/analytics/analytics.use-cases';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ORGANIZER, UserRole.ADMIN)
export class AnalyticsController {
  constructor(private analytics: AnalyticsUseCases) {}

  @Get('analytics/dashboard')
  dashboard(@CurrentUser() user: any) {
    return this.analytics.dashboard(user);
  }

  @Get('events/:id/analytics')
  event(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days: number,
    @CurrentUser() user: any,
  ) {
    return this.analytics.eventReport(
      id,
      user,
      Math.min(Math.max(days, 1), 365),
    );
  }

  @Get('events/:id/attendees.csv')
  async attendees(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const csv = await this.analytics.attendeesCsv(id, user);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="attendees-${id}.csv"`,
    );
    res.send(csv);
  }
}
