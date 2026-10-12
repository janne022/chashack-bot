import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDisposableDatabase } from './database-guard.js';
import { openTestDb } from './test-db.js';

test('destructive fixtures accept only exact _test or _ci suffixes', () => {
  for (const name of ['chashack_test', 'chashack_ci']) assert.doesNotThrow(() => assertDisposableDatabase(name));
  for (const name of ['chashack_review_attestations', 'chashack_ci_backup', 'test', 'ci', 'production', 'chashack_test\n']) assert.throws(() => assertDisposableDatabase(name), /_test or _ci/);
});

test('fixture refuses near-miss databases before connecting to an unreachable server', async () => {
  const original = process.env.DATABASE_URL;
  try {
    for (const name of ['chashack_review_attestations', 'chashack_ci_backup']) {
      process.env.DATABASE_URL = `postgresql://postgres@127.0.0.1:1/${name}`;
      await assert.rejects(openTestDb(), /_test or _ci/);
    }
  } finally {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  }
});
