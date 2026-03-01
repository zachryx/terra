import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { IUserRepository } from '../../../domain/auth/repositories/user.repository.interface';
import {
  User,
  CreateUserInput,
  UpdateUserInput,
  UserFilters,
  UserRole,
  SsoProvider,
} from '../../../domain/auth/entities/user.entity';

@Injectable()
export class UserRepository implements IUserRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateUserInput): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: data.email,
        password: data.password,
        name: data.name,
        avatar: data.avatar,
        role: data.role || UserRole.ATTENDEE,
        provider: data.provider,
        providerId: data.providerId,
        isVerified: data.isVerified || false,
      },
    }) as Promise<User>;
  }

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { id },
    }) as Promise<User | null>;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({
      where: { email: email.toLowerCase() },
    }) as Promise<User | null>;
  }

  async findAll(filters?: UserFilters): Promise<User[]> {
    const where: any = {};

    if (filters?.role) {
      where.role = filters.role;
    }
    if (filters?.provider) {
      where.provider = filters.provider;
    }
    if (filters?.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    return this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    }) as Promise<User[]>;
  }

  async update(id: string, data: UpdateUserInput): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data,
    }) as Promise<User>;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.user.delete({
      where: { id },
    });
  }

  async findByProvider(
    provider: string,
    providerId: string,
  ): Promise<User | null> {
    return this.prisma.user.findFirst({
      where: {
        provider: provider as SsoProvider,
        providerId,
      },
    }) as Promise<User | null>;
  }
}
