import assert from 'node:assert/strict';
import test from 'node:test';
import { consumeQuota, type QuotaResult } from './rate-limit.js';
import { openTestDb } from './test-db.js';
import { openPostgres } from './postgres.js';

test('fixed-window quota allows the limit, denies until reset, and retries exactly at the boundary', async () => {
  const db = await openTestDb();
  try {
    let now = 120_000;
    const consume = () => consumeQuota(db, 'ordinary', 'actor:guild', 2, 60_000, () => now);
    assert.deepEqual(await consume(), { allowed: true, retryAfterSeconds: 0 });
    assert.deepEqual(await consume(), { allowed: true, retryAfterSeconds: 0 });
    const denied: QuotaResult = await consume();
    assert.deepEqual(denied, { allowed: false, retryAfterSeconds: 60 });
    now = 180_000;
    assert.deepEqual(await consume(), { allowed: true, retryAfterSeconds: 0 });
  } finally { await db.close(); }
});

test('concurrent consumers cannot exceed a shared quota', async () => {
  const db = await openTestDb();
  const schema = await db.get<{ name: string }>('SELECT current_schema() AS name');
  const peer = await openPostgres(process.env.DATABASE_URL!, schema!.name);
  try {
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => consumeQuota(i % 2 ? peer : db, 'expensive', 'actor:guild', 3, 60_000, () => 240_000)));
    assert.equal(results.filter((result) => result.allowed).length, 3);
    assert.equal(results.filter((result) => !result.allowed).length, 9);
  } finally { await peer.close(); await db.close(); }
});

test('actor/guild and quota classes have independent counters', async () => {
  const db = await openTestDb();
  try {
    for (let i = 0; i < 2; i++) assert.equal((await consumeQuota(db, 'ordinary', 'u1:g1', 2, 60_000, () => 300_000)).allowed, true);
    assert.equal((await consumeQuota(db, 'ordinary', 'u1:g1', 2, 60_000, () => 300_000)).allowed, false);
    assert.equal((await consumeQuota(db, 'ordinary', 'u2:g1', 2, 60_000, () => 300_000)).allowed, true);
    assert.equal((await consumeQuota(db, 'ordinary', 'u1:g2', 2, 60_000, () => 300_000)).allowed, true);
    assert.equal((await consumeQuota(db, 'expensive', 'u1:g1', 2, 60_000, () => 300_000)).allowed, true);
  } finally { await db.close(); }
});
