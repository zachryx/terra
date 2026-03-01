import { UserRole, SsoProvider } from '@prisma/client';

export { UserRole, SsoProvider };

export interface User {
  id: string;
  email: string;
  password: string | null;
  name: string | null;
  avatar: string | null;
  role: UserRole;
  provider: SsoProvider;
  providerId: string | null;
  isActive: boolean;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserInput {
  email: string;
  password?: string;
  name?: string;
  avatar?: string;
  role?: UserRole;
  provider: SsoProvider;
  providerId?: string;
  isVerified?: boolean;
}

export interface UpdateUserInput {
  name?: string;
  avatar?: string;
  isActive?: boolean;
  isVerified?: boolean;
}

export interface UserFilters {
  role?: UserRole;
  provider?: SsoProvider;
  isActive?: boolean;
}
