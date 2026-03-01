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
import { PromoCodeUseCases } from '../../../application/promo-codes/use-cases/promo-code.use-cases';
import {
  CreatePromoCodeDto,
  UpdatePromoCodeDto,
  PromoCodeQueryDto,
  ValidatePromoCodeDto,
} from '../../../application/promo-codes/dto/promo-code.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('promo-codes')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PromoCodeController {
  constructor(private promoCodeUseCases: PromoCodeUseCases) {}

  @Post()
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  create(@Body() dto: CreatePromoCodeDto, @CurrentUser() user: any) {
    return this.promoCodeUseCases.create(dto, user.id, user.role);
  }

  @Get()
  findAll(@Query() query: PromoCodeQueryDto) {
    return this.promoCodeUseCases.findAll(query);
  }

  @Get('event/:eventId')
  findByEventId(@Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.promoCodeUseCases.findByEventId(eventId);
  }

  @Get(':id')
  findById(@Param('id', ParseUUIDPipe) id: string) {
    return this.promoCodeUseCases.findById(id);
  }

  @Put(':id')
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePromoCodeDto,
    @CurrentUser() user: any,
  ) {
    return this.promoCodeUseCases.update(id, dto, user.id, user.role);
  }

  @Delete(':id')
  @Roles(UserRole.ORGANIZER, UserRole.ADMIN)
  delete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.promoCodeUseCases.delete(id, user.id, user.role);
  }

  @Post('validate')
  validate(@Body() dto: ValidatePromoCodeDto, @CurrentUser() user: any) {
    return this.promoCodeUseCases.validate(dto, user.id);
  }
}
