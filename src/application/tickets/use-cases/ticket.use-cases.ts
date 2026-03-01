import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { TicketRepository } from '../../../infrastructure/tickets/repositories/ticket.repository';
import {
  CreateTicketDto,
  UpdateTicketDto,
  TicketQueryDto,
} from '../dto/ticket.dto';
import { Ticket as TicketModel, Event } from '@prisma/client';
import { EventRepository } from '../../../infrastructure/events/repositories/event.repository';

@Injectable()
export class TicketUseCases {
  constructor(
    private ticketRepository: TicketRepository,
    private eventRepository: EventRepository,
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

  async findAll(query: TicketQueryDto): Promise<TicketModel[]> {
    return this.ticketRepository.findAll({
      eventId: query.eventId,
      ticketType: query.ticketType,
    });
  }

  async findByEventId(eventId: string): Promise<TicketModel[]> {
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

    return this.ticketRepository.delete(id);
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
