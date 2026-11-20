import { Logger } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import type Redis from 'ioredis';

// Atomic fixed-window counter. Returns {hits, ttlMs}.
const INCR_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); ttl = tonumber(ARGV[1]) end
return {hits, ttl}
`;

/**
 * Rate-limit counters shared by every replica, so "10 logins/min" stays 10
 * no matter how many instances run. Fails open: if Redis is down, requests
 * are allowed rather than the whole API refusing traffic.
 */
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger('Throttler');
  private lastWarn = 0;

  constructor(
    private redis: Redis,
    private namespace = 'terra',
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      const [hits, ttlMs] = (await this.redis.eval(
        INCR_SCRIPT,
        1,
        `${this.namespace}:throttle:${throttlerName}:${key}`,
        String(ttl),
      )) as [number, number];
      const timeToExpire = Math.ceil(ttlMs / 1000);
      const isBlocked = hits > limit;
      return {
        totalHits: hits,
        timeToExpire,
        isBlocked,
        timeToBlockExpire: isBlocked ? timeToExpire : 0,
      };
    } catch (err) {
      if (Date.now() - this.lastWarn > 30_000) {
        this.lastWarn = Date.now();
        this.logger.warn(
          `Redis throttler unavailable, failing open: ${(err as Error).message}`,
        );
      }
      return {
        totalHits: 1,
        timeToExpire: Math.ceil(ttl / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }
}
