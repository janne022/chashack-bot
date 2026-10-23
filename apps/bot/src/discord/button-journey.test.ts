import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import Fastify from 'fastify';
import type { Env } from '../shared/env.js';
import { createSession } from '../features/auth/data.js';
import { makeDiscordToken } from '../features/auth/domain.js';
import { registerRoutes } from '../adminweb/routes.js';
import { DEFAULT_FORM } from '../features/form/domain.js';
import { getMessageRef } from '../features/events/data.js';
import { adminAssign, createTeam, getTeam, getTeamForUser, type Team } from '../features/teams/data.js';
import { openTestDb } from '../shared/test-db.js';
import { openPostgres } from '../shared/postgres.js';
import { setMembershipLookup } from '../features/signup/eligibility.js';
import { registerInteractionHandlers } from './dispatch.js';
import { provisionTeamSpace } from './provision.js';
import { refreshTeamPanel } from './team-panel.js';
import { IDS } from './shared.js';
import { t } from '../shared/i18n.js';

const GUILD = '11111111111111111';
const OTHER = '22222222222222222';
const OWNER = '33333333333333333';
const JOINER = '44444444444444444';
const INVITEE = '55555555555555555';
const EXTRA = '66666666666666666';
type Payload = { content?: string; embeds?: { title?: string; description?: string }[]; components?: { component?: { type: number }; components: { custom_id?: string; label?: string; url?: string; options?: { value: string }[] }[] }[]; custom_id?: string };
const plain = (value: unknown): Payload => JSON.parse(JSON.stringify(value)) as Payload;
const control = (payload: Payload, index = 0) => payload.components![0]!.components[index]!.custom_id!;

