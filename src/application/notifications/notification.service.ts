import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IMailer, MAILER } from '../../domain/notifications/mailer.interface';
import { IJobQueue, JOB_QUEUE } from '../../domain/queue/job-queue.interface';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  eventReminderTemplate,
  orderConfirmationTemplate,
  passwordResetTemplate,
  verifyEmailTemplate,
} from './templates';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @Inject(MAILER) private mailer: IMailer,
    private prisma: PrismaService,
    private config: ConfigService,
    @Inject(JOB_QUEUE) private queue: IJobQueue,
  ) {}

  private get frontendUrl(): string {
    return (
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173'
    ).replace(/\/$/, '');
  }

  // --- enqueue (called from request paths; cheap and retryable) -------------

  async sendVerification(to: string, name: string | null, token: string) {
    // The raw token is in the payload: dropped from the queue as soon as it ends.
    await this.queue.enqueue(
      'email.verification',
      { to, name, token },
      { sensitive: true },
    );
  }

  async sendPasswordReset(to: string, token: string) {
    await this.queue.enqueue(
      'email.password-reset',
      { to, token },
      { sensitive: true },
    );
  }

  // --- deliver (run by queue workers; throw so failures are retried) ----------

  async deliverVerification(to: string, name: string | null, token: string) {
    const url = `${this.frontendUrl}/verify-email?token=${encodeURIComponent(token)}`;
    await this.mailer.send({ to, ...verifyEmailTemplate(name, url) });
  }

  async deliverPasswordReset(to: string, token: string) {
    const url = `${this.frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await this.mailer.send({ to, ...passwordResetTemplate(url) });
  }

  /**
   * Idempotent: delivery is at-least-once (outbox + retries), so a repeat for an
   * order that was already confirmed does nothing.
   */
  async deliverOrderConfirmation(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        user: { select: { email: true } },
        items: { include: { ticket: { include: { event: true } } } },
      },
    });
    if (!order || order.items.length === 0 || order.confirmationSentAt) return;

    const event = order.items[0].ticket.event;
    const quantity = order.items.reduce((n, i) => n + i.quantity, 0);
    const amount = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: order.currency,
    }).format(order.finalAmount / 100);
    await this.mailer.send({
      to: order.user.email,
      ...orderConfirmationTemplate({
        reference: order.reference,
        eventName: event.name,
        startDate: event.startDate,
        venue: event.venue,
        quantity,
        amountFormatted: amount,
        ticketsUrl: `${this.frontendUrl}/orders/${order.id}`,
      }),
    });
    // Mark after sending: a crash in between means a duplicate email, not a lost one.
    await this.prisma.order.updateMany({
      where: { id: orderId, confirmationSentAt: null },
      data: { confirmationSentAt: new Date() },
    });
  }

  /**
   * Emails ticket holders for events starting within `withinHours`.
   * The reminderSentAt claim is atomic, so overlapping runs never double-send.
   */
  async sendDueReminders(withinHours = 24): Promise<number> {
    const now = new Date();
    const horizon = new Date(now.getTime() + withinHours * 3_600_000);
    const due = await this.prisma.event.findMany({
      where: {
        status: 'PUBLISHED',
        reminderSentAt: null,
        startDate: { gt: now, lte: horizon },
      },
      select: { id: true },
    });

    let sent = 0;
    for (const { id } of due) {
      const claimed = await this.prisma.event.updateMany({
        where: { id, reminderSentAt: null },
        data: { reminderSentAt: now },
      });
      if (claimed.count === 0) continue;

      const event = await this.prisma.event.findUniqueOrThrow({
        where: { id },
      });
      const holders = await this.prisma.issuedTicket.findMany({
        where: { eventId: id, status: 'VALID' },
        distinct: ['ownerId'],
        select: { orderId: true, ownerId: true },
      });
      for (const holder of holders) {
        try {
          const user = await this.prisma.user.findUnique({
            where: { id: holder.ownerId },
            select: { email: true },
          });
          if (!user) continue;
          await this.mailer.send({
            to: user.email,
            ...eventReminderTemplate({
              eventName: event.name,
              startDate: event.startDate,
              venue: event.venue,
              ticketsUrl: `${this.frontendUrl}/orders/${holder.orderId}`,
            }),
          });
          sent++;
        } catch (err) {
          this.logger.error(`Reminder failed for event ${id}`, err as Error);
        }
      }
    }
    return sent;
  }
}
