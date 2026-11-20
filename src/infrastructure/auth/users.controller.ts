import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { UserRepository } from './repositories/user.repository';
import { UpdateProfileDto } from './dto/auth.dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private users: UserRepository) {}

  private present(u: {
    id: string;
    email: string;
    name: string | null;
    avatar: string | null;
    role: string;
    isVerified: boolean;
    createdAt: Date;
  }) {
    const { id, email, name, avatar, role, isVerified, createdAt } = u;
    return { id, email, name, avatar, role, isVerified, createdAt };
  }

  @Get('me')
  async me(@CurrentUser('id') id: string) {
    return this.present((await this.users.findById(id))!);
  }

  @Patch('me')
  async update(@CurrentUser('id') id: string, @Body() dto: UpdateProfileDto) {
    return this.present(await this.users.update(id, dto));
  }
}
