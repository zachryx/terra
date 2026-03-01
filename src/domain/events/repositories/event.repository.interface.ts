import {
  Event,
  CreateEventInput,
  UpdateEventInput,
  EventFilters,
} from '../entities/event.entity';

export interface IEventRepository {
  create(data: CreateEventInput & { organizerId: string }): Promise<Event>;
  findById(id: string): Promise<Event | null>;
  findAll(filters?: EventFilters): Promise<Event[]>;
  findByOrganizer(organizerId: string): Promise<Event[]>;
  update(id: string, data: UpdateEventInput): Promise<Event>;
  delete(id: string): Promise<void>;
  updateStatus(id: string, status: string): Promise<Event>;
}
