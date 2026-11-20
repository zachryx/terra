export enum TicketType {
  GENERAL = 'GENERAL',
  VIP = 'VIP',
  EARLY_BIRD = 'EARLY_BIRD',
  GROUP = 'GROUP',
}

/** All monetary values are integers in minor units (cents/kobo). */
export interface Ticket {
  id: string;
  name: string;
  description: string | null;
  ticketType: TicketType;
  price: number;
  quantity: number;
  sold: number;
  maxPerOrder: number;
  minPerOrder: number;
  saleStartDate: Date | null;
  saleEndDate: Date | null;
  eventId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateTicketInput {
  name: string;
  description?: string;
  ticketType?: TicketType;
  price: number;
  quantity: number;
  maxPerOrder?: number;
  minPerOrder?: number;
  saleStartDate?: Date;
  saleEndDate?: Date;
  eventId: string;
}

export interface UpdateTicketInput {
  name?: string;
  description?: string;
  ticketType?: TicketType;
  price?: number;
  quantity?: number;
  maxPerOrder?: number;
  minPerOrder?: number;
  saleStartDate?: Date;
  saleEndDate?: Date;
}

export interface TicketFilters {
  /** Hides tickets of draft events from everyone except organizer/admin. */
  visibleTo?: { id: string; role: string };
  eventId?: string;
  ticketType?: TicketType;
}
