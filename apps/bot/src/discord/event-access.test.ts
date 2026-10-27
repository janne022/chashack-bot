import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField, PermissionFlagsBits, type Client } from 'discord.js';
import { openTestDb } from '../shared/test-db.js';
import { openPostgres } from '../shared/postgres.js';
import { getEvent } from '../features/events/data.js';
import { getEventAccessState } from '../features/events/access-data.js';
import { DEFAULT_FORM } from '../features/form/domain.js';
import { syncEventAccess } from './event-access.js';

test('event access grants at kickoff, revokes withdrawals, protects signup, and restores managed visibility', async () => {
  const db = await openTestDb();
  try {
    await db.run("INSERT INTO events (id,guild_id,name,status,starts_at,panel_channel_id,announcement_channel_id,schedule_channel_id,created_at,updated_at) VALUES ('access-event','guild','Build together','active',100,'signup','announcements','signup',1,1)");
    await db.run("INSERT INTO participants (event_id,user_id,guild_id,display_name,experience,role_track,skills,team_pref,teammates,status,created_at,updated_at) VALUES ('access-event','member','guild','Member','first_timer','frontend','[\"frontend_react\"]','random_team','[]','active',1,1)");
    const event = (await getEvent(db, 'access-event'))!;
    event.schedule = [{ id: 'activities', time: 100, title: 'Activities', actions: [{ id: 'publish', type: 'publish_schedule', channelId: 'itinerary' }, { id: 'signup', type: 'post_signup', channelId: 'signup-override' }] }];
    await db.run('UPDATE events SET schedule_json=? WHERE id=?', JSON.stringify(event.schedule), event.id);
    const overwrite = (id: string, type: 0 | 1, visible: boolean | null) => ({ id, type, allow: new PermissionsBitField(visible === true ? PermissionFlagsBits.ViewChannel : 0n), deny: new PermissionsBitField(visible === false ? PermissionFlagsBits.ViewChannel : 0n) });
    const cache = new Map([['guild', overwrite('guild', 0, true)], ['outsider-role', overwrite('outsider-role', 0, true)], ['outsider', overwrite('outsider', 1, true)]]);
    const announcements = { permissionOverwrites: { cache, edit: async (id: string, value: { ViewChannel: boolean | null }, options: { type: 0 | 1 }) => { cache.set(id, overwrite(id, options.type, value.ViewChannel)); } } };
    const itineraryCache = new Map([['guild', overwrite('guild', 0, true)]]);
    const itinerary = { permissionOverwrites: { cache: itineraryCache, edit: async (id: string, value: { ViewChannel: boolean | null }, options: { type: 0 | 1 }) => { itineraryCache.set(id, overwrite(id, options.type, value.ViewChannel)); } } };
    let signupTouched = false;
    const assigned = new Map<string, boolean>();
    const member = { id: 'member', roles: { cache: { has: (id: string) => assigned.has(id) }, add: async (id: string) => { assigned.set(id, true); }, remove: async (id: string) => { assigned.delete(id); } } };
    let role: { id: string; delete: () => Promise<void> } | null = null;
    const guild = {
      id: 'guild', members: { me: { id: 'bot' }, fetch: async () => new Map([['member', member]]) },
      roles: { fetch: async () => role, create: async () => role = { id: 'event-role', delete: async () => { role = null; } } },
      channels: { fetch: async (id: string) => { if (id === 'signup' || id === 'signup-override') signupTouched = true; return id === 'announcements' ? announcements : id === 'itinerary' ? itinerary : null; } },
    };
    const client = { guilds: { fetch: async () => guild } } as unknown as Client;
    const form = { ...DEFAULT_FORM, participantChannels: true };
    await db.run('INSERT INTO form_config (guild_id,json,updated_at) VALUES (?,?,?)', 'guild', JSON.stringify(form), 1);
    await syncEventAccess(db, client, 'guild', event.id, 99);
    assert.equal(signupTouched, false);
    assert.equal(cache.get('guild')!.deny.has(PermissionFlagsBits.ViewChannel), true);
    assert.equal(itineraryCache.get('guild')!.deny.has(PermissionFlagsBits.ViewChannel), true, 'action-specific schedule channel is protected');
    assert.equal(cache.get('outsider-role')!.allow.has(PermissionFlagsBits.ViewChannel), false);
    assert.equal(cache.get('outsider')!.allow.has(PermissionFlagsBits.ViewChannel), false);
    assert.equal(assigned.size, 0);
    await syncEventAccess(db, client, 'guild', event.id, 100);
    assert.equal(assigned.has('event-role'), true);
    await db.run("INSERT INTO events (id,guild_id,name,status,panel_channel_id,created_at,updated_at) VALUES ('other-event','guild','Other','active','announcements',1,1)");
    await syncEventAccess(db, client, 'guild', event.id, 100);
    assert.equal(cache.get('guild')!.allow.has(PermissionFlagsBits.ViewChannel), true, 'a newly shared signup channel is restored from the current event list');
    await db.run("UPDATE events SET panel_channel_id=NULL WHERE id='other-event'");
    await syncEventAccess(db, client, 'guild', event.id, 100);
    assert.equal(cache.get('guild')!.deny.has(PermissionFlagsBits.ViewChannel), true);
    await db.run("UPDATE participants SET status='withdrawn' WHERE event_id='access-event'");
    await syncEventAccess(db, client, 'guild', event.id, 101);
    assert.equal(assigned.size, 0);
    await db.run('UPDATE form_config SET json=? WHERE guild_id=?', JSON.stringify({ ...form, participantChannels: false }), 'guild');
    await syncEventAccess(db, client, 'guild', event.id, 102);
    assert.equal(cache.get('guild')!.allow.has(PermissionFlagsBits.ViewChannel), true);
    assert.equal(itineraryCache.get('guild')!.allow.has(PermissionFlagsBits.ViewChannel), true, 'action-specific channel permissions are restored');
    assert.equal(cache.get('outsider-role')!.allow.has(PermissionFlagsBits.ViewChannel), true);
    assert.equal(cache.get('outsider')!.allow.has(PermissionFlagsBits.ViewChannel), true);
    assert.equal(role, null);
    assert.equal(await getEventAccessState(db, 'guild', event.id), null);
  } finally { await db.close(); }
});

