import {
  IsEmail,
  IsString,
  MinLength,
  MaxLength,
  IsUrl,
  IsOptional,
  IsIn,
} from 'class-validator';
import { UserRole } from '@prisma/client';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  password: string;

  @IsString()
  @IsOptional()
  name?: string;

  /** Self-service roles only. ADMIN can never be requested via the API. */
  @IsIn([UserRole.ATTENDEE, UserRole.ORGANIZER])
  @IsOptional()
  role?: UserRole;
}

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;
}

export class RefreshTokenDto {
  /** Optional: falls back to the refresh_token cookie. */
  @IsString()
  @IsOptional()
  refreshToken?: string;
}

export class EmailDto {
  @IsEmail()
  email: string;
}

export class TokenDto {
  @IsString()
  @MaxLength(256)
  token: string;
}

export class ResetPasswordDto {
  @IsString()
  @MaxLength(256)
  token: string;

  @IsString()
  @MaxLength(128)
  password: string;
}

export class UpdateProfileDto {
  @IsString()
  @MaxLength(100)
  @IsOptional()
  name?: string;

  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  @IsOptional()
  avatar?: string;
}
