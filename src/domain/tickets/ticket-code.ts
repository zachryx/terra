import { createHmac, timingSafeEqual } from 'crypto';

const SIG_LENGTH = 22; // 132 bits of the HMAC, base64url

function sign(id: string, secret: string): string {
  return createHmac('sha256', secret)
    .update(id)
    .digest('base64url')
    .slice(0, SIG_LENGTH);
}

/** `<issuedTicketId>.<signature>`: unforgeable without the server secret. */
export function createTicketCode(id: string, secret: string): string {
  return `${id}.${sign(id, secret)}`;
}

/** Returns the issued-ticket id if the code is authentic, otherwise null. */
export function verifyTicketCode(code: string, secret: string): string | null {
  const dot = code.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = code.slice(0, dot);
  const given = Buffer.from(code.slice(dot + 1));
  const expected = Buffer.from(sign(id, secret));
  if (given.length !== expected.length) return null;
  return timingSafeEqual(given, expected) ? id : null;
}
