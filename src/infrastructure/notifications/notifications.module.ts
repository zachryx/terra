import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationService } from '../../application/notifications/notification.service';
import { MAILER } from '../../domain/notifications/mailer.interface';
import { PrismaModule } from '../prisma/prisma.module';
import { LogMailer } from './log.mailer';
import { ReminderService } from './reminder.service';
import { SmtpMailer } from './smtp.mailer';

@Module({
  imports: [PrismaModule],
  providers: [
    LogMailer,
    ReminderService,
    NotificationService,
    {
      provide: MAILER,
      inject: [ConfigService, LogMailer],
      useFactory: (config: ConfigService, log: LogMailer) =>
        config.get('MAIL_PROVIDER') === 'smtp' ? new SmtpMailer(config) : log,
    },
  ],
  exports: [NotificationService, MAILER, LogMailer],
})
export class NotificationsModule {}
