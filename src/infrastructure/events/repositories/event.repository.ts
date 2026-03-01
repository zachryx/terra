import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IEventRepository } from '../../../domain/events/repositories/event.repository.interface';
import {
  Event,
  CreateEventInput,
  UpdateEventInput,
  EventFilters,
  EventStatus,
} from '../../../domain/events/entities/event.entity';

@Injectable()
export class EventRepository implements IEventRepository {
  constructor(private prisma: PrismaService) {}

  async create(
    data: CreateEventInput & { organizerId: string },
  ): Promise<Event> {
    return this.prisma.event.create({
      data: {
        name: data.name,
        description: data.description,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        venue: data.venue,
        capacity: data.capacity,
        imageUrl: data.imageUrl,
        organizerId: data.organizerId,
        status: EventStatus.DRAFT,
      },
    }) as Promise<Event>;
  }

  async findById(id: string): Promise<Event | null> {
    return this.prisma.event.findUnique({
      where: { id },
    }) as Promise<Event | null>;
  }

  async findAll(filters?: EventFilters): Promise<Event[]> {
    const where: any = {};

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.organizerId) {
      where.organizerId = filters.organizerId;
    }

    if (filters?.startDate) {
      where.startDate = { gte: new Date(filters.startDate) };
    }

    if (filters?.endDate) {
      where.endDate = { lte: new Date(filters.endDate) };
    }

    return this.prisma.event.findMany({
      where,
      orderBy: { startDate: 'asc' },
    }) as Promise<Event[]>;
  }

  async findByOrganizer(organizerId: string): Promise<Event[]> {
    return this.prisma.event.findMany({
      where: { organizerId },
      orderBy: { createdAt: 'desc' },
    }) as Promise<Event[]>;
  }

  async update(id: string, data: UpdateEventInput): Promise<Event> {
    const updateData: any = { ...data };

    if (data.startDate) {
      updateData.startDate = new Date(data.startDate);
    }
    if (data.endDate) {
      updateData.endDate = new Date(data.endDate);
    }

    return this.prisma.event.update({
      where: { id },
      data: updateData,
    }) as Promise<Event>;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.event.delete({
      where: { id },
    });
  }

  async updateStatus(id: string, status: string): Promise<Event> {
    return this.prisma.event.update({
      where: { id },
      data: { status },
    }) as Promise<Event>;
  }
}
