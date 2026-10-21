import { newId, type Db } from '../../shared/db.js';

export interface ImportedSignup {
  id: string;
  eventId: string;
  sourceRow: number;
  sourceTimestamp: string;
  formVersion: number;
  values: Record<string, string>;
  answers: Record<string, string | string[]>;
  discordUsername: string | null;
  discordUserId: string | null;
  state: 'incomplete' | 'unlinked' | 'linked';
  missingFields: string[];
}

interface Row {
  id: string; event_id: string; source_row: number; source_timestamp: string; form_version: number;
  values_json: string; answers_json: string; discord_username: string | null; discord_user_id: string | null;
}

function decode(row: Row, required: string[] = []): ImportedSignup {
  const values = JSON.parse(row.values_json) as Record<string, string>;
  const answers = JSON.parse(row.answers_json) as Record<string, string | string[]>;
  const missingFields = required.filter((key) => {
    const value = answers[key];
    return value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
  });
  return {
    id: row.id, eventId: row.event_id, sourceRow: row.source_row, sourceTimestamp: row.source_timestamp, formVersion: row.form_version,
    values, answers, discordUsername: row.discord_username, discordUserId: row.discord_user_id,
    state: missingFields.length ? 'incomplete' : row.discord_user_id === null ? 'unlinked' : 'linked', missingFields,
  };
}

export async function listImportedSignups(db: Db, eventId: string, required: string[] = []): Promise<ImportedSignup[]> {
  const rows = await db.all<Row>('SELECT id,event_id,source_row,source_timestamp,form_version,values_json,answers_json,discord_username,discord_user_id FROM imported_signups WHERE event_id=? ORDER BY source_row,id', eventId);
  return rows.map((row) => decode(row, required));
}

export async function purgeImportedSignups(db: Db, eventId: string): Promise<number> {
  return Number((await db.run('DELETE FROM imported_signups WHERE event_id=?', eventId)).changes);
}

export async function summarizeImportedRows(db: Db, eventId: string, rows: { values: Record<string, string>; answers: Record<string, string | string[]> }[]): Promise<{ create: number; duplicate: number; conflict: number; statuses: ('create' | 'duplicate' | 'conflict')[] }> {
  const records = await db.all<{ values_json: string; answers_json: string }>('SELECT values_json,answers_json FROM imported_signups WHERE event_id=?', eventId);
  const byEmail = new Map(records.map((row) => {
    const values = JSON.parse(row.values_json) as Record<string, string>;
    return [(values.email ?? '').trim().toLocaleLowerCase('en-US'), row] as const;
  }).filter(([email]) => email !== ''));
  const seen = new Map<string, { values: Record<string, string>; answers: Record<string, string | string[]> }>();
  let create = 0; let duplicate = 0; let conflict = 0;
  const statuses = rows.map((row) => {
    const email = (row.values.email ?? '').trim().toLocaleLowerCase('en-US');
    if (!email) { create++; return 'create' as const; }
    const previous = seen.get(email);
    const existing = byEmail.get(email);
    const candidate = previous ?? (existing ? { values: JSON.parse(existing.values_json) as Record<string, string>, answers: JSON.parse(existing.answers_json) as Record<string, string | string[]> } : undefined);
    if (!candidate) { create++; seen.set(email, row); return 'create' as const; }
    const same = JSON.stringify(candidate.values) === JSON.stringify(row.values) && JSON.stringify(candidate.answers) === JSON.stringify(row.answers);
    if (same) duplicate++; else conflict++;
    if (previous === undefined) seen.set(email, candidate);
    return same ? 'duplicate' as const : 'conflict' as const;
  });
  return { create, duplicate, conflict, statuses };
}

export async function createImportedSignups(db: Db, eventId: string, guildId: string, formVersion: number, rows: { sourceRow: number; sourceTimestamp?: string; values: Record<string, string>; answers: Record<string, string | string[]> }[]): Promise<{ saved: number; skipped: number; conflicts: number; rows: { sourceRow: number; id?: string; status: 'saved' | 'duplicate' | 'conflict' }[] }> {
  return db.transaction(async () => {
    const event = await db.get<{ id: string; guild_id: string; status: string }>('SELECT id,guild_id,status FROM events WHERE id=? FOR UPDATE', eventId);
    if (!event || event.guild_id !== guildId || event.status === 'ended') throw new Error('event_unavailable');
    let saved = 0;
    let skipped = 0;
    let conflicts = 0;
    const results: { sourceRow: number; id?: string; status: 'saved' | 'duplicate' | 'conflict' }[] = [];
    for (const input of rows) {
      const email = (input.values.email ?? '').trim().toLocaleLowerCase('en-US');
      const existing = await db.get<Row>(`SELECT id,event_id,source_row,source_timestamp,form_version,values_json,answers_json,discord_username,discord_user_id
        FROM imported_signups WHERE event_id=? AND ? <> '' AND lower(values_json::jsonb->>'email')=? LIMIT 1`,
      eventId, email, email);
      if (existing) {
        const exact = existing.values_json === JSON.stringify(input.values) && existing.answers_json === JSON.stringify(input.answers);
        if (exact) skipped++; else conflicts++;
        results.push({ sourceRow: input.sourceRow, id: existing.id, status: exact ? 'duplicate' : 'conflict' });
        continue;
      }
      const id = newId('imp');
      await db.run(`INSERT INTO imported_signups (id,event_id,guild_id,source_row,source_timestamp,form_version,values_json,answers_json,discord_username,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`, id, eventId, guildId, input.sourceRow, input.sourceTimestamp ?? '', formVersion, JSON.stringify(input.values), JSON.stringify(input.answers), input.values.discordUsername?.trim() || null, Date.now(), Date.now());
      saved++;
      results.push({ sourceRow: input.sourceRow, id, status: 'saved' });
    }
    return { saved, skipped, conflicts, rows: results };
  });
}

export async function editImportedSignup(db: Db, eventId: string, id: string, edit: { values?: Record<string, string>; answers?: Record<string, string | string[]>; discordUsername?: string | null; formVersion?: number }): Promise<ImportedSignup | null> {
  return db.transaction(async () => {
    const row = await db.get<Row>('SELECT id,event_id,source_row,source_timestamp,form_version,values_json,answers_json,discord_username,discord_user_id FROM imported_signups WHERE id=? AND event_id=? FOR UPDATE', id, eventId);
    if (!row) return null;
    const values = { ...JSON.parse(row.values_json) as Record<string, string>, ...edit.values };
    const answers = { ...JSON.parse(row.answers_json) as Record<string, string | string[]>, ...edit.answers };
    const sourceTimestamp = values.sourceTimestamp ?? row.source_timestamp;
    await db.run('UPDATE imported_signups SET values_json=?,answers_json=?,source_timestamp=?,discord_username=?,form_version=?,updated_at=? WHERE id=? AND event_id=?',
      JSON.stringify(values), JSON.stringify(answers), sourceTimestamp, edit.discordUsername === undefined ? row.discord_username : edit.discordUsername?.trim() || null, edit.formVersion ?? row.form_version, Date.now(), id, eventId);
    return decode({ ...row, source_timestamp: sourceTimestamp, form_version: edit.formVersion ?? row.form_version, values_json: JSON.stringify(values), answers_json: JSON.stringify(answers), discord_username: edit.discordUsername === undefined ? row.discord_username : edit.discordUsername?.trim() || null });
  });
}
