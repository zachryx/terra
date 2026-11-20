import {
  Global,
  Inject,
  Logger,
  Module,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { CacheService } from './cache.service';
import { StockGate } from './stock-gate.service';
import { REDIS_CLIENT } from './redis.constants';

/**
 * Redis is optional. With no REDIS_URL the app runs exactly as before
 * (in-memory throttling, no caching). With it, rate limits are shared across
 * replicas and hot reads are cached. Every Redis call fails open.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis | null => {
        const url = config.get<string>('REDIS_URL');
        if (!url) return null;
        const logger = new Logger('Redis');
        const client = new Redis(url, {
          // Fail fast when Redis is down so requests degrade instead of hanging.
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          connectTimeout: 2000,
          retryStrategy: (times) => Math.min(times * 200, 2000),
        });
        let lastLogged = 0;
        client.on('error', (err) => {
          if (Date.now() - lastLogged > 30_000) {
            lastLogged = Date.now();
            logger.warn(
              `Redis unavailable, degrading gracefully: ${err.message}`,
            );
          }
        });
        return client;
      },
    },
    CacheService,
    StockGate,
  ],
  exports: [REDIS_CLIENT, CacheService, StockGate],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private redis: Redis | null) {}

  async onModuleDestroy() {
    if (!this.redis) return;
    // quit() needs a live connection; disconnect() also stops the reconnect
    // loop, which would otherwise keep the process alive during an outage.
    await this.redis.quit().catch(() => undefined);
    this.redis.disconnect();
  }
}
