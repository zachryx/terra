export interface VerificationToken {
  id: string;
  userId: string;
  token: string;
  type: string;
  expiresAt: Date;
  createdAt: Date;
}

export interface CreateVerificationTokenInput {
  userId: string;
  token: string;
  type: string;
  expiresAt: Date;
}

export interface SecurityLog {
  id: string;
  userId: string;
  event: string;
  ipAddress: string | null;
  userAgent: string | null;
  timestamp: Date;
}

export interface CreateSecurityLogInput {
  userId: string;
  event: string;
  ipAddress?: string;
  userAgent?: string;
}
