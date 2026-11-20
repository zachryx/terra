import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from '../../application/notifications/notification.service';
import { UserRepository } from './repositories/user.repository';
import { SessionRepository } from './repositories/session.repository';
import { VerificationTokenRepository } from './repositories/verification-token.repository';
import { SecurityLogRepository } from './repositories/security-log.repository';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import { UserRole, SsoProvider, User } from '@prisma/client';

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
  constructor(
    private userRepository: UserRepository,
    private sessionRepository: SessionRepository,
    private verificationTokenRepository: VerificationTokenRepository,
    private securityLogRepository: SecurityLogRepository,
    private jwtService: JwtService,
    private configService: ConfigService,
    private prisma: PrismaService,
    private notifications: NotificationService,
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

    const existingUser = await this.userRepository.findByEmail(
      dto.email.toLowerCase(),
    );
    if (existingUser) {
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 12);
    const user = await this.userRepository.create({
      email: dto.email.toLowerCase(),
      password: hashedPassword,
      name: dto.name,
      role: dto.role || UserRole.ATTENDEE,
      provider: SsoProvider.LOCAL,
    });

    await this.issueVerificationEmail(user);
    await this.logSecurityEvent('REGISTER', user.id, requestInfo);

    // No session until the email is verified (login enforces the same rule).
    return {
      user: { id: user.id, email: user.email, role: user.role },
      message: 'Account created. Check your email to verify your address.',
    };
  }

  async resendVerification(email: string) {
    const user = await this.userRepository.findByEmail(email.toLowerCase());
    // Same response whether or not the account exists (no enumeration).
    if (user && !user.isVerified && user.provider === SsoProvider.LOCAL) {
      await this.issueVerificationEmail(user);
    }
    return { message: 'If the account needs verification, an email was sent.' };
  }

  async forgotPassword(email: string, requestInfo?: RequestInfo) {
    const user = await this.userRepository.findByEmail(email.toLowerCase());
    if (user && user.isActive && user.provider === SsoProvider.LOCAL) {
      const raw = randomBytes(32).toString('base64url');
      await this.verificationTokenRepository.deleteByUserIdAndType(
        user.id,
        'PASSWORD_RESET',
      );
      await this.verificationTokenRepository.create({
        userId: user.id,
        token: AuthService.hashToken(raw),
        type: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      await this.logSecurityEvent(
        'PASSWORD_RESET_REQUESTED',
        user.id,
        requestInfo,
      );
      await this.notifications.sendPasswordReset(user.email, raw);
    }
    return { message: 'If that email is registered, a reset link was sent.' };
  }

  async resetPassword(
    token: string,
    newPassword: string,
    requestInfo?: RequestInfo,
  ) {
    this.validatePassword(newPassword);
    const record = await this.verificationTokenRepository.findByToken(
      AuthService.hashToken(token),
    );
    if (
      !record ||
      record.type !== 'PASSWORD_RESET' ||
      record.expiresAt < new Date()
    ) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    // Single use: consuming the token first means a replay can't win a race.
    await this.verificationTokenRepository.delete(record.id);
    await this.userRepository.update(record.userId, {
      password: await bcrypt.hash(newPassword, 12),
    });
    // Everyone signed in with the old password is signed out.
    await this.sessionRepository.deleteByUserId(record.userId);
    await this.logSecurityEvent('PASSWORD_RESET', record.userId, requestInfo);
    return { message: 'Password updated. Please sign in again.' };
  }

  private async issueVerificationEmail(user: {
    id: string;
    email: string;
    name: string | null;
  }) {
    const raw = randomBytes(32).toString('base64url');
    await this.verificationTokenRepository.deleteByUserIdAndType(
      user.id,
      'EMAIL_VERIFICATION',
    );
    await this.verificationTokenRepository.create({
      userId: user.id,
      token: AuthService.hashToken(raw),
      type: 'EMAIL_VERIFICATION',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    await this.notifications.sendVerification(user.email, user.name, raw);
  }

  /** Tokens are stored hashed so a database leak can't be replayed. */
  static hashToken(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  async login(dto: LoginDto, requestInfo?: RequestInfo) {
    const email = dto.email.toLowerCase();
    await this.checkAccountLock(email);

    const user = await this.userRepository.findByEmail(email);

    if (!user || !user.password) {
      await this.recordFailedAttempt(email);
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.password);

    if (!isPasswordValid) {
      await this.recordFailedAttempt(email);
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

    await this.clearFailedAttempts(email);

    await this.logSecurityEvent('LOGIN_SUCCESS', user.id, requestInfo);

    return this.generateTokens(user);
  }

  async refreshToken(refreshToken: string, requestInfo?: RequestInfo) {
    if (!refreshToken) {
      throw new UnauthorizedException('Refresh token required');
    }

    const session =
      await this.sessionRepository.findByRefreshToken(refreshToken);

    if (!session || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const user = await this.userRepository.findById(session.userId);

    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // Rotation: the old session (and its refresh token) dies with this call,
    // so a stolen refresh token is single-use.
    await this.sessionRepository.delete(session.id);
    await this.logSecurityEvent('TOKEN_REFRESH', user.id, requestInfo);

    return this.generateTokens(user);
  }

  async handleSsoCallback(
    provider: SsoProvider,
    profile: SsoProfile,
    requestInfo?: RequestInfo,
  ) {
    let user = await this.userRepository.findByProvider(
      provider,
      profile.providerId,
    );

    if (!user) {
      const sameEmail = await this.userRepository.findByEmail(
        profile.email.toLowerCase(),
      );
      if (sameEmail) {
        throw new ConflictException(
          'An account with this email already exists. Sign in with your original method.',
        );
      }
      user = await this.userRepository.create({
        email: profile.email.toLowerCase(),
        name: profile.name,
        avatar: profile.avatar,
        provider,
        providerId: profile.providerId,
        isVerified: true,
      });
    }

    if (!user.isActive) {
      await this.logSecurityEvent('SSO_BLOCKED', user.id, requestInfo);
      throw new ForbiddenException('Account is deactivated');
    }

    await this.logSecurityEvent('SSO_LOGIN', user.id, requestInfo);

    return this.generateTokens(user);
  }

  async logout(token: string, requestInfo?: RequestInfo) {
    const session = await this.sessionRepository.findByToken(token);

    if (session) {
      await this.logSecurityEvent('LOGOUT', session.userId, requestInfo);
    }

    await this.sessionRepository.deleteByToken(token);
  }

  async validateToken(token: string): Promise<User | null> {
    try {
      const session = await this.sessionRepository.findByToken(token);

      if (!session || session.expiresAt < new Date()) {
        return null;
      }

      const user = await this.userRepository.findById(session.userId);

      if (!user || !user.isActive) {
        return null;
      }

      return user as User;
    } catch {
      return null;
    }
  }

  async verifyEmail(token: string) {
    const verification = await this.verificationTokenRepository.findByToken(
      AuthService.hashToken(token),
    );

    if (
      !verification ||
      verification.type !== 'EMAIL_VERIFICATION' ||
      verification.expiresAt < new Date()
    ) {
      throw new UnauthorizedException('Invalid or expired verification token');
    }

    await this.userRepository.update(verification.userId, { isVerified: true });
    await this.verificationTokenRepository.delete(verification.id);

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

  /** Locked when there are too many failures inside the lockout window. */
  private async checkAccountLock(email: string): Promise<void> {
    const { maxLoginAttempts, lockoutDuration } = this.securityConfig;
    const since = new Date(Date.now() - lockoutDuration);
    const recent = await this.prisma.loginAttempt.findMany({
      where: { email, createdAt: { gt: since } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    });
    if (recent.length >= maxLoginAttempts) {
      const unlockAt =
        recent[recent.length - maxLoginAttempts].createdAt.getTime() +
        lockoutDuration;
      const minutes = Math.max(1, Math.ceil((unlockAt - Date.now()) / 60000));
      throw new ForbiddenException(
        `Account is temporarily locked. Try again in ${minutes} minutes`,
      );
    }
  }

  private async recordFailedAttempt(email: string): Promise<void> {
    await this.prisma.loginAttempt.create({ data: { email } });
    // Opportunistic cleanup keeps the table small.
    await this.prisma.loginAttempt.deleteMany({
      where: {
        email,
        createdAt: {
          lt: new Date(Date.now() - this.securityConfig.lockoutDuration),
        },
      },
    });
  }

  private async clearFailedAttempts(email: string): Promise<void> {
    await this.prisma.loginAttempt.deleteMany({ where: { email } });
  }

  private async logSecurityEvent(
    event: string,
    userId: string,
    requestInfo?: RequestInfo,
  ): Promise<void> {
    try {
      await this.securityLogRepository.create({
        userId,
        event,
        ipAddress: requestInfo?.ipAddress || 'unknown',
        userAgent: requestInfo?.userAgent || 'unknown',
      });
    } catch {
      // Silent fail for logging
    }
  }

  private async generateTokens(user: User, existingRefreshToken?: string) {
    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      jti: randomUUID(),
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '15m',
    });

    const refreshToken = existingRefreshToken || randomUUID();

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.sessionRepository.create({
      userId: user.id,
      token: accessToken,
      refreshToken,
      expiresAt,
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
