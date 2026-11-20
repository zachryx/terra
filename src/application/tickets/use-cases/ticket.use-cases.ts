import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Page, pageArgs, toPage } from '../../common/pagination';
import { ConfigService } from '@nestjs/config';
import { CacheService } from '../../../infrastructure/redis/cache.service';
import { TicketRepository } from '../../../infrastructure/tickets/repositories/ticket.repository';
import {
  CreateTicketDto,
  UpdateTicketDto,
  TicketQueryDto,
} from '../dto/ticket.dto';
import { Ticket as TicketModel } from '@prisma/client';
import { EventRepository } from '../../../infrastructure/events/repositories/event.repository';

@Injectable()
export class TicketUseCases {
  constructor(
    private ticketRepository: TicketRepository,
    private eventRepository: EventRepository,
    private cache: CacheService,
    private config: ConfigService,
  ) {}

  async create(
    dto: CreateTicketDto,
    userId: string,
    userRole: string,
  ): Promise<TicketModel> {
    const event = await this.eventRepository.findById(dto.eventId);

    if (!event) {
      throw new NotFoundException('Event not found');
    }

    if (event.organizerId !== userId && userRole !== 'ADMIN') {
      throw new ForbiddenException(
        'You can only add tickets to your own events',
      );
    }

    await this.assertWithinEventCapacity(
      dto.eventId,
      dto.quantity,
      event.capacity,
    );

    return this.ticketRepository.create({
      ...dto,
      saleStartDate: dto.saleStartDate
        ? new Date(dto.saleStartDate)
        : undefined,
      saleEndDate: dto.saleEndDate ? new Date(dto.saleEndDate) : undefined,
    });
  }

  async findById(id: string): Promise<TicketModel> {
    const ticket = await this.ticketRepository.findById(id);
    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }
    return ticket;
  }

  async findAll(
    query: TicketQueryDto,
    viewer: { id: string; role: string },
  ): Promise<Page<TicketModel>> {
    const rows = await this.ticketRepository.findAll(
      {
        visibleTo: viewer,
        eventId: query.eventId,
        ticketType: query.ticketType,
      },
      pageArgs(query),
    );
    return toPage(rows, query);
  }

  async findByEventId(
    eventId: string,
    viewer: { id: string; role: string },
  ): Promise<TicketModel[]> {
    // Availability shown to attendees may lag by a few seconds; the order
    // transaction is what actually enforces stock.
    if (viewer.role === 'ATTENDEE') {
      const ttl = Number(this.config.get('TICKET_CACHE_TTL_SECONDS') ?? 3);
      return this.cache.wrap(`tickets:event:${eventId}`, ttl, () =>
        this.loadEventTickets(eventId, viewer),
      );
    }
    return this.loadEventTickets(eventId, viewer);
  }

  private async loadEventTickets(
    eventId: string,
    viewer: { id: string; role: string },
  ): Promise<TicketModel[]> {
    const event = await this.eventRepository.findById(eventId);
    if (
      !event ||
      (event.status === 'DRAFT' &&
        event.organizerId !== viewer.id &&
        viewer.role !== 'ADMIN')
    ) {
      throw new NotFoundException('Event not found');
    }
    return this.ticketRepository.findByEventId(eventId);
  }

  async update(
    id: string,
    dto: UpdateTicketDto,
    userId: string,
    userRole: string,
  ): Promise<TicketModel> {
    const ticket = await this.findById(id);
    const event = await this.eventRepository.findById(ticket.eventId);

    if (event.organizerId !== userId && userRole !== 'ADMIN') {
      throw new ForbiddenException(
        'You can only update tickets for your own events',
      );
    }

    if (dto.quantity !== undefined) {
      if (dto.quantity < ticket.sold) {
        throw new BadRequestException(
          `Cannot reduce quantity below the ${ticket.sold} tickets already sold`,
        );
      }
      await this.assertWithinEventCapacity(
        ticket.eventId,
        dto.quantity - ticket.quantity,
        event.capacity,
      );
    }

    const updateData: any = { ...dto };
    if (dto.saleStartDate) {
      updateData.saleStartDate = new Date(dto.saleStartDate);
    }
    if (dto.saleEndDate) {
      updateData.saleEndDate = new Date(dto.saleEndDate);
    }

    return this.ticketRepository.update(id, updateData);
  }

  async delete(id: string, userId: string, userRole: string): Promise<void> {
    const ticket = await this.findById(id);
    const event = await this.eventRepository.findById(ticket.eventId);

    if (event.organizerId !== userId && userRole !== 'ADMIN') {
      throw new ForbiddenException(
        'You can only delete tickets for your own events',
      );
    }
    if (await this.ticketRepository.hasOrders(id)) {
      throw new ConflictException(
        'This ticket has orders and cannot be deleted. Reduce its quantity instead.',
      );
    }

    return this.ticketRepository.delete(id);
  }

  /** Total ticket inventory for an event may not exceed the event capacity. */
  private async assertWithinEventCapacity(
    eventId: string,
    additional: number,
    capacity: number,
  ): Promise<void> {
    const existing = await this.ticketRepository.findByEventId(eventId);
    const allocated = existing.reduce((sum, t) => sum + t.quantity, 0);
    if (allocated + additional > capacity) {
      throw new BadRequestException(
        `Ticket inventory would exceed event capacity (${allocated + additional}/${capacity})`,
      );
    }
  }

  async checkAvailability(
    ticketId: string,
    quantity: number,
  ): Promise<boolean> {
    const ticket = await this.findById(ticketId);
    const now = new Date();

    if (ticket.saleStartDate && now < ticket.saleStartDate) {
      throw new BadRequestException('Ticket sales have not started yet');
    }

    if (ticket.saleEndDate && now > ticket.saleEndDate) {
      throw new BadRequestException('Ticket sales have ended');
    }

    const available =
      await this.ticketRepository.getAvailableQuantity(ticketId);

    if (quantity > available) {
      throw new BadRequestException(`Only ${available} tickets available`);
    }

    if (quantity < ticket.minPerOrder) {
      throw new BadRequestException(
        `Minimum ${ticket.minPerOrder} tickets required`,
      );
    }

    if (quantity > ticket.maxPerOrder) {
      throw new BadRequestException(
        `Maximum ${ticket.maxPerOrder} tickets allowed per order`,
      );
    }

    return true;
  }
}
