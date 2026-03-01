export interface Session {
  id: string;
  userId: string;
  token: string;
  refreshToken: string | null;
  expiresAt: Date;
  createdAt: Date;
  userAgent: string | null;
  ipAddress: string | null;
}

export interface CreateSessionInput {
  userId: string;
  token: string;
  refreshToken: string;
  expiresAt: Date;
  userAgent?: string;
  ipAddress?: string;
}

export interface SessionFilters {
  userId?: string;
  token?: string;
  refreshToken?: string;
}
