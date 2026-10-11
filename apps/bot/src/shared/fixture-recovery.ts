import type { Db, SqliteDb } from './db.js';

/** Fake rehearsal only: callers must use the guarded openTestDb destination. */
export async function recoverFakeFixture(source: SqliteDb, target: Db): Promise<void> {
  if ((await source.get("SELECT value FROM meta WHERE key = 'fake_fixture'"))?.value !== 'true') throw new Error('Recovery requires an explicitly marked fake fixture');
  const tables = ['meta', 'events', 'guild_settings', 'event_templates', 'teams', 'participants', 'team_requests', 'audit_log', 'web_sessions'];
  await target.transaction(async () => {
    for (const table of tables) {
      if ((await target.get(`SELECT count(*) AS count FROM ${table}`))?.count !== 0) throw new Error('Recovery requires an empty destination');
    }
    for (const table of tables) {
      for (const row of await source.all(`SELECT * FROM ${table}`)) {
        const columns = Object.keys(row).map(key => `"${key}"`).join(',');
        await target.run(`INSERT INTO ${table} (${columns}) VALUES (${Object.keys(row).map(() => '?').join(',')})`, ...Object.values(row));
      }
    }
    if ('dialect' in target && target.dialect === 'postgres') {
      for (const table of ['team_requests', 'audit_log']) {
        await target.get(`SELECT setval(pg_get_serial_sequence(?, 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM ${table}`, table);
      }
    }
  });
}
