import assert from 'node:assert/strict';
import { test } from 'node:test';
import { env, resetEnvCache, requireSessionSecret } from './env.js';

test('session signing secret is explicit and at least 32 characters', () => {
  assert.throws(() => requireSessionSecret(''), /ADMIN_SESSION_SECRET/);
  assert.throws(() => requireSessionSecret('short'), /32 characters/);
  assert.equal(requireSessionSecret('x'.repeat(32)), 'x'.repeat(32));
});

test('production origin and OAuth callback configuration fail closed', () => {
  const keys = ['NODE_ENV', 'RUN_DRY', 'ADMIN_SESSION_SECRET', 'PUBLIC_URL', 'OAUTH_REDIRECT_URI', 'TRUSTED_PROXIES'];
  const previous = keys.map(key => [key, process.env[key]] as const);
  try {
    process.env.NODE_ENV = 'production'; process.env.RUN_DRY = '1';
    process.env.ADMIN_SESSION_SECRET = 'synthetic-test-secret-with-32-characters'; // g0:allow:secrets t_33947af2 - synthetic fixture signing material only
    for (const [origin, callback] of [
      ['', ''], ['http://console.example.test', ''],
      ['https://user:password@console.example.test', ''],
      ['https://console.example.test/path', ''],
      ['https://console.example.test', 'https://foreign.example.test/auth/discord/callback'],
      ['https://console.example.test', 'https://console.example.test/api/auth/callback'],
      ['https://console.example.test', 'https://console.example.test/auth/discord/callback?secret=bad'],
    ]) {
      process.env.PUBLIC_URL = origin; process.env.OAUTH_REDIRECT_URI = callback; resetEnvCache();
      assert.throws(() => env(), /PUBLIC_URL|HTTPS|OAuth|OAUTH_REDIRECT_URI/);
    }
    process.env.PUBLIC_URL = 'https://console.example.test';
    process.env.OAUTH_REDIRECT_URI = 'https://console.example.test/auth/discord/callback';
    process.env.TRUSTED_PROXIES = '172.28.42.2/32'; resetEnvCache();
    assert.deepEqual(env().trustedProxies, ['172.28.42.2/32']);
  } finally {
    for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    resetEnvCache();
  }
});
