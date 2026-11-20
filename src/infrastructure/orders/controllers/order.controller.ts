import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { OrderUseCases } from '../../../application/orders/use-cases/order.use-cases';
import {
  CreateOrderDto,
  OrderQueryDto,
} from '../../../application/orders/dto/order.dto';
import { IdempotencyInterceptor } from '../../common/idempotency/idempotency.interceptor';
import { StrictThrottle } from '../../common/throttle/strict-throttle.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrderController {
  constructor(private orderUseCases: OrderUseCases) {}

  @StrictThrottle()
  @UseInterceptors(IdempotencyInterceptor)
  @Post()
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: any) {
    return this.orderUseCases.create(dto, user);
  }

  @Get()
  findAll(@Query() query: OrderQueryDto, @CurrentUser() user: any) {
    return this.orderUseCases.findAll(query, user);
  }

  @Get(':id')
  findById(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.orderUseCases.findById(id, user);
  }

  @Post(':id/cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: any) {
    return this.orderUseCases.cancel(id, user);
  }
}
