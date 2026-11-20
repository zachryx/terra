import { Logger } from '@nestjs/common';
import { Job, Queue, UnrecoverableError, Worker } from 'bullmq';
import {
  EnqueueOptions,
  IJobQueue,
  JobHandler,
  JobName,
  JobPolicy,
} from '../../domain/queue/job-queue.interface';
import { PrismaService } from '../prisma/prisma.service';
import { recordDeadLetter } from './dead-letter';
import { InlineQueue } from './inline.queue';

const QUEUE = 'terra';

/** Redis calls must never hang a request or block boot. */
const REDIS_TIMEOUT_MS = 1500;

function withTimeout<T>(p: Promise<T>, ms = REDIS_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error(`redis timeout after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Resolves when `p` settles or after `ms`, whichever comes first. Never rejects. */
function settle(p: Promise<unknown> | undefined, ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    (p ?? Promise.resolve()).then(
      () => {
        clearTimeout(t);
        resolve();
      },
      () => {
        clearTimeout(t);
        resolve();
      },
    );
  });
}

function connectionFrom(url: string) {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username ? decodeURIComponent(u.username) : undefined,
    password: u.password ? decodeURIComponent(u.password) : undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined,
    tls: u.protocol === 'rediss:' ? {} : undefined,
  };
}

/**
 * Durable queue on Redis. Retries with exponential backoff, repeatable jobs
 * that run once across all replicas, and a Postgres dead-letter table
 * (BullMQ keeps failed jobs but has no dead-letter queue of its own).
 *
 * Redis must run with AOF and `maxmemory-policy noeviction`, or jobs can vanish.
 */
export class BullQueue implements IJobQueue {
  readonly mode = 'bull' as const;
  private readonly logger = new Logger('BullQueue');
  private readonly handlers = new Map<JobName, JobHandler>();
  private readonly queue: Queue;
  private worker?: Worker;
  private readonly connection;
  /** Used when Redis can't be reached, so mail and events still go out. */
  private readonly fallback: InlineQueue;
  private readonly wanted = new Map<JobName, number>();
  private retryTimer?: NodeJS.Timeout;

  constructor(
    url: string,
    private prisma: PrismaService,
    private policy: JobPolicy,
    private prefix = 'bull',
  ) {
    this.connection = connectionFrom(url);
    this.fallback = new InlineQueue(prisma, policy);
    this.queue = new Queue(QUEUE, {
      connection: this.connection,
      prefix: this.prefix,
      defaultJobOptions: {
        attempts: policy.attempts,
        backoff: { type: 'exponential', delay: policy.backoffMs },
        removeOnComplete: { age: 3600, count: 1000 },
        // Keep failures for inspection; permanent ones are also copied to Postgres.
        removeOnFail: { count: 5000 },
      },
    });
    this.queue.on('error', (e) =>
      this.logger.warn(`queue error: ${e.message}`),
    );
  }

  register(name: JobName, handler: JobHandler) {
    this.handlers.set(name, handler);
    this.fallback.register(name, handler);
  }

  async start() {
    if (this.worker) return;
    this.worker = new Worker(
      QUEUE,
      async (job: Job) => {
        const handler = this.handlers.get(job.name as JobName);
        if (!handler)
          throw new UnrecoverableError(`no handler for ${job.name}`);
        await handler(job.data);
      },
      {
        connection: this.connection,
        prefix: this.prefix,
        concurrency: this.policy.concurrency,
      },
    );
    this.worker.on('error', (e) =>
      this.logger.warn(`worker error: ${e.message}`),
    );
    this.worker.on('failed', (job, err) => {
      if (!job) return;
      const max = job.opts.attempts ?? 1;
      const final =
        job.attemptsMade >= max || err instanceof UnrecoverableError;
      if (!final) {
        this.logger.warn(
          `${job.name} failed (attempt ${job.attemptsMade}/${max}): ${err.message}`,
        );
        return;
      }
      void recordDeadLetter(this.prisma, {
        queue: QUEUE,
        jobName: job.name,
        jobId: job.id,
        payload: job.data,
        error: err.message,
        attempts: job.attemptsMade,
        sensitive: Boolean(job.data?.__sensitive),
      });
    });
    // Deliberately not awaited: if Redis is down the API must still boot, and
    // the worker connects (and reconnects) in the background.
  }

  async enqueue(name: JobName, data: unknown, opts: EnqueueOptions = {}) {
    const payload = opts.sensitive
      ? { ...(data as object), __sensitive: true }
      : data;
    try {
      await withTimeout(
        this.queue.add(name, payload, {
          jobId: opts.jobId,
          delay: opts.delayMs,
          ...(opts.sensitive
            ? { removeOnComplete: true, removeOnFail: true }
            : {}),
        }),
      );
    } catch (err) {
      // Redis unreachable: run it here rather than failing the request or
      // losing the job. Durability resumes as soon as Redis is back.
      this.logger.warn(
        `enqueue ${name} fell back to in-process: ${(err as Error).message}`,
      );
      await this.fallback.enqueue(name, data, opts);
    }
  }

  async schedule(name: JobName, everyMs: number) {
    this.wanted.set(name, everyMs);
    if (!(await this.tryUpsert(name, everyMs))) this.retrySchedulesLater();
  }

  private async tryUpsert(name: JobName, everyMs: number): Promise<boolean> {
    try {
      // Upsert is idempotent: every replica may call it on boot.
      await withTimeout(
        this.queue.upsertJobScheduler(
          `schedule:${name}`,
          { every: everyMs },
          {
            name,
            data: {},
            opts: {
              removeOnComplete: true,
              removeOnFail: { count: 100 },
              attempts: 1,
            },
          },
        ),
        2000,
      );
      this.wanted.delete(name);
      return true;
    } catch (err) {
      this.logger.warn(
        `could not register schedule ${name} yet: ${(err as Error).message}`,
      );
      return false;
    }
  }

  private retrySchedulesLater() {
    if (this.retryTimer) return;
    this.retryTimer = setInterval(async () => {
      for (const [name, every] of [...this.wanted])
        await this.tryUpsert(name, every);
      if (this.wanted.size === 0 && this.retryTimer) {
        clearInterval(this.retryTimer);
        this.retryTimer = undefined;
      }
    }, 5000);
    this.retryTimer.unref();
  }

  async schedules() {
    try {
      const list = await withTimeout(this.queue.getJobSchedulers());
      return list.map((s) => s.key ?? s.name).filter(Boolean) as string[];
    } catch {
      return [];
    }
  }

  async close() {
    if (this.retryTimer) clearInterval(this.retryTimer);
    await this.fallback.close();
    // Graceful close needs a live connection. Give it a moment, then force it:
    // an outage must never keep the process from shutting down.
    await settle(this.worker?.close(), 2000);
    void this.worker?.close(true).catch(() => undefined);
    await settle(this.queue.close(), 1500);
    void this.queue.disconnect().catch(() => undefined);
  }
}
