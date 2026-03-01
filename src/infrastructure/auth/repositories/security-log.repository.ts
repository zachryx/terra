import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  SecurityLog,
  CreateSecurityLogInput,
} from '../../../domain/auth/entities/verification-token.entity';

@Injectable()
export class SecurityLogRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateSecurityLogInput): Promise<SecurityLog> {
    return this.prisma.securityLog.create({
      data: {
        userId: data.userId,
        event: data.event,
        ipAddress: data.ipAddress,
        userAgent: data.userAgent,
      },
    }) as Promise<SecurityLog>;
  }

  async findByUserId(userId: string): Promise<SecurityLog[]> {
    return this.prisma.securityLog.findMany({
      where: { userId },
      orderBy: { timestamp: 'desc' },
      take: 100,
    }) as Promise<SecurityLog[]>;
  }

  async findRecent(limit: number = 100): Promise<SecurityLog[]> {
    return this.prisma.securityLog.findMany({
      orderBy: { timestamp: 'desc' },
      take: limit,
    }) as Promise<SecurityLog[]>;
  }
}
