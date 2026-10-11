import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDatabase } from './db.js';

test('DATABASE_URL takes precedence and invalid values fail startup rather than falling back', async () => {
  await assert.rejects(openDatabase(':memory:', ''), /DATABASE_URL/);
  await assert.rejects(openDatabase(':memory:', 'not a database'), /DATABASE_URL|connection string/);
  const sqlite = await openDatabase(':memory:');
  try { assert.equal((await sqlite.get<{ n: number }>('SELECT 1 AS n'))?.n, 1); }
  finally { await sqlite.close(); }
});
