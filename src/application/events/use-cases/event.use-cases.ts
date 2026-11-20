import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { Page, PageQueryDto, pageArgs, toPage } from '../../common/pagination';
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

  private assertDateRange(start: Date, end: Date) {
    if (!(end > start)) {
      throw new BadRequestException('endDate must be after startDate');
    }
  }

  async create(dto: CreateEventDto, organizerId: string): Promise<Event> {
    this.assertDateRange(new Date(dto.startDate), new Date(dto.endDate));
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

  /** Drafts are only visible to their organizer and admins. */
  async findVisible(
    id: string,
    viewer: { id: string; role: string },
  ): Promise<Event> {
    const event = await this.findById(id);
    if (
      event.status === EventStatus.DRAFT &&
      event.organizerId !== viewer.id &&
      viewer.role !== 'ADMIN'
    ) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  async findAll(
    query: EventQueryDto,
    viewer: { id: string; role: string },
  ): Promise<Page<Event>> {
    const rows = await this.eventRepository.findAll(
      {
        includePast: query.includePast,
        visibleTo: viewer,
        status: query.status,
        startDate: query.startDate ? new Date(query.startDate) : undefined,
        endDate: query.endDate ? new Date(query.endDate) : undefined,
      },
      pageArgs(query),
    );
    return toPage(rows, query);
  }

  async findByOrganizer(
    organizerId: string,
    query: PageQueryDto = {},
  ): Promise<Page<Event>> {
    const rows = await this.eventRepository.findByOrganizer(
      organizerId,
      pageArgs(query),
    );
    return toPage(rows, query);
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

    this.assertDateRange(
      dto.startDate ? new Date(dto.startDate) : event.startDate,
      dto.endDate ? new Date(dto.endDate) : event.endDate,
    );

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
    if (await this.eventRepository.hasOrders(id)) {
      throw new ConflictException(
        'This event has orders and cannot be deleted. Cancel it instead.',
      );
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