// Real PostgreSQL + actual registered router; Discord transport/membership are mocked.
async function fixture(locale: 'en' | 'sv' = 'en', appRole = false) {
  const db = await openTestDb();
  const role = `journey_${randomUUID().replaceAll('-', '')}`;
  let restricted: Awaited<ReturnType<typeof openPostgres>> | undefined;
  let roleCreated = false;
  const members = new Set([OWNER, JOINER, INVITEE, EXTRA]);
  const messages = new Map<string, { id: string; author: { id: string }; pinned: boolean; payload: Payload; edit: (value: unknown) => Promise<void>; pin: () => Promise<void> }>();
  const dms: { user: string; payload: Payload }[] = [];
  const edits: Payload[] = [];
  let sends = 0;
  let pinDenied = false;
  let transportDown = false;
  let handler!: (interaction: unknown) => void;
  let sequence = 0;
  const channel = {
    id: 'text', isTextBased: () => true,
    messages: { fetch: async (id: string) => { const message = messages.get(id); if (!message) throw new Error('Unknown Message'); return message; } },
    send: async (value: unknown) => {
      const payload = plain(value);
      const id = `message-${++sequence}`;
      const message = { id, author: { id: 'bot' }, pinned: false, payload,
        edit: async (next: unknown) => { message.payload = plain(next); edits.push(message.payload); },
        pin: async () => { if (pinDenied) throw new Error('Missing Permissions'); message.pinned = true; },
      };
      if (payload.components?.length) { sends += 1; messages.set(id, message); }
      return message;
    },
  };
  const member = { permissions: { bitfield: 0n }, roles: { cache: new Map<string, unknown>(), add: async () => undefined, remove: async () => undefined } };
  const guild = (id: string) => ({ id, ownerId: 'organizer', members: { me: { id: 'bot' }, fetch: async (input?: string | { user: string }) => {
    if (!input) return new Map();
    if (!members.has(typeof input === 'string' ? input : input.user)) throw new Error('departed');
    return member;
  } }, roles: { everyone: { id }, create: async () => ({ id: 'role' }), fetch: async () => ({ setColor: async () => undefined, setName: async () => undefined }) },
  channels: { create: async (value: { type: number }) => ({ id: value.type === 0 ? 'text' : 'voice' }), fetch: async () => { if (transportDown) throw new Error('Discord unavailable'); return channel; } } });
  const guilds = new Map([[GUILD, guild(GUILD)], [OTHER, guild(OTHER)]]);
  const client = { user: { id: 'bot' }, on: (_name: string, callback: typeof handler) => { handler = callback; },
    guilds: { cache: guilds, fetch: async (id: string) => guilds.get(id)! },
    users: { fetch: async (user: string) => ({ send: async (value: unknown) => { dms.push({ user, payload: plain(value) }); throw new Error('DMs closed'); } }) },
  };
  for (const [id, guildId, created] of [['old', GUILD, 1], ['new', GUILD, 2], ['foreign', OTHER, 3]] as const) {
    await db.run('INSERT INTO events (id,guild_id,name,status,form_json,created_at,updated_at) VALUES (?,?,?,\'active\',?,?,1)', id, guildId, id, JSON.stringify({ ...DEFAULT_FORM, teamSize: 3 }), created);
  }
  if (appRole) {
    const schema = (await db.get<{ name: string }>('SELECT current_schema() AS name'))!.name;
    const password = randomUUID();
    await db.run(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOBYPASSRLS`);
    roleCreated = true;
    await db.run(`GRANT USAGE ON SCHEMA ${schema} TO ${role}`);
    await db.run(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${role}`);
    await db.run(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${schema} TO ${role}`);
    const url = new URL(process.env.DATABASE_URL!);
    url.username = role; url.password = password;
    restricted = await openPostgres(url.toString(), schema, 2);
    assert.equal((await restricted.get<{ name: string }>('SELECT current_user AS name'))!.name, role);
    assert.deepEqual(await restricted.all('SELECT * FROM events'), []);
  }
  const routerDb = restricted ?? db;
  setMembershipLookup(routerDb, async (_guild, user) => members.has(user));
  registerInteractionHandlers(client as never, { db: routerDb, adminIds: [], client: client as never, teamCategoryId: undefined, botLanguage: locale, publicUrl: 'https://example.test', announce: async () => undefined });
  async function dispatch(user: string, customId: string, kind = 'button', extra: Record<string, unknown> = {}) {
    let finish!: (value: { kind: string; data: Payload }) => void;
    const ready = new Promise<{ kind: string; data: Payload }>((resolve) => { finish = resolve; });
    const interaction = { user: { id: user, username: user }, guildId: GUILD, channelId: 'text', message: { id: 'origin' }, customId,
      inGuild: () => true, isAutocomplete: () => false, isChatInputCommand: () => kind === 'command', isModalSubmit: () => kind === 'modal', isButton: () => kind === 'button', isStringSelectMenu: () => kind === 'select', isRepliable: () => true, replied: false, deferred: false,
      reply: async (value: unknown) => finish({ kind: 'reply', data: plain(value) }), update: async (value: unknown) => finish({ kind: 'update', data: plain(value) }), showModal: async (value: unknown) => finish({ kind: 'modal', data: plain(value) }), fetchReply: async () => ({ id: 'ephemeral' }), ...extra };
    handler(interaction);
    return ready;
  }
  const signup = async (user: string, event = 'old') => dispatch(user, `hack:signup:event:${event}`, 'modal', { fields: {
    getTextInputValue: () => user, getStringSelectValues: (id: string) => id.endsWith('experience') ? ['veteran'] : id.endsWith('role') ? ['backend'] : id.endsWith('skills') ? ['backend_node'] : ['random_team'],
  } });
  const deps = { db, client: client as never, categoryIdFor: () => undefined };
  const panel = async (team: Team) => {
    const ref = await getMessageRef(db, `team_panel:${team.id}`);
    assert.ok(ref);
    return { ref, message: messages.get(ref.messageId)! };
  };
  return { db, client, deps, members, dms, edits, messages, dispatch, signup, panel,
    sends: () => sends, pinDenied: () => { pinDenied = true; }, transportDown: () => { transportDown = true; },
    close: async () => { await restricted?.close(); if (roleCreated) { const schema = (await db.get<{ name: string }>('SELECT current_schema() AS name'))!.name; await db.run(`DROP OWNED BY ${role}`); await db.run(`REVOKE ALL ON SCHEMA ${schema} FROM ${role}`); await db.run(`DROP ROLE ${role}`); } await db.close(); },
  };
}

for (const locale of ['en', 'sv'] as const) test(`button journey ${locale}: signup/create/browse/join/invite/respond/leave through actual app-role dispatch`, { timeout: 30000 }, async () => {
  const f = await fixture(locale, true);
  try {
    const entry = await f.dispatch(OWNER, 'hack:panel:old:signup');
    assert.equal(entry.kind, 'modal');
    assert.equal(entry.data.custom_id, 'hack:signup:event:old');
    const registered = await f.signup(OWNER);
    assert.equal(registered.data.components![0]!.components[0]!.label, t(locale, 'discord.join.actions_create'));
    const beforeForeign = await f.db.all('SELECT * FROM audit_log ORDER BY id');
    assert.equal((await f.dispatch(OWNER, 'hack:panel:foreign:signup')).kind, 'reply');
    assert.equal((await f.dispatch(OWNER, 'hack:panel:old:signup', 'button', { guildId: OTHER })).kind, 'reply');
    assert.deepEqual(await f.db.all('SELECT * FROM audit_log ORDER BY id'), beforeForeign);
    const create = await f.dispatch(OWNER, control(registered.data));
    assert.equal(create.kind, 'modal');
    await f.dispatch(OWNER, create.data.custom_id!, 'modal', { fields: { getTextInputValue: () => 'Alpha', getStringSelectValues: (id: string) => id.endsWith('kind') ? ['public'] : [] } });
    const team = await getTeamForUser(f.db, 'old', OWNER);
    assert.ok(team);
    assert.equal(await getTeamForUser(f.db, 'new', OWNER), null);
    const { ref, message } = await f.panel(team);
    assert.equal(message.pinned, true);
    assert.equal(f.sends(), 1);
    assert.match(JSON.stringify(message.payload), /Alpha/);
    const empty = await f.dispatch(OWNER, control(message.payload, 2), 'button', { message: { id: ref.messageId } });
    assert.equal(empty.data.content, t(locale, 'discord.teams.nothing_pending'));
    const joiner = await f.signup(JOINER);
    const browse = await f.dispatch(JOINER, control(joiner.data, 1));
    assert.equal(browse.data.components![0]!.components[0]!.options![0]!.value, team.id);
    const beforeRequest = f.edits.length;
    const requested = await f.dispatch(JOINER, control(browse.data), 'select', { values: [team.id] });
    assert.ok(f.edits.length > beforeRequest, 'committed browser request refreshes panel');
    assert.ok(JSON.stringify(requested.data).includes(t(locale, 'discord.teams.request_saved_body')), 'DM closed fallback');
    assert.equal(await getTeamForUser(f.db, 'old', JOINER), null, 'public browser still requires owner approval');
    const pending = await f.dispatch(OWNER, control(message.payload, 2), 'button', { message: { id: ref.messageId } });
    const accepted = await f.dispatch(OWNER, control(pending.data));
    assert.ok(JSON.stringify(accepted.data).includes('Alpha'));
    assert.equal((await getTeamForUser(f.db, 'old', JOINER))?.id, team.id);
    await f.signup(INVITEE);
    const invite = await f.dispatch(OWNER, control(message.payload), 'button', { message: { id: ref.messageId } });
    assert.equal(invite.kind, 'modal');
    assert.equal(invite.data.components![0]!.component!.type, 5);
    const invited = await f.dispatch(OWNER, invite.data.custom_id!, 'modal', { fields: { getSelectedUsers: () => ({ first: () => ({ id: INVITEE }) }) } });
    assert.equal(invited.data.content, t(locale, 'discord.teams.invite_saved_body', { name: INVITEE }));
    const inbox = await f.dispatch(INVITEE, `${IDS.followInvitations}:old`);
    const beforeWrongUser = await f.db.all('SELECT * FROM audit_log ORDER BY id');
    await f.dispatch(EXTRA, control(inbox.data));
    assert.deepEqual(await f.db.all('SELECT * FROM audit_log ORDER BY id'), beforeWrongUser);
    await f.dispatch(INVITEE, control(inbox.data), 'button', { inGuild: () => false });
    assert.equal((await getTeamForUser(f.db, 'old', INVITEE))?.id, team.id);
    const beforeReplay = f.edits.length;
    await f.dispatch(INVITEE, control(inbox.data), 'button', { inGuild: () => false });
    assert.equal(f.edits.length, beforeReplay);
    const leave = await f.dispatch(JOINER, control(message.payload, 3), 'button', { message: { id: ref.messageId } });
    const confirm = control(leave.data);
    await f.dispatch(JOINER, confirm, 'button', { message: { id: 'copied' } });
    assert.ok(await getTeamForUser(f.db, 'old', JOINER));
    await f.dispatch(INVITEE, confirm, 'button', { message: { id: 'ephemeral' } });
    assert.ok(await getTeamForUser(f.db, 'old', JOINER));
    await f.dispatch(JOINER, confirm, 'button', { message: { id: 'ephemeral' } });
    assert.equal(await getTeamForUser(f.db, 'old', JOINER), null);
    await f.dispatch(JOINER, confirm, 'button', { message: { id: 'ephemeral' } });
    assert.equal(f.sends(), 1);
    assert.doesNotMatch(JSON.stringify(message.payload), new RegExp(`<@${JOINER}>`));
    assert.match(JSON.stringify(message.payload), new RegExp(`<@${INVITEE}>`));
    assert.deepEqual(await f.db.all("SELECT * FROM participants WHERE event_id IN ('new','foreign')"), []);
    const fallback = await f.dispatch(EXTRA, '', 'command', { commandName: 'hackathon', options: { getSubcommandGroup: () => null, getSubcommand: () => 'teams' } });
    assert.equal(fallback.data.content, t(locale, 'discord.teams.none_open'), 'command uses newest event, not old controls');
  } finally { await f.close(); }
});

test('non-current signup completion links to its originating event, not newest event', { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    const config = { ...DEFAULT_FORM, customQuestions: [{ id: 'goal', kind: 'text', label: { en: 'Goal' }, help: { en: '' }, required: true, presentation: 'web', visibility: 'self_and_organizer' }] };
    await f.db.run('UPDATE events SET form_json=? WHERE id=?', JSON.stringify(config), 'old');
    const result = await f.signup(OWNER);
    assert.equal(result.data.components![0]!.components[0]!.url, 'https://example.test/events/old/signup');
  } finally { await f.close(); }
});

for (const state of ['demoted', 'removed', 'departed', 'matched', 'blocked', 'incomplete', 'copied', 'foreign', 'ended'] as const) test(`actual panel dispatch rejects ${state} controls without domain or transport effects`, { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    await f.signup(OWNER); await f.signup(JOINER);
    const created = await createTeam(f.db, 'test', 'old', GUILD, 'Alpha', 'public', OWNER);
    assert.ok(created.ok);
    const team = await provisionTeamSpace(f.deps, created.value);
    const { ref } = await f.panel(team);
    const id = `hack:team-panel:old:${team.id}:settings`;
    const modal = await f.dispatch(OWNER, id, 'button', { message: { id: ref.messageId } });
    assert.equal(modal.kind, 'modal');
    if (state === 'demoted') await f.db.run('UPDATE teams SET owner_id=? WHERE id=?', JOINER, team.id);
    if (state === 'removed') await f.db.run('UPDATE participants SET team_id=NULL WHERE event_id=? AND user_id=?', 'old', OWNER);
    if (state === 'departed') f.members.delete(OWNER);
    if (state === 'matched') await f.db.run('UPDATE teams SET kind=? WHERE id=?', 'matched', team.id);
    if (state === 'ended') await f.db.run('UPDATE events SET status=? WHERE id=?', 'ended', 'old');
    if (state === 'blocked') await f.db.run('UPDATE participants SET status=? WHERE event_id=? AND user_id=?', 'blocked', 'old', OWNER);
    if (state === 'incomplete') await f.db.run('UPDATE events SET form_json=? WHERE id=?', JSON.stringify({ ...DEFAULT_FORM, customQuestions: [{ id: 'goal', kind: 'text', label: { en: 'Goal' }, help: { en: '' }, required: true, presentation: 'web', visibility: 'self_and_organizer' }] }), 'old');
    const before = await f.db.all('SELECT * FROM audit_log ORDER BY id');
    const edits = f.edits.length;
    const extra = { message: { id: state === 'copied' ? 'copy' : ref.messageId }, ...(state === 'foreign' ? { guildId: OTHER } : {}) };
    const button = await f.dispatch(OWNER, id, 'button', extra);
    assert.notEqual(button.kind, 'modal', JSON.stringify(button));
    if (state !== 'copied') {
      await f.dispatch(OWNER, modal.data.custom_id!, 'modal', { ...extra, fields: { getTextInputValue: () => 'Unauthorized rename', getStringSelectValues: () => ['public'] } });
    }
    assert.equal((await getTeam(f.db, team.id))?.name, 'Alpha');
    assert.deepEqual(await f.db.all('SELECT * FROM audit_log ORDER BY id'), before);
    assert.equal(f.edits.length, edits);
    assert.deepEqual(f.dms, []);
  } finally { await f.close(); }
});

test('repeated provisioning edits one panel, recovers deletion and tolerates denied pin/refresh after commit', { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    await f.signup(OWNER); await f.signup(JOINER);
    const created = await createTeam(f.db, 'test', 'old', GUILD, 'Alpha', 'public', OWNER);
    assert.ok(created.ok);
    let team = await provisionTeamSpace(f.deps, created.value);
    team = await provisionTeamSpace(f.deps, team);
    assert.equal(f.sends(), 1);
    assert.equal(f.edits.length, 1);
    const first = await f.panel(team);
    f.messages.delete(first.ref.messageId);
    f.pinDenied();
    await refreshTeamPanel(f.deps, team);
    const recovered = await f.panel(team);
    assert.notEqual(recovered.ref.messageId, first.ref.messageId);
    assert.equal(recovered.message.pinned, false);
    assert.equal(recovered.message.payload.components![0]!.components.length, 4);
    assert.ok(JSON.stringify(recovered.message.payload).includes(t('en', 'discord.team_panel.unpinned_hint')));
    await refreshTeamPanel(f.deps, team);
    assert.equal(f.sends(), 2);
    f.transportDown();
    assert.ok((await adminAssign(f.db, 'test', 'old', JOINER, team.id, 3)).ok);
    await refreshTeamPanel(f.deps, team);
    assert.equal((await getTeamForUser(f.db, 'old', JOINER))?.id, team.id);
  } finally { await f.close(); }
});

test('concurrent actual request acceptance preserves capacity and rejects full/replayed joins', { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    for (const user of [OWNER, JOINER, INVITEE, EXTRA]) await f.signup(user);
    await f.db.run('UPDATE events SET form_json=? WHERE id=?', JSON.stringify({ ...DEFAULT_FORM, teamSize: 2 }), 'old');
    const created = await createTeam(f.db, 'test', 'old', GUILD, 'Alpha', 'public', OWNER);
    assert.ok(created.ok);
    const team = await provisionTeamSpace(f.deps, created.value);
    for (const user of [JOINER, INVITEE]) await f.dispatch(user, `${IDS.teamsSelect}:old`, 'select', { values: [team.id] });
    const { ref, message } = await f.panel(team);
    const pending = await f.dispatch(OWNER, control(message.payload, 2), 'button', { message: { id: ref.messageId } });
    const ids = pending.data.components!.map((row) => row.components[0]!.custom_id!);
    assert.equal(ids.length, 2);
    await Promise.all(ids.map((id) => f.dispatch(OWNER, id, 'button', { inGuild: () => false })));
    assert.equal((await f.db.all('SELECT * FROM participants WHERE team_id=?', team.id)).length, 2);
    assert.equal((await f.db.all("SELECT * FROM team_requests WHERE status='accepted'")).length, 1);
    const before = await f.db.all('SELECT * FROM audit_log ORDER BY id');
    const edits = f.edits.length;
    await f.dispatch(EXTRA, `${IDS.teamsSelect}:old`, 'select', { values: [team.id] });
    await Promise.all(ids.map((id) => f.dispatch(OWNER, id, 'button', { inGuild: () => false })));
    assert.deepEqual(await f.db.all('SELECT * FROM audit_log ORDER BY id'), before);
    assert.equal(f.edits.length, edits);
  } finally { await f.close(); }
});

test('cancel consumes leave confirmation; replaced panel invalidates confirmation but preserves current controls', { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    await f.signup(OWNER); await f.signup(JOINER);
    const created = await createTeam(f.db, 'test', 'old', GUILD, 'Alpha', 'public', OWNER);
    assert.ok(created.ok);
    const team = await provisionTeamSpace(f.deps, created.value);
    assert.ok((await adminAssign(f.db, 'test', 'old', JOINER, team.id, 3)).ok);
    const first = await f.panel(team);
    const clickLeave = () => f.dispatch(JOINER, control(first.message.payload, 3), 'button', { message: { id: first.ref.messageId } });
    const cancelled = await clickLeave();
    await f.dispatch(JOINER, control(cancelled.data, 1), 'button', { message: { id: 'ephemeral' } });
    await f.dispatch(JOINER, control(cancelled.data), 'button', { message: { id: 'ephemeral' } });
    assert.ok(await getTeamForUser(f.db, 'old', JOINER));
    const stale = await clickLeave();
    f.messages.delete(first.ref.messageId);
    await refreshTeamPanel(f.deps, team);
    await f.dispatch(JOINER, control(stale.data), 'button', { message: { id: 'ephemeral' } });
    assert.ok(await getTeamForUser(f.db, 'old', JOINER));
    const replacement = await f.panel(team);
    const current = await f.dispatch(OWNER, control(replacement.message.payload, 2), 'button', { message: { id: replacement.ref.messageId } });
    assert.equal(current.data.content, t('en', 'discord.teams.nothing_pending'));
  } finally { await f.close(); }
});

test('slash invite fallback refreshes committed request and survives Discord refresh/DM failure', { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    await f.signup(OWNER, 'new'); await f.signup(INVITEE, 'new'); await f.signup(EXTRA, 'new');
    const created = await createTeam(f.db, 'test', 'new', GUILD, 'Alpha', 'public', OWNER);
    assert.ok(created.ok);
    await provisionTeamSpace(f.deps, created.value);
    const command = (target: string) => f.dispatch(OWNER, '', 'command', { commandName: 'hackathon', options: { getSubcommandGroup: () => null, getSubcommand: () => 'invite', getUser: () => ({ id: target, username: target, bot: false }) } });
    const before = f.edits.length;
    await command(INVITEE);
    assert.ok(f.edits.length > before);
    f.transportDown();
    const fallback = await command(EXTRA);
    assert.ok(JSON.stringify(fallback.data).includes(t('en', 'discord.teams.invite_saved_title')));
    assert.equal((await f.db.all("SELECT * FROM team_requests WHERE event_id='new' AND status='pending'")).length, 2);
  } finally { await f.close(); }
});

test('participant HTTP and organizer reassignment/settings refresh old-event committed panels, including failure', { timeout: 15000 }, async () => {
  const f = await fixture();
  const app = Fastify();
  try {
    for (const user of [OWNER, JOINER, INVITEE, EXTRA]) await f.signup(user);
    f.members.add('organizer');
    const key = 'button-journey-http-signing-key-32-characters';
    registerRoutes(app, { db: f.db, config: { adminSessionSecret: key, adminIds: [], botLanguage: 'en', skipDiscord: false } as unknown as Env, client: f.client as never, announce: async () => undefined });
    const cookies = new Map<string, string>();
    for (const user of [OWNER, JOINER, INVITEE, EXTRA]) {
      const session = await createSession(f.db, { userId: user, username: user, avatar: null, guilds: [], audience: 'participant' });
      cookies.set(user, `hackpartsess=${encodeURIComponent(makeDiscordToken(key, session.id, Date.now(), 'participant'))}`);
    }
    const organizer = await createSession(f.db, { userId: 'organizer', username: 'Organizer', avatar: null, guilds: [{ id: GUILD, name: 'Guild', icon: null }] });
    cookies.set('organizer', `hacksess=${encodeURIComponent(makeDiscordToken(key, organizer.id))}`);
    const call = async (user: string, method: 'POST' | 'DELETE', url: string, payload?: object) => {
      const result = await app.inject({ method, url, headers: { cookie: cookies.get(user)! }, ...(payload ? { payload } : {}) });
      assert.equal(result.statusCode, 200, result.body);
      return result.json();
    };
    const base = '/api/participant/events/old'; // g0:allow:secrets t_4da6d35d — public HTTP route path, not a credential.
    const created = await call(OWNER, 'POST', `${base}/teams`, { name: 'Alpha', kind: 'public' });
    const team = (await getTeam(f.db, created.team.id))!;
    assert.equal(f.sends(), 1);
    let before = f.edits.length;
    await call(JOINER, 'POST', `${base}/teams/${team.id}/join`);
    assert.ok(f.edits.length > before);
    before = f.edits.length;
    const invite = await call(OWNER, 'POST', `${base}/teams/${team.id}/invites`, { targetId: INVITEE });
    assert.ok(f.edits.length > before);
    before = f.edits.length;
    await call(INVITEE, 'POST', `${base}/invitations/${invite.request.id}/respond`, { decision: 'accept' });
    assert.ok(f.edits.length > before);
    before = f.edits.length;
    await call(JOINER, 'DELETE', `${base}/team`);
    assert.ok(f.edits.length > before);
    before = f.edits.length;
    await call('organizer', 'POST', `/api/participants/${EXTRA}/team`, { eventId: 'old', teamId: team.id });
    assert.ok(f.edits.length > before);
    const current = await f.panel(team);
    assert.match(JSON.stringify(current.message.payload), new RegExp(`<@${EXTRA}>`));
    assert.doesNotMatch(JSON.stringify(current.message.payload), new RegExp(`<@${JOINER}>`));
    await call('organizer', 'POST', `/api/teams/${team.id}/settings`, { name: 'Renamed' });
    assert.match(JSON.stringify(current.message.payload), /Renamed/);
    f.transportDown();
    await call('organizer', 'POST', `/api/participants/${EXTRA}/team`, { eventId: 'old', teamId: null });
    assert.equal(await getTeamForUser(f.db, 'old', EXTRA), null);
    assert.equal(f.sends(), 1);
    assert.deepEqual(await f.db.all("SELECT * FROM participants WHERE event_id='new'"), []);
  } finally { await app.close(); await f.close(); }
});

test('manual matching HTTP provisions live panels in selected non-current event', { timeout: 15000 }, async () => {
  const f = await fixture();
  const app = Fastify();
  try {
    for (const user of [OWNER, JOINER, INVITEE]) await f.signup(user);
    f.members.add('organizer');
    const key = 'button-matching-http-signing-key-32-characters';
    registerRoutes(app, { db: f.db, config: { adminSessionSecret: key, adminIds: [], botLanguage: 'en', skipDiscord: false } as unknown as Env, client: f.client as never, announce: async () => undefined });
    const session = await createSession(f.db, { userId: 'organizer', username: 'Organizer', avatar: null, guilds: [{ id: GUILD, name: 'Guild', icon: null }] });
    const headers = { cookie: `hacksess=${encodeURIComponent(makeDiscordToken(key, session.id))}` };
    const preview = await app.inject({ method: 'POST', url: '/api/match/preview', headers, payload: { eventId: 'old' } });
    assert.equal(preview.statusCode, 200, preview.body);
    const commit = await app.inject({ method: 'POST', url: '/api/match/commit', headers, payload: { eventId: 'old', revision: preview.json().result.revision } });
    assert.equal(commit.statusCode, 200, commit.body);
    const teams = await f.db.all<{ id: string }>("SELECT id FROM teams WHERE event_id='old'");
    assert.ok(teams.length > 0);
    assert.equal(f.sends(), teams.length);
    for (const row of teams) {
      const team = (await getTeam(f.db, row.id))!;
      const panel = await f.panel(team);
      assert.equal(panel.message.pinned, true);
      assert.ok(JSON.stringify(panel.message.payload).includes(t('en', 'discord.team_panel.matched')));
    }
    assert.deepEqual(await f.db.all("SELECT * FROM teams WHERE event_id='new'"), []);
  } finally { await app.close(); await f.close(); }
});

test('organizer move select refreshes both committed source and destination rosters', { timeout: 10000 }, async () => {
  const f = await fixture();
  try {
    for (const user of [OWNER, JOINER, INVITEE]) await f.signup(user, 'new');
    f.members.add('organizer');
    const source = await createTeam(f.db, 'test', 'new', GUILD, 'Source', 'public', OWNER);
    const target = await createTeam(f.db, 'test', 'new', GUILD, 'Target', 'public', JOINER);
    assert.ok(source.ok && target.ok);
    assert.ok((await adminAssign(f.db, 'test', 'new', INVITEE, source.value.id, 3)).ok);
    const sourceTeam = await provisionTeamSpace(f.deps, source.value);
    const targetTeam = await provisionTeamSpace(f.deps, target.value);
    await f.dispatch('organizer', `${IDS.adminMoveSelect}:${INVITEE}`, 'select', { values: [targetTeam.id] });
    assert.equal((await getTeamForUser(f.db, 'new', INVITEE))?.id, targetTeam.id);
    assert.doesNotMatch(JSON.stringify((await f.panel(sourceTeam)).message.payload), new RegExp(`<@${INVITEE}>`));
    assert.match(JSON.stringify((await f.panel(targetTeam)).message.payload), new RegExp(`<@${INVITEE}>`));
  } finally { await f.close(); }
});
