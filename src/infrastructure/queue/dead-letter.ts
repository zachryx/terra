import { Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const logger = new Logger('DeadLetter');

/** Persists a job that used up all its retries so it can be inspected and replayed. */
export async function recordDeadLetter(
  prisma: PrismaService,
  d: {
    queue: string;
    jobName: string;
    jobId?: string;
    payload: unknown;
    error: string;
    attempts: number;
    sensitive?: boolean;
  },
): Promise<void> {
  try {
    await prisma.deadLetter.create({
      data: {
        queue: d.queue,
        jobName: d.jobName,
        jobId: d.jobId,
        // never persist tokens
        payload: d.sensitive ? { redacted: true } : (d.payload as any),
        error: d.error.slice(0, 1000),
        attempts: d.attempts,
      },
    });
    logger.error(
      `${d.jobName} failed permanently after ${d.attempts} attempts: ${d.error}`,
    );
  } catch (err) {
    logger.error(
      `could not record dead letter for ${d.jobName}: ${(err as Error).message}`,
    );
  }
}
