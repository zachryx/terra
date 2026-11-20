import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { MetricsService } from './metrics.service';

/** Times every request. The label is the route *pattern* so cardinality stays bounded. */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const end = this.metrics.httpDuration.startTimer();
    const record = (status: number) =>
      end({
        method: req.method,
        route: req.route?.path ?? 'unmatched',
        status: String(status),
      });
    return next.handle().pipe(
      tap({
        next: () => record(res.statusCode),
        error: (err) => record(err?.status ?? err?.getStatus?.() ?? 500),
      }),
    );
  }
}
