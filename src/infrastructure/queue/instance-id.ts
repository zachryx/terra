import { randomUUID } from 'crypto';

/** Identifies this process. Stamped on outbox rows so tests can isolate relays. */
export const INSTANCE_ID = randomUUID();
