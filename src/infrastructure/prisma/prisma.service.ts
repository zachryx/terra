import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL as string,
      // Per-instance pool. Total = replicas x this, so size it against
      // Postgres max_connections (or put PgBouncer in front).
      max: Number(process.env.DB_POOL_MAX ?? 20),
      connectionTimeoutMillis: Number(
        process.env.DB_CONNECT_TIMEOUT_MS ?? 5000,
      ),
      idleTimeoutMillis: 30_000,
    });
    super({
      adapter,
      // Under a burst, transactions queue for a connection; allow for that
      // instead of failing after Prisma's 2s default.
      transactionOptions: {
        maxWait: Number(process.env.DB_TX_MAX_WAIT_MS ?? 5000),
        timeout: Number(process.env.DB_TX_TIMEOUT_MS ?? 10_000),
      },
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
