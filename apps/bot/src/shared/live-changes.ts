import { Client, type ClientConfig } from 'pg';
import { AsyncResource } from 'node:async_hooks';
import type { Db } from './db.js';

export type ChangeHint = { schema: string; table: string; guildId: string | null; eventId: string | null; userId: string | null; teamId: string | null; targetId: string | null; requesterId: string | null; publicTeam?: boolean };
const sources = new WeakMap<Db, { config: ClientConfig; schema: string; client?: Client; pending?: Promise<void>; subscribers: Set<{ hint: (hint: ChangeHint) => void; failed: () => void }> }>();

export function registerChangeSource(db: Db, config: ClientConfig, schema: string): void {
  sources.set(db, { config, schema, subscribers: new Set() });
}

/** One lazy LISTEN connection shared by every stream on the application handle. */
export async function subscribeChanges(db: Db, hint: (hint: ChangeHint) => void, failed: () => void): Promise<() => void> {
  const source = sources.get(db);
  if (!source) throw new Error('Live updates unavailable');
  const subscriber = { hint: AsyncResource.bind(hint), failed: AsyncResource.bind(failed) };
  source.subscribers.add(subscriber);
  const unsubscribe = () => {
    source.subscribers.delete(subscriber);
    if (source.subscribers.size === 0 && source.client) {
      const client = source.client;
      delete source.client;
      void client.end().catch(() => undefined);
    }
  };
  if (!source.client && !source.pending) {
    source.pending = (async () => {
      const client = new Client(source.config);
      const fail = () => {
        if (source.client !== client) return;
        delete source.client;
        for (const sub of [...source.subscribers]) sub.failed();
        void client.end().catch(() => undefined);
      };
      client.on('error', fail);
      client.on('end', fail);
      client.on('notification', message => {
        if (message.channel !== 'chashack_changes' || !message.payload) return;
        try {
          const value = JSON.parse(message.payload) as ChangeHint;
          if (value.schema === source.schema) for (const sub of source.subscribers) sub.hint(value);
        } catch { /* Never forward malformed or foreign notifications. */ }
      });
      source.client = client;
      try { await client.connect(); await client.query('LISTEN chashack_changes'); }
      catch (error) { fail(); throw error; }
      finally { delete source.pending; }
    })();
  }
  try { await source.pending; } catch (error) { unsubscribe(); throw error; }
  return unsubscribe;
}

export async function closeChangeSource(db: Db): Promise<void> {
  const source = sources.get(db);
  if (!source) return;
  for (const sub of [...source.subscribers]) sub.failed();
  source.subscribers.clear();
  await source.pending?.catch(() => undefined);
  const client = source.client;
  delete source.client;
  await client?.end().catch(() => undefined);
  sources.delete(db);
}

/** Triggers see every writer (Discord, HTTP, matching and maintenance). PostgreSQL
 * delivers NOTIFY only at commit, including correct savepoint rollback semantics.
 * The function is SECURITY INVOKER: it cannot bypass the application's RLS. */
export async function migrateLiveChanges(db: Db): Promise<void> {
  await db.run(`CREATE OR REPLACE FUNCTION notify_live_change() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE row_data jsonb; guild text; event text;
    BEGIN
      FOR row_data IN SELECT value FROM jsonb_array_elements(
        CASE WHEN TG_OP = 'INSERT' THEN jsonb_build_array(to_jsonb(NEW))
             WHEN TG_OP = 'DELETE' THEN jsonb_build_array(to_jsonb(OLD))
             ELSE jsonb_build_array(to_jsonb(OLD), to_jsonb(NEW)) END)
      LOOP
        event := CASE WHEN TG_TABLE_NAME = 'events' THEN row_data->>'id' ELSE row_data->>'event_id' END;
        guild := row_data->>'guild_id';
        IF guild IS NULL AND event IS NOT NULL THEN
          SELECT guild_id INTO guild FROM events WHERE id = event;
        END IF;
        PERFORM pg_notify('chashack_changes', jsonb_build_object(
          'schema', TG_TABLE_SCHEMA, 'table', TG_TABLE_NAME, 'guildId', guild, 'eventId', event,
          'userId', row_data->>'user_id',
          'teamId', CASE WHEN TG_TABLE_NAME = 'teams' THEN row_data->>'id' ELSE row_data->>'team_id' END,
          'requesterId', row_data->>'requester_id', 'targetId', row_data->>'target_id')::text);
        IF TG_TABLE_NAME = 'teams' AND row_data->>'kind' = 'public' THEN
          PERFORM pg_notify('chashack_changes', jsonb_build_object(
            'schema', TG_TABLE_SCHEMA, 'table', TG_TABLE_NAME, 'guildId', guild, 'eventId', event,
            'userId', NULL, 'teamId', row_data->>'id', 'targetId', NULL, 'requesterId', NULL, 'publicTeam', true)::text);
        END IF;
      END LOOP;
      RETURN NULL;
    END $$`);
  for (const table of ['events', 'participants', 'teams', 'team_requests', 'registration_answers', 'guild_settings', 'form_config', 'event_templates']) {
    await db.run(`DROP TRIGGER IF EXISTS live_change ON ${table}`);
    await db.run(`CREATE TRIGGER live_change AFTER INSERT OR UPDATE OR DELETE ON ${table} FOR EACH ROW EXECUTE FUNCTION notify_live_change()`);
  }
}
