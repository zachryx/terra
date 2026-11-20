import { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { LoggerService } from '../../logger/logger.service';
import { Observable, tap } from 'rxjs';

export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: LoggerService) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<any>,
  ): Observable<any> | Promise<Observable<any>> {
    const now = Date.now();
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest();

    // Per-request logging is synchronous console I/O. LOG_REQUESTS=false turns
    // it off for hot paths (the access log usually lives at the proxy).
    if (process.env.LOG_REQUESTS === 'false') return next.handle();

    const ip = this.getIp(request);

    return next.handle().pipe(
      tap(() => {
        this.logger.log(
          `${request.method} ${request.path}`,
          `id=${request.id} ip=${ip} duration=${Date.now() - now}ms`,
        );
      }),
    );
  }

  private getIp(request: any): string {
    let ip: string;
    const ipAddr = request.headers['x-forwarded-for'];
    if (ipAddr) {
      const list = ipAddr.split(',');
      ip = list[list.length - 1];
    } else {
      ip = request.connection.remoteAddress;
    }

    return ip.replace('::ffff', '');
  }
}
