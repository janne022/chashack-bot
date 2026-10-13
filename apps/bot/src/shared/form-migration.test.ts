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
  db.exec('ALTER TABLE form_config RENAME TO form_config_current; CREATE TABLE form_config (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL, updated_at INTEGER NOT NULL)');
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

test('legacy host templates do not count as tenant ownership evidence', () => {
  const file = pathFor('host-template'); clean(file);
  try {
    seedLegacy(file, []);
    const raw = new DatabaseSync(file);
    raw.prepare('INSERT INTO event_templates (id, guild_id, name, kind, json, created_at) VALUES (?, NULL, ?, ?, ?, ?)').run('host-template', 'Host', 'event', '{}', 1);
    raw.prepare('INSERT INTO guild_settings (guild_id, updated_at) VALUES (?, ?)').run('11111111111111111', 1);
    raw.close();
    const db = openDb(file);
    assert.equal((db.prepare('SELECT guild_id FROM form_config').get() as { guild_id: string }).guild_id, '11111111111111111');
    db.close();
  } finally { clean(file); }
});

test('host templates alone cannot prove ownership of a legacy default form', () => {
  const file = pathFor('host-only'); clean(file);
  try {
    seedLegacy(file, []);
    const raw = new DatabaseSync(file);
    raw.prepare('INSERT INTO event_templates (id, guild_id, name, kind, json, created_at) VALUES (?, NULL, ?, ?, ?, ?)').run('host-template', 'Host', 'event', '{}', 1);
    raw.close();
    assert.throws(() => openDb(file), /ownership is ambiguous.*manually assign/i);
    const preserved = new DatabaseSync(file);
    assert.equal((preserved.prepare('SELECT json FROM form_config WHERE id = 1').get() as { json: string }).json, '{"title":"legacy sentinel"}');
    assert.equal((preserved.prepare('SELECT guild_id FROM event_templates WHERE id = ?').get('host-template') as { guild_id: string | null }).guild_id, null);
    preserved.close();
  } finally { clean(file); }
});
