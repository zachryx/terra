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
import { v4 as uuidv4 } from 'uuid';
import { UserRepository } from './repositories/user.repository';
import { SessionRepository } from './repositories/session.repository';
import { VerificationTokenRepository } from './repositories/verification-token.repository';
import { SecurityLogRepository } from './repositories/security-log.repository';
import { RegisterDto, LoginDto, RefreshTokenDto } from './dto/auth.dto';
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
  private readonly loginAttempts = new Map<
    string,
    { count: number; lockedUntil?: Date }
  >();

  constructor(
    private userRepository: UserRepository,
    private sessionRepository: SessionRepository,
    private verificationTokenRepository: VerificationTokenRepository,
    private securityLogRepository: SecurityLogRepository,
    private jwtService: JwtService,
    private configService: ConfigService,
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

    const existingUser = await this.userRepository.findByEmail(
      dto.email.toLowerCase(),
    );

    if (existingUser) {
      this.recordFailedAttempt(dto.email);
      throw new ConflictException('Email already registered');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 14);
    const verificationToken = uuidv4();

    const user = await this.userRepository.create({
      email: dto.email.toLowerCase(),
      password: hashedPassword,
      name: dto.name,
      role: dto.role || UserRole.ATTENDEE,
      provider: SsoProvider.LOCAL,
    });

    await this.verificationTokenRepository.create({
      userId: user.id,
      token: verificationToken,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      type: 'EMAIL_VERIFICATION',
    });

    await this.logSecurityEvent('REGISTER', user.id, requestInfo);

    return this.generateTokens(user);
  }

  async login(dto: LoginDto, requestInfo?: RequestInfo) {
    this.checkAccountLock(dto.email.toLowerCase());

    const user = await this.userRepository.findByEmail(dto.email.toLowerCase());

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

    await this.logSecurityEvent('TOKEN_REFRESH', user.id, requestInfo);

    return this.generateTokens(user, session.refreshToken);
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
    const verification =
      await this.verificationTokenRepository.findByToken(token);

    if (!verification || verification.expiresAt < new Date()) {
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
      iat: Date.now(),
      jti: uuidv4(),
    };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: '15m',
    });

    const refreshToken = existingRefreshToken || uuidv4();

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
