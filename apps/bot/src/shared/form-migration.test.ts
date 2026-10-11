import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { openDb } from './db.js';

function pathFor(tag: string): string { return `/tmp/chashack-test-form-migration-${tag}-${process.pid}.db`; }
function clean(file: string): void {
  for (const path of [file, `${file}-wal`, `${file}-shm`]) try { fs.unlinkSync(path); } catch { /* ignore */ }
}
function seedLegacy(file: string, guilds: string[]): void {
  const db = openDb(file);
  for (const [index, guildId] of guilds.entries()) {
    db.prepare('INSERT INTO events (id, guild_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(`event-${index}`, guildId, `event ${index}`, 'draft', 1, 1);
  }
  db.exec('DROP TABLE form_config; CREATE TABLE form_config (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, updated_at INTEGER NOT NULL)');
  db.prepare('INSERT INTO form_config VALUES (1, ?, 1)').run('{"title":"legacy sentinel"}');
  db.close();
}

test('legacy default form migrates once to its sole provable guild', () => {
  const file = pathFor('single'); clean(file);
  try {
    seedLegacy(file, ['11111111111111111']);
    let db = openDb(file);
    assert.deepEqual(db.prepare('SELECT guild_id, json FROM form_config').all().map((row) => ({ ...row })), [{ guild_id: '11111111111111111', json: '{"title":"legacy sentinel"}' }]);
    db.close();
    db = openDb(file);
    assert.equal((db.prepare('SELECT count(*) AS count FROM form_config').get() as { count: number }).count, 1);
    db.close();
  } finally { clean(file); }
});

test('ambiguous legacy form migration refuses and preserves its original bytes', () => {
  const file = pathFor('ambiguous'); clean(file);
  try {
    seedLegacy(file, ['11111111111111111', '22222222222222222']);
    assert.throws(() => openDb(file), /ownership is ambiguous.*manually assign/i);
    const raw = new DatabaseSync(file);
    assert.equal((raw.prepare('SELECT json FROM form_config WHERE id = 1').get() as { json: string }).json, '{"title":"legacy sentinel"}');
    raw.close();
  } finally { clean(file); }
});
