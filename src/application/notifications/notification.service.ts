import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IMailer, MAILER } from '../../domain/notifications/mailer.interface';
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
  ) {}

  private get frontendUrl(): string {
    return (
      this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:5173'
    ).replace(/\/$/, '');
  }

  async sendVerification(to: string, name: string | null, token: string) {
    const url = `${this.frontendUrl}/verify-email?token=${encodeURIComponent(token)}`;
    await this.mailer.send({ to, ...verifyEmailTemplate(name, url) });
  }

  async sendPasswordReset(to: string, token: string) {
    const url = `${this.frontendUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await this.mailer.send({ to, ...passwordResetTemplate(url) });
  }

  /** Never throws: a mail outage must not fail checkout or webhooks. */
  async sendOrderConfirmation(orderId: string): Promise<void> {
    try {
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: {
          user: { select: { email: true } },
          items: { include: { ticket: { include: { event: true } } } },
        },
      });
      if (!order || order.items.length === 0) return;
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
    } catch (err) {
      this.logger.error(
        `Order confirmation failed for ${orderId}`,
        err as Error,
      );
    }
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
