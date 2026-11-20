import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/** Query params shared by every list endpoint. */
export class PageQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  @IsOptional()
  limit?: number;

  /** `nextCursor` from the previous page. */
  @IsUUID()
  @IsOptional()
  cursor?: string;
}

export interface Page<T> {
  items: T[];
  /** Pass as `cursor` to get the next page; null when there are no more. */
  nextCursor: string | null;
}

export interface PageArgs {
  take: number;
  skip?: number;
  cursor?: { id: string };
}

/** Prisma args for keyset pagination. Fetches one extra row to detect "has more". */
export function pageArgs(q: PageQueryDto): PageArgs {
  const limit = q.limit ?? DEFAULT_PAGE_SIZE;
  return q.cursor
    ? { take: limit + 1, skip: 1, cursor: { id: q.cursor } }
    : { take: limit + 1 };
}

export function toPage<T extends { id: string }>(
  rows: T[],
  q: PageQueryDto,
): Page<T> {
  const limit = q.limit ?? DEFAULT_PAGE_SIZE;
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}
