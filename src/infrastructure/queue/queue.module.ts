import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IJobQueue,
  JOB_QUEUE,
  JobPolicy,
} from '../../domain/queue/job-queue.interface';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { BullQueue } from './bull.queue';
import { InlineQueue } from './inline.queue';
import { OutboxRelay } from './outbox.relay';

/**
 * REDIS_URL set   -> BullMQ: durable, retried, shared by all replicas.
 * REDIS_URL unset -> in-process queue with the same interface.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    {
      provide: JOB_QUEUE,
      inject: [ConfigService, PrismaService],
      useFactory: (config: ConfigService, prisma: PrismaService): IJobQueue => {
        const policy: JobPolicy = {
          attempts: Number(config.get('JOB_ATTEMPTS') ?? 5),
          backoffMs: Number(config.get('JOB_BACKOFF_MS') ?? 2000),
          concurrency: Number(config.get('JOB_CONCURRENCY') ?? 5),
        };
        const url = config.get<string>('REDIS_URL');
        return url
          ? new BullQueue(
              url,
              prisma,
              policy,
              config.get('QUEUE_PREFIX') ?? 'bull',
            )
          : new InlineQueue(prisma, policy);
      },
    },
    OutboxRelay,
  ],
  exports: [JOB_QUEUE, OutboxRelay],
})
export class QueueModule implements OnApplicationShutdown {
  constructor(@Inject(JOB_QUEUE) private queue: IJobQueue) {}

  async onApplicationShutdown() {
    await this.queue.close();
  }
}
