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
import { EventUseCases } from '../../../application/events/use-cases/event.use-cases';
import {
  CreateEventDto,
  UpdateEventDto,
  EventQueryDto,
} from '../../../application/events/dto/event.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('events')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EventController {
  constructor(private eventUseCases: EventUseCases) {}

  @Post()
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  create(@Body() dto: CreateEventDto, @CurrentUser() user: any) {
    return this.eventUseCases.create(dto, user.id);
  }

  @Get()
  findAll(@Query() query: EventQueryDto) {
    return this.eventUseCases.findAll(query);
  }

  @Get('my-events')
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  findMyEvents(@CurrentUser() user: any) {
    return this.eventUseCases.findByOrganizer(user.id);
  }

  @Get(':id')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.eventUseCases.findById(id);
  }

  @Put(':id')
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEventDto,
    @CurrentUser() user: any,
  ) {
    return this.eventUseCases.update(id, dto, user.id, user.role);
  }

  @Delete(':id')
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  delete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.eventUseCases.delete(id, user.id, user.role);
  }

  @Post(':id/publish')
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  publish(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.eventUseCases.publish(id, user.id, user.role);
  }

  @Post(':id/cancel')
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.eventUseCases.cancel(id, user.id, user.role);
  }
}
