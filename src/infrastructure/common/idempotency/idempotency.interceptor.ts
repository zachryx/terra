import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnprocessableEntityException,
  BadRequestException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Observable, from, of, throwError } from 'rxjs';
import { catchError, mergeMap, tap } from 'rxjs/operators';
import { PrismaService } from '../../prisma/prisma.service';

const KEY_PATTERN = /^[A-Za-z0-9_\-:.]{8,128}$/;
/** An in-flight claim older than this is assumed to belong to a crashed request. */
const STALE_CLAIM_MS = 2 * 60_000;

/**
 * Stripe-style `Idempotency-Key` support for a POST route.
 *
 *  - no header            -> behaves normally
 *  - new key              -> runs once, stores the response
 *  - same key + same body -> replays the stored response (header Idempotent-Replayed)
 *  - same key, other body -> 422
 *  - same key in flight   -> 409 (client should retry shortly)
 *
 * Failed requests release the key so the client can retry; every guarded
 * handler is atomic, so a failure leaves nothing behind.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private prisma: PrismaService) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<any>> {
    const http = context.switchToHttp();
    const req = http.getRequest();
    const res = http.getResponse();
    const key = req.headers['idempotency-key'];
    if (key === undefined) return next.handle();

    if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
      throw new BadRequestException(
        'Idempotency-Key must be 8-128 characters (letters, digits, _ - : .)',
      );
    }
    const userId: string | undefined = req.user?.id;
    if (!userId) return next.handle(); // auth guard will have rejected anonymous callers

    const scope = `${req.method} ${req.route?.path ?? req.path}`;
    const requestHash = createHash('sha256')
      .update(JSON.stringify(req.body ?? {}))
      .digest('hex');

    const claimed = await this.claim(userId, key, scope, requestHash);
    if (claimed === 'new') {
      return next.handle().pipe(
        mergeMap((body) =>
          from(
            this.prisma.idempotencyKey
              .update({
                where: { userId_key: { userId, key } },
                data: {
                  responseStatus: res.statusCode,
                  responseBody: body as any,
                },
              })
              .then(() => body),
          ),
        ),
        catchError((err) =>
          from(
            this.prisma.idempotencyKey
              .deleteMany({ where: { userId, key } })
              .catch(() => undefined),
          ).pipe(mergeMap(() => throwError(() => err))),
        ),
      );
    }

    // Existing key: validate it describes the same request.
    if (claimed.requestHash !== requestHash || claimed.scope !== scope) {
      throw new UnprocessableEntityException(
        'Idempotency-Key was already used with a different request',
      );
    }
    if (claimed.responseStatus === null) {
      res.setHeader('Retry-After', '1');
      throw new ConflictException(
        'A request with this Idempotency-Key is still being processed',
      );
    }
    res.setHeader('Idempotent-Replayed', 'true');
    res.status(claimed.responseStatus);
    return of(claimed.responseBody).pipe(tap(() => undefined));
  }

  private async claim(
    userId: string,
    key: string,
    scope: string,
    requestHash: string,
  ): Promise<
    | 'new'
    | {
        requestHash: string;
        scope: string;
        responseStatus: number | null;
        responseBody: unknown;
      }
  > {
    // Atomic: exactly one concurrent caller inserts the row.
    const inserted = await this.prisma.$executeRaw`
      INSERT INTO "IdempotencyKey" ("id", "userId", "key", "scope", "requestHash")
      VALUES (gen_random_uuid()::text, ${userId}, ${key}, ${scope}, ${requestHash})
      ON CONFLICT ("userId", "key") DO NOTHING`;
    if (inserted === 1) return 'new';

    const existing = await this.prisma.idempotencyKey.findUniqueOrThrow({
      where: { userId_key: { userId, key } },
    });

    // Take over a claim whose owner died mid-request.
    if (
      existing.responseStatus === null &&
      Date.now() - existing.createdAt.getTime() > STALE_CLAIM_MS
    ) {
      const taken = await this.prisma.idempotencyKey.updateMany({
        where: {
          id: existing.id,
          responseStatus: null,
          createdAt: existing.createdAt,
        },
        data: { createdAt: new Date(), requestHash, scope },
      });
      if (taken.count === 1) return 'new';
    }
    return existing;
  }
}
