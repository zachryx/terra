import { Module } from '@nestjs/common';
import { TicketController } from './controllers/ticket.controller';
import { TicketRepository } from './repositories/ticket.repository';
import { TicketUseCases } from '../../application/tickets/use-cases/ticket.use-cases';
import { PrismaModule } from '../prisma/prisma.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [PrismaModule, EventsModule],
  controllers: [TicketController],
  providers: [TicketRepository, TicketUseCases],
  exports: [TicketRepository, TicketUseCases],
})
export class TicketsModule {}
