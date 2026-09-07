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

export function audit(
  db: Db,
  actor: string,
  action: string,
  target: string | null,
  details: Record<string, unknown> | null,
): void {
  db.prepare(
    'INSERT INTO audit_log (ts, actor, action, target, details) VALUES (?, ?, ?, ?, ?)',
  ).run(Date.now(), actor, action, target, details === null ? null : JSON.stringify(details));
}

export function auditList(db: Db, limit: number): AuditEntry[] {
  return db
    .prepare('SELECT id, ts, actor, action, target, details FROM audit_log ORDER BY ts DESC, id DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 500)) as unknown as AuditEntry[];
}
