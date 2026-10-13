import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireSessionSecret } from './env.js';

test('session signing secret is explicit and at least 32 characters', () => {
  assert.throws(() => requireSessionSecret(''), /ADMIN_SESSION_SECRET/);
  assert.throws(() => requireSessionSecret('short'), /32 characters/);
  assert.equal(requireSessionSecret('x'.repeat(32)), 'x'.repeat(32));
});
