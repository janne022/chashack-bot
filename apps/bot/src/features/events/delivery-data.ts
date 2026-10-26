import type { Db } from '../../shared/db.js';

export interface DeliveryRecord {
  fingerprint: string;
  channelId?: string;
  messageId?: string;
  assignmentId?: string;
  legacy?: boolean;
  legacyActionKeys?: string[];
}
export async function getDelivery(db: Db, key: string): Promise<DeliveryRecord | null> {
  const row = await db.get<{ value: string }>('SELECT value FROM meta WHERE key = ?', 'delivery:' + key);
  return row ? JSON.parse(row.value) as DeliveryRecord : null;
}
export async function saveDelivery(db: Db, key: string, record: DeliveryRecord): Promise<void> {
  await db.run('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', 'delivery:' + key, JSON.stringify(record));
}
