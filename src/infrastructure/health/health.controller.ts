import {
  Controller,
  Get,
  Inject,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type Redis from 'ioredis';
import { IJobQueue, JOB_QUEUE } from '../../domain/queue/job-queue.interface';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.constants';

const timeout = <T>(p: Promise<T>, ms = 1000) =>
  Promise.race([
    p,
    new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error('timeout')), ms),
    ),
  ]);

@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private prisma: PrismaService,
    @Inject(REDIS_CLIENT) private redis: Redis | null,
    @Inject(JOB_QUEUE) private queue: IJobQueue,
  ) {}

  /** Liveness: the process is up. Never touches dependencies, so an outage can't get it killed. */
  @Get('live')
  live() {
    return { status: 'ok', uptime: process.uptime() };
  }

  /**
   * Readiness: should this instance receive traffic? Postgres is required.
   * Redis is optional by design (every use fails open), so losing it reports
   * "degraded" rather than taking the instance out of rotation.
   */
  @Get('ready')
  ready() {
    return this.check();
  }

  /** Kept for compatibility: same as readiness. */
  @Get()
  async health() {
    return this.check();
  }

  private async check() {
    const checks: Record<string, string> = {};

    try {
      await timeout(this.prisma.$queryRaw`SELECT 1`);
      checks.database = 'up';
    } catch {
      checks.database = 'down';
      throw new ServiceUnavailableException({
        message: 'Database unreachable',
        status: 'unavailable',
        checks,
      });
    }

    if (this.redis) {
      try {
        await timeout(this.redis.ping());
        checks.redis = 'up';
      } catch {
        checks.redis = 'down';
      }
    } else {
      checks.redis = 'disabled';
    }
    checks.queue = this.queue.mode;

    return {
      status: checks.redis === 'down' ? 'degraded' : 'ok',
      uptime: process.uptime(),
      checks,
    };
  }
}
