import { Injectable, Logger } from '@nestjs/common';
import {
  IMailer,
  MailMessage,
} from '../../domain/notifications/mailer.interface';

/** Dev/test mailer: logs the message and keeps it in memory. */
@Injectable()
export class LogMailer implements IMailer {
  private readonly logger = new Logger('Mail');
  readonly outbox: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.outbox.push(message);
    if (this.outbox.length > 200) this.outbox.shift();
    this.logger.log(`to=${message.to} subject="${message.subject}"`);
  }
}
