import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { NotificationService } from '../../application/notifications/notification.service';

@Injectable()
export class ReminderService {
  private readonly logger = new Logger(ReminderService.name);

  constructor(private notifications: NotificationService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async run() {
    try {
      const sent = await this.notifications.sendDueReminders();
      if (sent > 0) this.logger.log(`Sent ${sent} event reminder(s)`);
    } catch (err) {
      this.logger.error('Reminder run failed', err as Error);
    }
  }
}
