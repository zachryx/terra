import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtVerifyOptions } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import * as bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto, LoginDto, RefreshTokenDto } from './dto/auth.dto';
import { SsoProvider, UserRole, User } from '@prisma/client';

interface SecurityConfig {
  accessTokenMaxAge: number;
  refreshTokenMaxAge: number;
  maxLoginAttempts: number;
  lockoutDuration: number;
  passwordMinLength: number;
  requireUppercase: boolean;
  requireNumbers: boolean;
  requireSpecialChars: boolean;
}

@Injectable()
export class AuthService {
  private readonly securityConfig: SecurityConfig;
  private readonly loginAttempts = new Map<
    string,
    { count: number; lockedUntil?: Date }
  >();

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
    private throttlerGuard: ThrottlerGuard,
  ) {
    this.securityConfig = {
      accessTokenMaxAge: 15 * 60 * 1000,
      refreshTokenMaxAge: 7 * 24 * 60 * 60 * 1000,
      maxLoginAttempts: 5,
      lockoutDuration: 15 * 60 * 1000,
      passwordMinLength: 12,
      requireUppercase: true,
      requireNumbers: true,
      requireSpecialChars: true,
    };
  }

  async register(dto: RegisterDto, requestInfo?: RequestInfo) {
    this.validatePassword(dto.password);
    this.checkAccountLock(dto.email);

    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existingUser) {
      this.recordFailedAttempt(dto.email);
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 14);
    const verificationToken = uuidv4();

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        password: hashedPassword,
        name: dto.name,
        role: dto.role || UserRole.ATTENDEE,
        provider: SsoProvider.LOCAL,
      },
    });

    await this.prisma.verificationToken.create({
      data: {
        userId: user.id,
        token: verificationToken,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        type: 'EMAIL_VERIFICATION',
      },
    });

    await this.logSecurityEvent('REGISTER', user.id, requestInfo);

    return this.generateTokensAndSetCookies(user);
  }

  async login(dto: LoginDto, requestInfo?: RequestInfo) {
    this.checkAccountLock(dto.email.toLowerCase());

    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    if (!isPasswordValid) {
      this.recordFailedAttempt(dto.email.toLowerCase());
      await this.logSecurityEvent('LOGIN_FAILED', user.id, requestInfo);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive) {
      await this.logSecurityEvent(
        'LOGIN_BLOCKED_INACTIVE',
        user.id,
        requestInfo,
      );
      throw new ForbiddenException('Account is deactivated');
    }

    if (!user.isVerified) {
      throw new BadRequestException(
        'Please verify your email before logging in',
      );
    }

    this.clearFailedAttempts(dto.email.toLowerCase());
    await this.prisma.user.update({
      where: { id: user.id },
      data: { updatedAt: new Date() },
    });

    await this.logSecurityEvent('LOGIN_SUCCESS', user.id, requestInfo);

    return this.generateTokensAndSetCookies(user);
  }

  async refreshToken(refreshToken: string, requestInfo?: RequestInfo) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token required');
    }

    const session = await this.prisma.session.findUnique({
      where: { refreshToken },
      include: { user: true },
    });

    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    await this.logSecurityEvent('TOKEN_REFRESH', session.userId, requestInfo);

    return this.generateTokensAndSetCookies(session.user, session.refreshToken);
  }

  async handleSsoCallback(
    provider: SsoProvider,
    profile: SsoProfile,
    requestInfo?: RequestInfo,
  ) {
    let user = await this.prisma.user.findFirst({
      where: {
        provider,
        providerId: profile.providerId,
      },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          email: profile.email.toLowerCase(),
          name: profile.name,
          avatar: profile.avatar,
          provider,
          providerId: profile.providerId,
          role: UserRole.ATTENDEE,
          isVerified: true,
        },
      });
    }

    if (!user.isActive) {
      await this.logSecurityEvent('SSO_BLOCKED', user.id, requestInfo);
      throw new ForbiddenException('Account is deactivated');
    }

    await this.logSecurityEvent('SSO_LOGIN', user.id, requestInfo);

    return this.generateTokensAndSetCookies(user);
  }

  async logout(token: string, requestInfo?: RequestInfo) {
    const session = await this.prisma.session.findUnique({
      where: { token },
      include: { user: true },
    });

    if (session) {
      await this.logSecurityEvent('LOGOUT', session.userId, requestInfo);
    }

    await this.prisma.session.deleteMany({
      where: { token },
    });
  }

  async validateToken(token: string): Promise<User | null> {
    try {
      const session = await this.prisma.session.findUnique({
        where: { token },
        include: { user: true },
      });

      if (!session || session.expiresAt < new Date()) {
        return null;
      }

      if (!session.user.isActive) {
        return null;
      }

      return session.user;
    } catch {
      return null;
    }
  }

  async verifyEmail(token: string) {
    const verification = await this.prisma.verificationToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!verification || verification.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired verification token');
    }

    await this.prisma.user.update({
      where: { id: verification.userId },
      data: { isVerified: true },
    });

    await this.prisma.verificationToken.delete({
      where: { id: verification.id },
    });

    return { message: 'Email verified successfully' };
  }

  private validatePassword(password: string): void {
    const {
      passwordMinLength,
      requireUppercase,
      requireNumbers,
      requireSpecialChars,
    } = this.securityConfig;

    if (password.length < passwordMinLength) {
      throw new BadRequestException(
        `Password must be at least ${passwordMinLength} characters long`,
      );
    }

    if (requireUppercase && !/[A-Z]/.test(password)) {
      throw new BadRequestException(
        'Password must contain at least one uppercase letter',
      );
    }

    if (requireNumbers && !/[0-9]/.test(password)) {
      throw new BadRequestException(
        'Password must contain at least one number',
      );
    }

    if (requireSpecialChars && !/[!@#$%^&*(),.?":{}|<>]/.test(password)) {
      throw new BadRequestException(
        'Password must contain at least one special character',
      );
    }

    const commonPasswords = [
      'password',
      'password123',
      '12345678',
      '123456789',
      'qwerty',
      'admin',
      'letmein',
      'welcome',
      'monkey',
      'dragon',
    ];

    if (
      commonPasswords.some((common) => password.toLowerCase().includes(common))
    ) {
      throw new BadRequestException(
        'Password is too common. Please choose a stronger password',
      );
    }
  }

  private checkAccountLock(email: string): void {
    const attempt = this.loginAttempts.get(email.toLowerCase());

    if (attempt && attempt.lockedUntil && attempt.lockedUntil > new Date()) {
      const remainingMinutes = Math.ceil(
        (attempt.lockedUntil.getTime() - Date.now()) / 60000,
      );
      throw new ForbiddenException(
        `Account is temporarily locked. Try again in ${remainingMinutes} minutes`,
      );
    }
  }

  private recordFailedAttempt(email: string): void {
    const current = this.loginAttempts.get(email.toLowerCase()) || { count: 0 };
    const newCount = current.count + 1;

    if (newCount >= this.securityConfig.maxLoginAttempts) {
      const lockedUntil = new Date(
        Date.now() + this.securityConfig.lockoutDuration,
      );
      this.loginAttempts.set(email.toLowerCase(), {
        count: newCount,
        lockedUntil,
      });
    } else {
      this.loginAttempts.set(email.toLowerCase(), { count: newCount });
    }
  }

  private clearFailedAttempts(email: string): void {
    this.loginAttempts.delete(email.toLowerCase());
  }

  private async logSecurityEvent(
    event: string,
    userId: string,
    requestInfo?: RequestInfo,
  ): Promise<void> {
    try {
      await this.prisma.securityLog.create({
        data: {
          userId,
          event,
          ipAddress: requestInfo?.ipAddress || 'unknown',
          userAgent: requestInfo?.userAgent || 'unknown',
          timestamp: new Date(),
        },
      });
    } catch {
      // Silent fail for logging
    }
  }

  private async generateTokensAndSetCookies(
    user: { id: string; email: string; role: UserRole },
    existingRefreshToken?: string,
  ) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      iat: Date.now(),
      jti: uuidv4(),
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '15m',
      algorithm: 'RS256',
    });

    const refreshToken = existingRefreshToken || uuidv4();
    const family = uuidv4();

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.session.create({
      data: {
        userId: user.id,
        token: accessToken,
        refreshToken,
        expiresAt,
      },
    });

    return {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
      accessToken,
      refreshToken,
    };
  }

  getCookieOptions() {
    return {
      accessToken: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict' as const,
        path: '/',
        maxAge: this.securityConfig.accessTokenMaxAge,
      },
      refreshToken: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict' as const,
        path: '/',
        maxAge: this.securityConfig.refreshTokenMaxAge,
      },
    };
  }

  getCookies() {
    return {
      accessTokenCookie: 'access_token',
      refreshTokenCookie: 'refresh_token',
    };
  }
}

interface RequestInfo {
  ipAddress?: string;
  userAgent?: string;
}

interface SsoProfile {
  providerId: string;
  email: string;
  name?: string;
  avatar?: string;
}
