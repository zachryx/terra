import { Logger } from '@nestjs/common';
import {
  EnqueueOptions,
  IJobQueue,
  JobHandler,
  JobName,
  JobPolicy,
} from '../../domain/queue/job-queue.interface';
import { PrismaService } from '../prisma/prisma.service';
import { recordDeadLetter } from './dead-letter';

/**
 * No-Redis fallback. Jobs run in this process; the first attempt is awaited
 * (so behaviour matches the old synchronous code), later retries happen in the
 * background. Not durable: pending retries are lost on restart.
 */
export class InlineQueue implements IJobQueue {
  readonly mode = 'inline' as const;
  private readonly logger = new Logger('InlineQueue');
  private readonly handlers = new Map<JobName, JobHandler>();
  private readonly timers = new Set<NodeJS.Timeout>();
  private readonly seen = new Set<string>();
  private readonly scheduled: JobName[] = [];
  private closed = false;

  constructor(
    private prisma: PrismaService,
    private policy: JobPolicy,
  ) {}

  register(name: JobName, handler: JobHandler) {
    this.handlers.set(name, handler);
  }

  async start() {
    /* nothing to start */
  }

  async enqueue(name: JobName, data: unknown, opts: EnqueueOptions = {}) {
    if (this.closed) return;
    if (opts.jobId) {
      if (this.seen.has(opts.jobId)) return; // in-process dedupe
      this.seen.add(opts.jobId);
      if (this.seen.size > 5000)
        this.seen.delete(this.seen.values().next().value!);
    }
    if (opts.delayMs) {
      this.later(opts.delayMs, () => void this.attempt(name, data, opts, 1));
      return;
    }
    await this.attempt(name, data, opts, 1);
  }

  private async attempt(
    name: JobName,
    data: unknown,
    opts: EnqueueOptions,
    n: number,
  ) {
    const handler = this.handlers.get(name);
    if (!handler) {
      this.logger.error(`no handler registered for ${name}`);
      return;
    }
    try {
      await handler(data);
    } catch (err) {
      const message = (err as Error).message;
      if (n >= this.policy.attempts) {
        await recordDeadLetter(this.prisma, {
          queue: 'inline',
          jobName: name,
          jobId: opts.jobId,
          payload: data,
          error: message,
          attempts: n,
          sensitive: opts.sensitive,
        });
        return;
      }
      this.logger.warn(
        `${name} failed (attempt ${n}/${this.policy.attempts}): ${message}`,
      );
      this.later(
        this.policy.backoffMs * 2 ** (n - 1),
        () => void this.attempt(name, data, opts, n + 1),
      );
    }
  }

  async schedule(name: JobName, everyMs: number) {
    if (this.scheduled.includes(name)) return;
    this.scheduled.push(name);
    const timer = setInterval(
      () => void this.attempt(name, {}, {}, this.policy.attempts),
      everyMs,
    );
    timer.unref();
    this.timers.add(timer);
  }

  async schedules() {
    return [...this.scheduled];
  }

  private later(ms: number, fn: () => void) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      if (!this.closed) fn();
    }, ms);
    t.unref();
    this.timers.add(t);
  }

  async close() {
    this.closed = true;
    for (const t of this.timers) {
      clearTimeout(t);
      clearInterval(t);
    }
    this.timers.clear();
  }
}
