import { createTicketCode, verifyTicketCode } from './ticket-code';

describe('ticket codes', () => {
  const secret = 'unit-secret';
  const id = '5b0c3f55-7d2c-4a55-9d84-0f1d2d2d6a11';

  it('round-trips an authentic code', () => {
    expect(verifyTicketCode(createTicketCode(id, secret), secret)).toBe(id);
  });

  it('rejects a code signed with another secret', () => {
    expect(verifyTicketCode(createTicketCode(id, 'other'), secret)).toBeNull();
  });

  it('rejects a tampered id', () => {
    const code = createTicketCode(id, secret);
    const forged = code.replace(id.slice(0, 4), 'ffff');
    expect(verifyTicketCode(forged, secret)).toBeNull();
  });

  it('rejects malformed input without throwing', () => {
    for (const bad of ['', '.', 'abc', 'abc.', '.sig', `${id}.short`]) {
      expect(verifyTicketCode(bad, secret)).toBeNull();
    }
  });
});
