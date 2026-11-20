import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ITicketRepository } from '../../../domain/tickets/repositories/ticket.repository.interface';
import {
  CreateTicketInput,
  UpdateTicketInput,
  TicketFilters,
} from '../../../domain/tickets/entities/ticket.entity';
import { PageArgs } from '../../../application/common/pagination';
import { Ticket as TicketModel } from '@prisma/client';

@Injectable()
export class TicketRepository implements ITicketRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateTicketInput): Promise<TicketModel> {
    return this.prisma.ticket.create({
      data: {
        name: data.name,
        description: data.description,
        ticketType: data.ticketType || 'GENERAL',
        price: data.price,
        quantity: data.quantity,
        maxPerOrder: data.maxPerOrder || 10,
        minPerOrder: data.minPerOrder || 1,
        saleStartDate: data.saleStartDate,
        saleEndDate: data.saleEndDate,
        eventId: data.eventId,
      },
    });
  }

  async findById(id: string): Promise<TicketModel | null> {
    return this.prisma.ticket.findUnique({
      where: { id },
    });
  }

  async findByIds(ids: string[]): Promise<TicketModel[]> {
    return this.prisma.ticket.findMany({ where: { id: { in: ids } } });
  }

  async findAll(
    filters?: TicketFilters,
    page?: PageArgs,
  ): Promise<TicketModel[]> {
    const where: any = {};

    if (filters?.eventId) {
      where.eventId = filters.eventId;
    }
    if (filters?.visibleTo && filters.visibleTo.role !== 'ADMIN') {
      where.event = {
        OR: [
          { status: { not: 'DRAFT' } },
          { organizerId: filters.visibleTo.id },
        ],
      };
    }
    if (filters?.ticketType) {
      where.ticketType = filters.ticketType;
    }

    return this.prisma.ticket.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...page,
    });
  }

  async findByEventId(eventId: string): Promise<TicketModel[]> {
    return this.prisma.ticket.findMany({
      where: { eventId },
      orderBy: { price: 'asc' },
    });
  }

  async update(id: string, data: UpdateTicketInput): Promise<TicketModel> {
    return this.prisma.ticket.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.ticket.delete({
      where: { id },
    });
  }

  async hasOrders(id: string): Promise<boolean> {
    return (await this.prisma.orderItem.count({ where: { ticketId: id } })) > 0;
  }

  async updateSoldCount(id: string, quantity: number): Promise<TicketModel> {
    return this.prisma.ticket.update({
      where: { id },
      data: {
        sold: { increment: quantity },
      },
    });
  }

  async getAvailableQuantity(id: string): Promise<number> {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id },
      select: { quantity: true, sold: true },
    });
    return (ticket?.quantity || 0) - (ticket?.sold || 0);
  }
}
