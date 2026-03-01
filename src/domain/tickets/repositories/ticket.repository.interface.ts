import { Ticket as TicketModel } from '@prisma/client';
import {
  CreateTicketInput,
  UpdateTicketInput,
  TicketFilters,
} from '../entities/ticket.entity';

export interface ITicketRepository {
  create(data: CreateTicketInput): Promise<TicketModel>;
  findById(id: string): Promise<TicketModel | null>;
  findAll(filters?: TicketFilters): Promise<TicketModel[]>;
  findByEventId(eventId: string): Promise<TicketModel[]>;
  update(id: string, data: UpdateTicketInput): Promise<TicketModel>;
  delete(id: string): Promise<void>;
  updateSoldCount(id: string, quantity: number): Promise<TicketModel>;
  getAvailableQuantity(id: string): Promise<number>;
}
