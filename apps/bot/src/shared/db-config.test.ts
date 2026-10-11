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
  for (const value of ['not a URL', 'postgres://u:p@host/db?host=other', 'Host=x;Database=a;Database=b;Username=u']) {
    assert.throws(() => parseDatabaseUrl(value));
  }
});
