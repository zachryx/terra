import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';

import { REDIS_CLIENT } from './redis.constants';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  /** In-process single-flight: concurrent misses for one key share one load. */
  private readonly inflight = new Map<string, Promise<unknown>>();

  private readonly ns: string;

  constructor(
    @Inject(REDIS_CLIENT) private redis: Redis | null,
    config: ConfigService,
  ) {
    this.ns = `${config.get('REDIS_NAMESPACE') ?? 'terra'}:`;
  }

  get enabled(): boolean {
    return this.redis !== null;
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (!this.redis) return undefined;
    try {
      const raw = await this.redis.get(this.ns + key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch (err) {
      this.warn('get', err);
      return undefined;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    if (!this.redis || ttlSeconds <= 0) return;
    try {
      await this.redis.set(
        this.ns + key,
        JSON.stringify(value),
        'EX',
        ttlSeconds,
      );
    } catch (err) {
      this.warn('set', err);
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!this.redis || keys.length === 0) return;
    try {
      await this.redis.del(...keys.map((k) => this.ns + k));
    } catch (err) {
      this.warn('del', err);
    }
  }

  /** Read-through with single-flight. Without Redis (or TTL 0) just calls the loader. */
  async wrap<T>(
    key: string,
    ttlSeconds: number,
    loader: () => Promise<T>,
  ): Promise<T> {
    if (!this.redis || ttlSeconds <= 0) return loader();

    const hit = await this.get<T>(key);
    if (hit !== undefined) return hit;

    const existing = this.inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const p = (async () => {
      try {
        const value = await loader();
        await this.set(key, value, ttlSeconds);
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();
    this.inflight.set(key, p);
    return p;
  }

  private lastWarn = 0;
  private warn(op: string, err: unknown) {
    if (Date.now() - this.lastWarn > 30_000) {
      this.lastWarn = Date.now();
      this.logger.warn(
        `cache ${op} failed (failing open): ${(err as Error).message}`,
      );
    }
  }
}
