export const JOB_QUEUE = 'JOB_QUEUE';

export type JobName =
  | 'email.verification'
  | 'email.password-reset'
  | 'email.order-confirmation'
  | 'orders.expire-sweep'
  | 'events.reminders'
  | 'maintenance.cleanup'
  | 'outbox.relay';

export interface EnqueueOptions {
  /** Same id = same job: duplicates are ignored while the job exists. */
  jobId?: string;
  delayMs?: number;
  /** Payload contains secrets (tokens): drop it as soon as the job ends. */
  sensitive?: boolean;
}

export type JobHandler = (data: any) => Promise<void>;

export interface IJobQueue {
  /** `bull` = durable, shared across replicas. `inline` = in-process fallback. */
  readonly mode: 'bull' | 'inline';
  register(name: JobName, handler: JobHandler): void;
  /** Begin processing. Called once handlers are registered. */
  start(): Promise<void>;
  enqueue(name: JobName, data: unknown, opts?: EnqueueOptions): Promise<void>;
  /** Run `name` every `everyMs` ms. In bull mode only one replica runs each tick. */
  schedule(name: JobName, everyMs: number): Promise<void>;
  /** Names of active recurring schedules (for diagnostics/tests). */
  schedules(): Promise<string[]>;
  close(): Promise<void>;
}

export interface JobPolicy {
  attempts: number;
  backoffMs: number;
  concurrency: number;
}
