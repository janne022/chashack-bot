import assert from 'node:assert/strict';
import test from 'node:test';
import { isAdminMemberWithRoles, registerInteractionHandlers } from './dispatch.js';

const guildMember = (permissions: bigint, roles: string[] = []) => ({
  permissions: { bitfield: permissions, has: (flag: string) => flag === 'Administrator' && (permissions & 8n) !== 0n },
  roles: { cache: new Map(roles.map((id) => [id, {}])) },
});

function interaction(member: unknown, userId = 'organizer') {
  return {
    user: { id: userId }, guildId: 'guild',
    inGuild: () => true,
    member,
    memberPermissions: { has: (flag: bigint) => (member as ReturnType<typeof guildMember>).permissions.bitfield & flag ? true : false },
  } as never;
}

function dependencies(currentMember: unknown, guildAvailable = true) {
  const client = {
    guilds: {
      fetch: async (id: string) => {
        assert.equal(id, 'guild');
        if (!guildAvailable) throw new Error('bot is no longer in guild');
        return { id, ownerId: 'owner', members: { fetch: async (userId: string) => {
          if (!['organizer', 'owner'].includes(userId) || currentMember === null) throw new Error('not a current member');
          return currentMember;
        } } };
      },
    },
  } as never;
  const db = { get: async () => ({ mod_role_ids: '["trusted"]' }) } as never;
  return { client, db };
}

test('Discord organizer authority requires fresh guild owner, Administrator, or delegated role', async () => {
  const current = dependencies(guildMember(32n, ['trusted']));
  const manageOnly = dependencies(guildMember(32n));
  assert.equal(await isAdminMemberWithRoles(interaction(guildMember(0n)), manageOnly.db, manageOnly.client), false);
  assert.equal(await isAdminMemberWithRoles(interaction(guildMember(32n, ['trusted'])), current.db, current.client), true);
  assert.equal(await isAdminMemberWithRoles(interaction(guildMember(8n)), current.db, current.client), true);
  assert.equal(await isAdminMemberWithRoles(interaction(guildMember(0n), 'owner'), current.db, current.client), true);
  const noAuthority = dependencies(guildMember(0n));
  assert.equal(await isAdminMemberWithRoles(interaction(guildMember(0n)), noAuthority.db, noAuthority.client), false);
  assert.equal(await isAdminMemberWithRoles(interaction(guildMember(0n, ['trusted'])), noAuthority.db, noAuthority.client), false);
  const departed = dependencies(null);
  assert.equal(await isAdminMemberWithRoles(interaction(guildMember(0n)), departed.db, departed.client), false);
  const absentBot = dependencies(guildMember(8n), false);
  assert.equal(await isAdminMemberWithRoles(interaction(guildMember(8n)), absentBot.db, absentBot.client), false);
});

test('dispatch rejects a departed member before reading tenant data', async () => {
  let handler: ((interaction: unknown) => void) | undefined;
  let reads = 0;
  let response: unknown;
  let finish!: () => void;
  const replied = new Promise<void>((resolve) => { finish = resolve; });
  const db = { get: async () => { reads += 1; throw new Error('unexpected tenant read'); } } as never;
  const client = {
    on: (_event: string, callback: (interaction: unknown) => void) => { handler = callback; },
    guilds: { fetch: async () => ({ id: 'guild', members: { fetch: async () => { throw new Error('member departed'); } } }), cache: new Map() },
  } as never;
  registerInteractionHandlers(client, { db, adminIds: ['organizer'], client, teamCategoryId: undefined, botLanguage: 'en', announce: async () => undefined });
  const submitted = {
    user: { id: 'organizer' }, guildId: 'guild', inGuild: () => true,
    isAutocomplete: () => false, isChatInputCommand: () => true, isModalSubmit: () => false,
    isButton: () => false, isStringSelectMenu: () => false, isRepliable: () => true,
    replied: false, deferred: false,
    reply: async (value: unknown) => { response = value; finish(); },
    options: { getSubcommandGroup: () => 'admin', getSubcommand: () => 'event-create' },
    commandName: 'hackathon-admin',
  };
  handler!(submitted);
  await replied;
  assert.equal(reads, 0);
  assert.deepEqual(response, { content: 'That control is stale — run the command again.', flags: 64 });
});

test('dispatch denies a current ManageGuild-only organizer before provisioning', async () => {
  const handlers = new Map<string, (interaction: unknown) => void>();
  let organizerWrites = 0;
  let response: unknown;
  let finish!: () => void;
  const replied = new Promise<void>((resolve) => { finish = resolve; });
  const db = {
    get: async (sql: string) => sql.includes('mod_role_ids') ? { mod_role_ids: '[]' } : undefined,
    run: async (sql: string) => { if (sql.includes('INSERT INTO events')) organizerWrites += 1; },
    all: async () => [],
  } as never;
  const currentMember = guildMember(32n);
  const guild = {
    id: 'guild', ownerId: 'owner',
    members: { fetch: async (id: string) => id === 'organizer' ? currentMember : (() => { throw new Error('unexpected member lookup'); })() },
  };
  const client = {
    on: (name: string, callback: (interaction: unknown) => void) => handlers.set(name, callback),
    guilds: { fetch: async () => guild, cache: new Map([['guild', guild]]) },
  } as never;
  registerInteractionHandlers(client, { db, adminIds: ['organizer'], client, teamCategoryId: undefined, botLanguage: 'en', announce: async () => undefined });
  const submitted = {
    user: { id: 'organizer' }, guildId: 'guild', inGuild: () => true,
    isAutocomplete: () => false, isChatInputCommand: () => true, isModalSubmit: () => false,
    isButton: () => false, isStringSelectMenu: () => false, isRepliable: () => true,
    replied: false, deferred: false,
    reply: async (value: unknown) => { response = value; finish(); },
    options: { getSubcommandGroup: () => 'admin', getSubcommand: () => 'event-create' },
    commandName: 'hackathon-admin',
  };
  handlers.get('interactionCreate')!(submitted);
  await replied;
  assert.equal(organizerWrites, 0);
  assert.deepEqual(response, { content: 'Organizer only — you need **Manage Server** or be in ADMIN_IDS.', flags: 64 });
});
