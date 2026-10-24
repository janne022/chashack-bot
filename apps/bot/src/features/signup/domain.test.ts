import test from 'node:test';
import assert from 'node:assert/strict';
import { signupAdmission } from './domain.js';

test('signup admission uses a half-open window and keeps active edits available', () => {
  const window = { signupStartsAt: 100, signupEndsAt: 200 };
  assert.equal(signupAdmission(window, null, 99), 'signup_not_open');
  assert.equal(signupAdmission(window, null, 100), 'allowed');
  assert.equal(signupAdmission(window, 'withdrawn', 199), 'allowed');
  assert.equal(signupAdmission(window, null, 200), 'signup_closed');
  assert.equal(signupAdmission(window, 'active', 200), 'allowed');
  assert.equal(signupAdmission(window, 'active', 99), 'allowed');
});

test('an omitted boundary is unbounded', () => {
  assert.equal(signupAdmission({ signupStartsAt: null, signupEndsAt: 200 }, null, 1), 'allowed');
  assert.equal(signupAdmission({ signupStartsAt: 100, signupEndsAt: null }, null, 100), 'allowed');
});
