import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { IJobQueue, JOB_QUEUE } from '../../domain/queue/job-queue.interface';
import { NotificationService } from '../../application/notifications/notification.service';
import { OrderUseCases } from '../../application/orders/use-cases/order.use-cases';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxRelay } from './outbox.relay';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** Registers every job handler and the recurring schedules. */
@Injectable()
export class JobsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    @Inject(JOB_QUEUE) private queue: IJobQueue,
    private notifications: NotificationService,
    private orders: OrderUseCases,
    private outbox: OutboxRelay,
    private prisma: PrismaService,
  ) {}

  async onApplicationBootstrap() {
    const q = this.queue;

    q.register('email.verification', (d) =>
      this.notifications.deliverVerification(d.to, d.name ?? null, d.token),
    );
    q.register('email.password-reset', (d) =>
      this.notifications.deliverPasswordReset(d.to, d.token),
    );
    q.register('email.order-confirmation', (d) =>
      this.notifications.deliverOrderConfirmation(d.orderId),
    );
    q.register('orders.expire-sweep', async () => {
      const n = await this.orders.expireStaleOrders();
      if (n > 0) this.logger.log(`Released ${n} expired order(s)`);
    });
    q.register('events.reminders', async () => {
      const n = await this.notifications.sendDueReminders();
      if (n > 0) this.logger.log(`Sent ${n} event reminder(s)`);
    });
    q.register('outbox.relay', async () => {
      await this.outbox.run();
    });
    q.register('maintenance.cleanup', () => this.cleanup());

    await q.start();

    // Independent of each other: in parallel, so a Redis outage costs boot one
    // timeout instead of one per schedule. Failures retry in the background.
    await Promise.all([
      q.schedule('outbox.relay', 2 * SECOND),
      q.schedule('orders.expire-sweep', MINUTE),
      q.schedule('events.reminders', HOUR),
      q.schedule('maintenance.cleanup', HOUR),
    ]);
  }

  /** Housekeeping so the append-only tables don't grow forever. */
  private async cleanup(): Promise<void> {
    const ago = (ms: number) => new Date(Date.now() - ms);
    const [keys, attempts, sessions, outbox] = await Promise.all([
      this.prisma.idempotencyKey.deleteMany({
        where: { createdAt: { lt: ago(24 * HOUR) } },
      }),
      this.prisma.loginAttempt.deleteMany({
        where: { createdAt: { lt: ago(24 * HOUR) } },
      }),
      this.prisma.session.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      }),
      this.prisma.outboxEvent.deleteMany({
        where: { processedAt: { lt: ago(7 * 24 * HOUR) } },
      }),
    ]);
    this.logger.log(
      `cleanup: ${keys.count} idempotency keys, ${attempts.count} login attempts, ${sessions.count} sessions, ${outbox.count} outbox rows`,
    );
  }
}
