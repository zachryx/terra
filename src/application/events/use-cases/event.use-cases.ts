import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { EventRepository } from '../../../infrastructure/events/repositories/event.repository';
import {
  CreateEventDto,
  UpdateEventDto,
  EventQueryDto,
} from '../dto/event.dto';
import {
  Event,
  EventStatus,
} from '../../../domain/events/entities/event.entity';

@Injectable()
export class EventUseCases {
  constructor(private eventRepository: EventRepository) {}

  async create(dto: CreateEventDto, organizerId: string): Promise<Event> {
    return this.eventRepository.create({
      name: dto.name,
      description: dto.description,
      startDate: new Date(dto.startDate),
      endDate: new Date(dto.endDate),
      venue: dto.venue,
      capacity: dto.capacity,
      imageUrl: dto.imageUrl,
      organizerId,
    });
  }

  async findById(id: string): Promise<Event> {
    const event = await this.eventRepository.findById(id);
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  async findAll(query: EventQueryDto): Promise<Event[]> {
    return this.eventRepository.findAll({
      status: query.status,
      startDate: query.startDate ? new Date(query.startDate) : undefined,
      endDate: query.endDate ? new Date(query.endDate) : undefined,
    });
  }

  async findByOrganizer(organizerId: string): Promise<Event[]> {
    return this.eventRepository.findByOrganizer(organizerId);
  }

  async update(
    id: string,
    dto: UpdateEventDto,
    userId: string,
    userRole: string,
  ): Promise<Event> {
    const event = await this.findById(id);

    if (event.organizerId !== userId && userRole !== 'ADMIN') {
      throw new ForbiddenException('You can only update your own events');
    }

    const updateData: any = { ...dto };
    if (dto.startDate) {
      updateData.startDate = new Date(dto.startDate);
    }
    if (dto.endDate) {
      updateData.endDate = new Date(dto.endDate);
    }

    return this.eventRepository.update(id, updateData);
  }

  async delete(id: string, userId: string, userRole: string): Promise<void> {
    const event = await this.findById(id);

    if (event.organizerId !== userId && userRole !== 'ADMIN') {
      throw new ForbiddenException('You can only delete your own events');
    }

    return this.eventRepository.delete(id);
  }

  async publish(id: string, userId: string, userRole: string): Promise<Event> {
    const event = await this.findById(id);

    if (event.organizerId !== userId && userRole !== 'ADMIN') {
      throw new ForbiddenException('You can only publish your own events');
    }

    return this.eventRepository.updateStatus(id, EventStatus.PUBLISHED);
  }

  async cancel(id: string, userId: string, userRole: string): Promise<Event> {
    const event = await this.findById(id);

    if (event.organizerId !== userId && userRole !== 'ADMIN') {
      throw new ForbiddenException('You can only cancel your own events');
    }

    return this.eventRepository.updateStatus(id, EventStatus.CANCELLED);
  }
}
