import test from 'node:test';
import assert from 'node:assert/strict';
import { assertDisposableDatabase } from './database-guard.js';

test('destructive fixtures accept only exact _test or _ci suffixes', () => {
  for (const name of ['chashack_test', 'chashack_ci']) assert.doesNotThrow(() => assertDisposableDatabase(name));
  for (const name of ['chashack_review_attestations', 'chashack_ci_backup', 'test', 'ci', 'production', 'chashack_test\n']) assert.throws(() => assertDisposableDatabase(name), /_test or _ci/);
});
