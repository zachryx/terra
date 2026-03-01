import {
  Session,
  CreateSessionInput,
  SessionFilters,
} from '../entities/session.entity';

export interface ISessionRepository {
  create(data: CreateSessionInput): Promise<Session>;
  findByToken(token: string): Promise<Session | null>;
  findByRefreshToken(refreshToken: string): Promise<Session | null>;
  findByUserId(userId: string): Promise<Session[]>;
  delete(id: string): Promise<void>;
  deleteByToken(token: string): Promise<void>;
  deleteExpired(): Promise<void>;
}