test('independent workers serialize access reconciliation and reload current settings', async () => {
  const db = await openTestDb(1);
  const schema = (await db.get<{ name: string }>('SELECT current_schema() AS name'))!.name;
  const peer = await openPostgres(process.env.DATABASE_URL!, schema, 1);
  let release!: () => void;
  try {
    await db.run("INSERT INTO events(id,guild_id,name,status,created_at,updated_at) VALUES ('access-concurrent','guild','Build','active',1,1)");
    await db.run('INSERT INTO form_config(guild_id,json,updated_at) VALUES (?,?,?)', 'guild', JSON.stringify({ ...DEFAULT_FORM, participantChannels: true }), 1);
    let started!: () => void;
    const creating = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    let creates = 0;
    let role: { id: string; delete: () => Promise<void> } | null = null;
    const guild = { id: 'guild', members: { me: { id: 'bot' }, fetch: async () => new Map() },
      roles: { fetch: async () => role, create: async () => { creates++; started(); await gate; return role = { id: 'event-role', delete: async () => { role = null; } }; } },
      channels: { fetch: async () => null } };
    const client = { guilds: { fetch: async () => guild } } as unknown as Client;
    const first = syncEventAccess(db, client, 'guild', 'access-concurrent', 100);
    try {
      await creating;
      await syncEventAccess(peer, client, 'guild', 'access-concurrent', 100);
      assert.equal(creates, 1);
      release();
      await first;
      await syncEventAccess(peer, client, 'guild', 'access-concurrent', 100);
      assert.equal(creates, 1, 'a later worker observes the persisted role');
      await db.run('UPDATE form_config SET json=? WHERE guild_id=?', JSON.stringify({ ...DEFAULT_FORM, participantChannels: false }), 'guild');
      await syncEventAccess(peer, client, 'guild', 'access-concurrent', 101);
      assert.equal(role, null, 'current settings disable access and remove the role');
      assert.equal(await getEventAccessState(db, 'guild', 'access-concurrent'), null);
      await db.run("UPDATE events SET status='draft' WHERE id='access-concurrent'");
      await db.run('UPDATE form_config SET json=? WHERE guild_id=?', JSON.stringify({ ...DEFAULT_FORM, participantChannels: true }), 'guild');
      await syncEventAccess(peer, client, 'guild', 'access-concurrent', 102);
      assert.equal(creates, 1, 'a draft event does not create a Discord role');
    } finally { release(); await first; }
  } finally { await peer.close(); await db.close(); }
});
