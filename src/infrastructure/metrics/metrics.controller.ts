import {
  Controller,
  Get,
  Headers,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'crypto';
import { Response } from 'express';
import { MetricsService } from './metrics.service';

@ApiExcludeController()
@SkipThrottle()
@Controller('metrics')
export class MetricsController {
  constructor(
    private metrics: MetricsService,
    private config: ConfigService,
  ) {}

  /**
   * Meant for the scraper on the internal network. If METRICS_TOKEN is set it
   * must be presented as a bearer token.
   */
  @Get()
  async scrape(
    @Headers('authorization') auth: string | undefined,
    @Res() res: Response,
  ) {
    const token = this.config.get<string>('METRICS_TOKEN');
    if (token) {
      const given = Buffer.from((auth ?? '').replace(/^Bearer /i, ''));
      const want = Buffer.from(token);
      if (given.length !== want.length || !timingSafeEqual(given, want)) {
        throw new UnauthorizedException();
      }
    }
    res.setHeader('Content-Type', this.metrics.registry.contentType);
    res.send(await this.metrics.registry.metrics());
  }
}
