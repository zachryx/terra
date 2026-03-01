import {
  User,
  CreateUserInput,
  UpdateUserInput,
  UserFilters,
} from '../entities/user.entity';

export interface IUserRepository {
  create(data: CreateUserInput): Promise<User>;
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  findAll(filters?: UserFilters): Promise<User[]>;
  update(id: string, data: UpdateUserInput): Promise<User>;
  delete(id: string): Promise<void>;
  findByProvider(provider: string, providerId: string): Promise<User | null>;
}
