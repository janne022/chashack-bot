import type { Db } from '../../shared/db.js';

export interface EventAccessState {
  roleId: string;
  channels: Record<string, Record<string, { type: 0 | 1; before: boolean | null; managed: boolean | null }>>;
}
const key = (guildId: string, eventId: string) => `event_access:${guildId}:${eventId}`;
export async function getEventAccessState(db: Db, guildId: string, eventId: string): Promise<EventAccessState | null> {
  const row = await db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', key(guildId, eventId));
  return row ? JSON.parse(row.value) as EventAccessState : null;
}
export async function saveEventAccessState(db: Db, guildId: string, eventId: string, state: EventAccessState): Promise<void> {
  await db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key(guildId, eventId), JSON.stringify(state));
}

export async function clearEventAccessState(db: Db, guildId: string, eventId: string): Promise<void> {
  await db.run('DELETE FROM meta WHERE key = ?', key(guildId, eventId));
}
