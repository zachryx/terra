import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as cookieParser from 'cookie-parser';
import { AllExceptionFilter } from './infrastructure/common/filter/exception.filter';
import { LoggerService } from './infrastructure/logger/logger.service';
import { LoggingInterceptor } from './infrastructure/common/interceptors/logger.interceptor';
import { ResponseInterceptor } from './infrastructure/common/interceptors/response.interceptor';

/** Pipeline shared by the real server and the e2e tests. */
export function configureApp(app: INestApplication): void {
  // Correlation id: honour a sane inbound one, otherwise mint one. Echoed back
  // so a user-reported failure can be found in the logs.
  app.use((req: any, res: any, next: () => void) => {
    const inbound = req.headers['x-request-id'];
    const id =
      typeof inbound === 'string' && /^[A-Za-z0-9_\-.]{8,64}$/.test(inbound)
        ? inbound
        : randomUUID();
    req.id = id;
    res.setHeader('X-Request-Id', id);
    next();
  });

  app.use(cookieParser());

  app.useGlobalFilters(new AllExceptionFilter(new LoggerService()));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  app.useGlobalInterceptors(
    new LoggingInterceptor(new LoggerService()),
    new ResponseInterceptor(),
  );

  app.setGlobalPrefix('api/v1');
}
