import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { INSTANCE_ID } from './instance-id';
import { IJobQueue, JOB_QUEUE } from '../../domain/queue/job-queue.interface';
import { PrismaService } from '../prisma/prisma.service';
import { recordDeadLetter } from './dead-letter';

export type OutboxType = 'order.paid';
const MAX_ATTEMPTS = 10;

/**
 * Delivers domain events written to the OutboxEvent table in the same
 * transaction as the change they describe. A crash between "committed" and
 * "delivered" therefore can't lose an event: the relay finds it later.
 *
 * Delivery is at-least-once. Handlers must be idempotent (and are: jobs carry a
 * deterministic jobId, and the handlers check what was already done).
 */
@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);

  /**
   * Test isolation only: when set, a relay handles just the rows written by
   * its own process, so parallel suites sharing one database can't steal each
   * other's events. Leave unset in production (replicas must share the work).
   */
  private readonly scope: Prisma.Sql;

  constructor(
    private prisma: PrismaService,
    @Inject(JOB_QUEUE) private queue: IJobQueue,
    config: ConfigService,
  ) {
    this.scope =
      config.get('OUTBOX_SCOPE_TO_INSTANCE') === 'true'
        ? Prisma.sql`AND "payload"->>'originId' = ${INSTANCE_ID}`
        : Prisma.empty;
  }

  /** Process now instead of waiting for the next scheduled tick. Never throws. */
  kick(): void {
    setImmediate(() => {
      this.run().catch((err) =>
        this.logger.warn(`relay kick failed: ${err.message}`),
      );
    });
  }

  /** Claims a batch with SKIP LOCKED so concurrent relays never share rows. */
  async run(limit = 50): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string; type: string; payload: any; attempts: number }[]
      >`SELECT "id", "type", "payload", "attempts"
        FROM "OutboxEvent"
        WHERE "processedAt" IS NULL ${this.scope}
        ORDER BY "createdAt"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED`;

      for (const row of rows) {
        try {
          await this.dispatch(row.type, row.payload);
          await tx.outboxEvent.update({
            where: { id: row.id },
            data: { processedAt: new Date() },
          });
        } catch (err) {
          const message = (err as Error).message;
          const attempts = row.attempts + 1;
          if (attempts >= MAX_ATTEMPTS) {
            await recordDeadLetter(this.prisma, {
              queue: 'outbox',
              jobName: row.type,
              jobId: row.id,
              payload: row.payload,
              error: message,
              attempts,
            });
            await tx.outboxEvent.update({
              where: { id: row.id },
              data: {
                processedAt: new Date(),
                attempts,
                lastError: message.slice(0, 500),
              },
            });
          } else {
            await tx.outboxEvent.update({
              where: { id: row.id },
              data: { attempts, lastError: message.slice(0, 500) },
            });
          }
        }
      }
      return rows.length;
    });
  }

  private async dispatch(type: string, payload: any): Promise<void> {
    switch (type as OutboxType) {
      case 'order.paid':
        await this.queue.enqueue(
          'email.order-confirmation',
          { orderId: payload.orderId },
          { jobId: `order-confirmation-${payload.orderId}` },
        );
        return;
      default:
        throw new Error(`unknown outbox event type: ${type}`);
    }
  }
}
