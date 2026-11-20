import { Injectable } from '@nestjs/common';
import { CacheService } from './cache.service';

const TTL_SECONDS = 10;

/**
 * Advisory "sold out" flags. Once a ticket is known to be sold out, further
 * checkout attempts are rejected from Redis without opening a DB transaction,
 * which is what keeps Postgres alive during a flash sale.
 *
 * Postgres stays the source of truth: a stale flag can only delay a sale by
 * at most TTL_SECONDS (and flags are cleared when stock is released).
 */
@Injectable()
export class StockGate {
  constructor(private cache: CacheService) {}

  private key(ticketId: string) {
    return `soldout:${ticketId}`;
  }

  async anySoldOut(ticketIds: string[]): Promise<boolean> {
    if (!this.cache.enabled) return false;
    const flags = await Promise.all(
      ticketIds.map((id) => this.cache.get<boolean>(this.key(id))),
    );
    return flags.some(Boolean);
  }

  async markSoldOut(ticketId: string): Promise<void> {
    await this.cache.set(this.key(ticketId), true, TTL_SECONDS);
  }

  async clear(ticketIds: string[]): Promise<void> {
    await this.cache.del(...ticketIds.map((id) => this.key(id)));
  }
}
