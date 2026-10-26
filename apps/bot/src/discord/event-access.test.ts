import test from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField, PermissionFlagsBits, type Client } from 'discord.js';
import { openTestDb } from '../shared/test-db.js';
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
    const overwrite = (id: string, type: 0 | 1, visible: boolean | null) => ({ id, type, allow: new PermissionsBitField(visible === true ? PermissionFlagsBits.ViewChannel : 0n), deny: new PermissionsBitField(visible === false ? PermissionFlagsBits.ViewChannel : 0n) });
    const cache = new Map([['guild', overwrite('guild', 0, true)], ['outsider-role', overwrite('outsider-role', 0, true)], ['outsider', overwrite('outsider', 1, true)]]);
    const announcements = { permissionOverwrites: { cache, edit: async (id: string, value: { ViewChannel: boolean | null }, options: { type: 0 | 1 }) => { cache.set(id, overwrite(id, options.type, value.ViewChannel)); } } };
    let signupTouched = false;
    const assigned = new Map<string, boolean>();
    const member = { id: 'member', roles: { cache: { has: (id: string) => assigned.has(id) }, add: async (id: string) => { assigned.set(id, true); }, remove: async (id: string) => { assigned.delete(id); } } };
    let role: { id: string; delete: () => Promise<void> } | null = null;
    const guild = {
      id: 'guild', members: { me: { id: 'bot' }, fetch: async () => new Map([['member', member]]) },
      roles: { fetch: async () => role, create: async () => role = { id: 'event-role', delete: async () => { role = null; } } },
      channels: { fetch: async (id: string) => { if (id === 'signup') signupTouched = true; return id === 'announcements' ? announcements : null; } },
    };
    const client = { guilds: { fetch: async () => guild } } as unknown as Client;
    const form = { ...DEFAULT_FORM, participantChannels: true };
    await syncEventAccess(db, client, event, form, [event], 99);
    assert.equal(signupTouched, false);
    assert.equal(cache.get('guild')!.deny.has(PermissionFlagsBits.ViewChannel), true);
    assert.equal(cache.get('outsider-role')!.allow.has(PermissionFlagsBits.ViewChannel), false);
    assert.equal(cache.get('outsider')!.allow.has(PermissionFlagsBits.ViewChannel), false);
    assert.equal(assigned.size, 0);
    await syncEventAccess(db, client, event, form, [event], 100);
    assert.equal(assigned.has('event-role'), true);
    await db.run("UPDATE participants SET status='withdrawn' WHERE event_id='access-event'");
    await syncEventAccess(db, client, event, form, [event], 101);
    assert.equal(assigned.size, 0);
    await syncEventAccess(db, client, event, { ...form, participantChannels: false }, [event], 102);
    assert.equal(cache.get('guild')!.allow.has(PermissionFlagsBits.ViewChannel), true);
    assert.equal(cache.get('outsider-role')!.allow.has(PermissionFlagsBits.ViewChannel), true);
    assert.equal(cache.get('outsider')!.allow.has(PermissionFlagsBits.ViewChannel), true);
    assert.equal(role, null);
    assert.equal(await getEventAccessState(db, 'guild', event.id), null);
  } finally { await db.close(); }
});
