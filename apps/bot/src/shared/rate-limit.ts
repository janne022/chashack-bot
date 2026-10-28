import { createHash } from 'node:crypto';
import type { Db } from './db.js';

export const EXPENSIVE_LIMIT = 15;
export const MEMBER_SEARCH_LIMIT = 30;

export interface QuotaResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

let calls = 0;

export async function consumeQuota(
  db: Db,
  category: string,
  identity: string,
  limit: number,
  windowMs = 60_000,
  clock: () => number = Date.now,
): Promise<QuotaResult> {
  const now = clock();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const bucket = createHash('sha256').update(`${category}\0${identity}`).digest('hex');
  const row = await db.get<{ count: number }>(
    `INSERT INTO rate_limit_buckets (bucket, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT (bucket, window_start) DO UPDATE SET count = rate_limit_buckets.count + 1
     WHERE rate_limit_buckets.count < ? RETURNING count`,
    bucket, windowStart, limit,
  );
  if (++calls % 100 === 0) {
    await db.run('DELETE FROM rate_limit_buckets WHERE ctid IN (SELECT ctid FROM rate_limit_buckets WHERE window_start < ? LIMIT 500)', now - windowMs * 2);
  }
  return row === undefined
    ? { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000)) }
    : { allowed: true, retryAfterSeconds: 0 };
}
