import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ISessionRepository } from '../../../domain/auth/repositories/session.repository.interface';
import {
  Session,
  CreateSessionInput,
  SessionFilters,
} from '../../../domain/auth/entities/session.entity';

@Injectable()
export class SessionRepository implements ISessionRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateSessionInput): Promise<Session> {
    return this.prisma.session.create({
      data: {
        userId: data.userId,
        token: data.token,
        refreshToken: data.refreshToken,
        expiresAt: data.expiresAt,
        userAgent: data.userAgent,
        ipAddress: data.ipAddress,
      },
    }) as Promise<Session>;
  }

  async findByToken(token: string): Promise<Session | null> {
    return this.prisma.session.findUnique({
      where: { token },
    }) as Promise<Session | null>;
  }

  async findByRefreshToken(refreshToken: string): Promise<Session | null> {
    return this.prisma.session.findUnique({
      where: { refreshToken },
    }) as Promise<Session | null>;
  }

  async findByUserId(userId: string): Promise<Session[]> {
    return this.prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    }) as Promise<Session[]>;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.session.delete({
      where: { id },
    });
  }

  async deleteByToken(token: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { token },
    });
  }

  async deleteExpired(): Promise<void> {
    await this.prisma.session.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });
  }
}
