import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  ParseUUIDPipe,
} from '@nestjs/common';
import { TicketUseCases } from '../../../application/tickets/use-cases/ticket.use-cases';
import {
  CreateTicketDto,
  UpdateTicketDto,
  TicketQueryDto,
} from '../../../application/tickets/dto/ticket.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('tickets')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TicketController {
  constructor(private ticketUseCases: TicketUseCases) {}

  @Post()
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  create(@Body() dto: CreateTicketDto, @CurrentUser() user: any) {
    return this.ticketUseCases.create(dto, user.id, user.role);
  }

  @Get()
  findAll(@Query() query: TicketQueryDto) {
    return this.ticketUseCases.findAll(query);
  }

  @Get('event/:eventId')
  findByEventId(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.ticketUseCases.findByEventId(eventId);
  }

  @Get(':id')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.ticketUseCases.findById(id);
  }

  @Put(':id')
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTicketDto,
    @CurrentUser() user: any,
  ) {
    return this.ticketUseCases.update(id, dto, user.id, user.role);
  }

  @Delete(':id')
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  delete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.ticketUseCases.delete(id, user.id, user.role);
  }

  @Post(':id/check-availability')
  checkAvailability(
    @Param('id', ParseUUIDPipe) id: string,
    @Body('quantity') quantity: number,
  ) {
    return this.ticketUseCases.checkAvailability(id, quantity);
  }
}
