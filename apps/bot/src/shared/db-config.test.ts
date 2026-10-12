import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDatabaseUrl } from './db-config.js';

test('Postgres URL keeps optional password and non-default database', () => {
  assert.deepEqual(parseDatabaseUrl('postgresql://app@localhost:5433/chashack_test'), {
    host: 'localhost', port: 5433, user: 'app', password: undefined, database: 'chashack_test',
  });
});

test('Aspire ADO.NET connection strings parse required fields independent of order', () => {
  assert.deepEqual(parseDatabaseUrl('Host=localhost;Port=5433;Database=chashack_test;Username=app;Password=secret'), {
    host: 'localhost', port: 5433, user: 'app', password: 'secret', database: 'chashack_test',
  });
});

test('ambiguous or malformed database URL is rejected', () => {
  for (const value of [
    'not a URL',
    'postgres://u:***@host/db?host=other',
    'postgres://u:p@host/db?application_name=ok&application_name=evil',
    'postgres://u:p@host/db#fragment',
    'postgres://u:p@host/a/b',
    'postgres://u:p%ZZ@host/db',
    'Host=x;Server=y;Database=a;Username=u',
    'Host=x;Database=a;Database=b;Username=u',
  ]) {
    assert.throws(() => parseDatabaseUrl(value));
  }
});

test('invalid connection values never leak credentials in errors', () => {
  assert.throws(() => parseDatabaseUrl('postgres://app:secret@host/db#bad'), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.doesNotMatch(error.message, /secret/);
    return true;
  });
});

test('connection options cannot be silently ignored or override a parsed identity', () => {
  assert.deepEqual(parseDatabaseUrl('postgres://app@localhost/other?sslmode=verify-full').ssl, { rejectUnauthorized: true });
  assert.equal(parseDatabaseUrl('postgres://app@localhost/other?connect_timeout=10').connectionTimeoutMillis, 10000);
  for (const value of ['Host=x;Database=other;Username=app;SSLmode=disable', 'postgres://app@localhost/other?sslmode=unknown', 'postgres://app@localhost/a%2Fb', 'postgres://app@localhost/other?connect_timeout=oops']) assert.throws(() => parseDatabaseUrl(value));
});

test('ADO.NET passwords containing URL delimiters keep their original value', () => {
  assert.equal(parseDatabaseUrl('Host=localhost;Database=chashack_test;Username=app;Password=fake://value').password, 'fake://value');
});

test('database paths are validated before URL dot-segment normalization', () => {
  for (const path of ['other/../chashack_test', 'other/%2e%2e/chashack_test', './chashack_test', '%2e/chashack_test', '.', '%2e%2e', 'other%2F..%2Fchashack_test']) {
    assert.throws(() => parseDatabaseUrl(`postgresql://app@localhost/${path}`));
  }
  assert.equal(parseDatabaseUrl('postgresql://app@localhost/chashack%5Ftest').database, 'chashack_test');
});
