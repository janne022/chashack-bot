/**
 * Audit log: every mutation goes through here. Written to DB always;
 * optionally mirrored to a Discord channel by the caller.
 */
import type { Db } from './db.js';

export interface AuditEntry {
  id: number;
  ts: number;
  actor: string;
  action: string;
  target: string | null;
  details: string | null;
}

export async function audit(
  db: Db,
  actor: string,
  action: string,
  target: string | null,
  details: Record<string, unknown> | null,
  guildId: string | null = null,
): Promise<void> {
  await db.run(
    'INSERT INTO audit_log (ts, actor, action, target, details, guild_id) VALUES (?, ?, ?, ?, ?, ?)',
    Date.now(),
    actor,
    action,
    target,
    details === null ? null : JSON.stringify(details),
    guildId,
  );
}

export async function auditList(db: Db, limit: number, guildId: string): Promise<AuditEntry[]> {
  return db.all<AuditEntry>(
    'SELECT id, ts, actor, action, target, details FROM audit_log WHERE guild_id = ? ORDER BY ts DESC, id DESC LIMIT ?',
    guildId,
    Math.min(Math.max(limit, 1), 500),
  );
}
