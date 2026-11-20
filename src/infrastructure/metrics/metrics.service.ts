import { Injectable } from '@nestjs/common';
import {
  Counter,
  Gauge,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from 'prom-client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Prometheus metrics. A registry per instance (not the global default) so
 * several apps in one process, as in tests, don't collide on registration.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  readonly httpDuration = new Histogram({
    name: 'terra_http_request_duration_seconds',
    help: 'HTTP request duration',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    registers: [this.registry],
  });

  readonly ordersCreated = new Counter({
    name: 'terra_orders_created_total',
    help: 'Orders placed, by initial status',
    labelNames: ['status'] as const,
    registers: [this.registry],
  });

  readonly checkoutRejected = new Counter({
    name: 'terra_checkout_rejected_total',
    help: 'Checkouts turned away',
    labelNames: ['reason'] as const, // sold_out_gate | stock_conflict
    registers: [this.registry],
  });

  readonly webhooks = new Counter({
    name: 'terra_payment_webhooks_total',
    help: 'Payment webhooks handled, by result',
    labelNames: ['result'] as const,
    registers: [this.registry],
  });

  constructor(prisma: PrismaService) {
    collectDefaultMetrics({ register: this.registry });

    // Sampled at scrape time: cheap indexed counts, always current.
    new Gauge({
      name: 'terra_outbox_pending',
      help: 'Outbox events not yet delivered (should hover near 0)',
      registers: [this.registry],
      async collect() {
        this.set(
          await prisma.outboxEvent.count({ where: { processedAt: null } }),
        );
      },
    });
    new Gauge({
      name: 'terra_dead_letters',
      help: 'Jobs that exhausted their retries (alert when this grows)',
      registers: [this.registry],
      async collect() {
        this.set(await prisma.deadLetter.count());
      },
    });
    new Gauge({
      name: 'terra_orders_pending_expired',
      help: 'Pending orders past their hold that have not been released yet',
      registers: [this.registry],
      async collect() {
        this.set(
          await prisma.order.count({
            where: { status: 'PENDING', expiresAt: { lt: new Date() } },
          }),
        );
      },
    });
  }
}
