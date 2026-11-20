import { MailMessage } from '../../domain/notifications/mailer.interface';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type Body = Omit<MailMessage, 'to'>;

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px;color:#1a1a1a">
<h2 style="margin-top:0">${escapeHtml(title)}</h2>${bodyHtml}
<hr style="border:none;border-top:1px solid #ddd;margin:24px 0"><p style="color:#777;font-size:12px">Terra</p></body></html>`;
}

function button(url: string, label: string): string {
  return `<p><a href="${escapeHtml(url)}" style="background:#111;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">${escapeHtml(label)}</a></p><p style="font-size:12px;color:#555">Or paste this link: ${escapeHtml(url)}</p>`;
}

export function verifyEmailTemplate(name: string | null, url: string): Body {
  const hello = name ? `Hi ${name}` : 'Hi';
  return {
    subject: 'Verify your email',
    text: `${hello}, confirm your email to finish signing up: ${url}\nThis link expires in 24 hours.`,
    html: layout(
      'Verify your email',
      `<p>${escapeHtml(hello)}, confirm your email to finish signing up.</p>${button(url, 'Verify email')}<p>This link expires in 24 hours.</p>`,
    ),
  };
}

export function passwordResetTemplate(url: string): Body {
  return {
    subject: 'Reset your password',
    text: `Reset your password: ${url}\nThis link expires in 1 hour. If you didn't ask for this, ignore this email.`,
    html: layout(
      'Reset your password',
      `${button(url, 'Choose a new password')}<p>This link expires in 1 hour. If you didn't ask for this, you can ignore this email.</p>`,
    ),
  };
}

export interface OrderEmailData {
  reference: string;
  eventName: string;
  startDate: Date;
  venue: string;
  quantity: number;
  amountFormatted: string;
  ticketsUrl: string;
}

export function orderConfirmationTemplate(d: OrderEmailData): Body {
  const when = d.startDate.toUTCString();
  return {
    subject: `Your tickets for ${d.eventName} (${d.reference})`,
    text: `Order ${d.reference} confirmed.\n${d.eventName}\n${when} at ${d.venue}\n${d.quantity} ticket(s), total ${d.amountFormatted}.\nView your QR tickets: ${d.ticketsUrl}`,
    html: layout(
      "You're going!",
      `<p>Order <strong>${escapeHtml(d.reference)}</strong> is confirmed.</p><p><strong>${escapeHtml(d.eventName)}</strong><br>${escapeHtml(when)}<br>${escapeHtml(d.venue)}</p><p>${d.quantity} ticket(s) · ${escapeHtml(d.amountFormatted)}</p>${button(d.ticketsUrl, 'View my tickets')}`,
    ),
  };
}

export function eventReminderTemplate(d: {
  eventName: string;
  startDate: Date;
  venue: string;
  ticketsUrl: string;
}): Body {
  const when = d.startDate.toUTCString();
  return {
    subject: `Reminder: ${d.eventName} is coming up`,
    text: `${d.eventName} starts ${when} at ${d.venue}. Your tickets: ${d.ticketsUrl}`,
    html: layout(
      'See you soon',
      `<p><strong>${escapeHtml(d.eventName)}</strong> starts<br>${escapeHtml(when)}<br>${escapeHtml(d.venue)}</p>${button(d.ticketsUrl, 'Open my tickets')}`,
    ),
  };
}
