import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from './db.js';

test('PostgreSQL startup requires DATABASE_URL and never falls back', async () => {
  await assert.rejects(openDatabase('', undefined), /DATABASE_URL/);
  await assert.rejects(openDatabase('not a database', 'not a database'), /DATABASE_URL|connection string/);
  await assert.rejects(openDatabase(undefined, undefined), /DATABASE_URL/);
  await assert.rejects(openDatabase('postgresql://app@localhost/chashack_test', undefined), /MIGRATION_DATABASE_URL/);
});
