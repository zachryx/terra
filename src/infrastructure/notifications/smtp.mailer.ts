import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import {
  IMailer,
  MailMessage,
} from '../../domain/notifications/mailer.interface';

@Injectable()
export class SmtpMailer implements IMailer {
  private readonly transport: nodemailer.Transporter;
  private readonly from: string;

  constructor(config: ConfigService) {
    const user = config.get<string>('SMTP_USER');
    this.from = config.get<string>('FROM_EMAIL') ?? 'noreply@terra.local';
    this.transport = nodemailer.createTransport({
      host: config.get<string>('SMTP_HOST'),
      port: Number(config.get('SMTP_PORT') ?? 587),
      auth: user ? { user, pass: config.get<string>('SMTP_PASS') } : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, ...message });
  }
}
