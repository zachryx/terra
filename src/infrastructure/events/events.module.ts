import { Module } from '@nestjs/common';
import { EventController } from './controllers/event.controller';
import { EventRepository } from './repositories/event.repository';
import { EventUseCases } from '../../application/events/use-cases/event.use-cases';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [EventController],
  providers: [EventRepository, EventUseCases],
  exports: [EventRepository, EventUseCases],
})
export class EventsModule {}
