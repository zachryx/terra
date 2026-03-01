import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  VerificationToken,
  CreateVerificationTokenInput,
} from '../../../domain/auth/entities/verification-token.entity';

@Injectable()
export class VerificationTokenRepository {
  constructor(private prisma: PrismaService) {}

  async create(data: CreateVerificationTokenInput): Promise<VerificationToken> {
    return this.prisma.verificationToken.create({
      data: {
        userId: data.userId,
        token: data.token,
        type: data.type,
        expiresAt: data.expiresAt,
      },
    }) as Promise<VerificationToken>;
  }

  async findByToken(token: string): Promise<VerificationToken | null> {
    return this.prisma.verificationToken.findUnique({
      where: { token },
    }) as Promise<VerificationToken | null>;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.verificationToken.delete({
      where: { id },
    });
  }

  async deleteByUserId(userId: string): Promise<void> {
    await this.prisma.verificationToken.deleteMany({
      where: { userId },
    });
  }
}
