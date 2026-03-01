export interface Ticket {
  id: string;
  name: string;
  description: string | null;
  ticketType: string;
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
  ticketType?: string;
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
  ticketType?: string;
  price?: number;
  quantity?: number;
  maxPerOrder?: number;
  minPerOrder?: number;
  saleStartDate?: Date;
  saleEndDate?: Date;
}

export interface TicketFilters {
  eventId?: string;
  ticketType?: string;
}
