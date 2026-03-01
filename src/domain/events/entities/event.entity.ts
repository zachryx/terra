export enum EventStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  CANCELLED = 'CANCELLED',
  COMPLETED = 'COMPLETED',
}

export interface Event {
  id: string;
  name: string;
  description: string | null;
  startDate: Date;
  endDate: Date;
  venue: string;
  capacity: number;
  status: EventStatus;
  imageUrl: string | null;
  organizerId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateEventInput {
  name: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  venue: string;
  capacity: number;
  imageUrl?: string;
}

export interface UpdateEventInput {
  name?: string;
  description?: string;
  startDate?: Date;
  endDate?: Date;
  venue?: string;
  capacity?: number;
  status?: EventStatus;
  imageUrl?: string;
}

export interface EventFilters {
  status?: EventStatus;
  organizerId?: string;
  startDate?: Date;
  endDate?: Date;
}
