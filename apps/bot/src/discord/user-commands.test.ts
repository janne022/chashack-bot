import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatInputCommandInteraction } from 'discord.js';
import { DEFAULT_FORM } from '../features/form/domain.js';
import { upsertParticipant } from '../features/signup/data.js';
import { createTeam } from '../features/teams/data.js';
import { openDb } from '../shared/db.js';
import { t } from '../shared/i18n.js';
import { handleUserCommand } from './user-commands.js';
import { onComponent } from './components.js';
import { IDS } from './shared.js';
import type { Ctx } from './shared.js';

function context(db: ReturnType<typeof openDb>): Ctx {
  return {
    db,
    config: DEFAULT_FORM,
    botLocale: 'en',
    eventId: 'event-1',
    eventName: 'Test',
    hasActiveEvent: true,
    guildId: 'guild-1',
    actor: 'test',
    isAdmin: false,
    client: {} as Ctx['client'],
    categoryIdFor: () => undefined,
    dm: async () => false,
  };
}

function interaction() {
  const replies: unknown[] = [];
  let modalShown = false;
  const value = {
    user: { id: 'user-1', username: 'tester' },
    reply: async (payload: unknown) => { replies.push(payload); },
    showModal: async () => { modalShown = true; },
  } as unknown as ChatInputCommandInteraction;
  return { value, replies, modalShown: () => modalShown };
}

async function delayedMissingParticipantDb() {
  const db = openDb(':memory:');
  const get = db.get.bind(db);
  db.get = async <T>(sql: string, ...params: unknown[]) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return get<T>(sql, ...params);
  };
  return db;
}

async function signedUpDb() {
  const db = await delayedMissingParticipantDb();
  db.prepare("INSERT INTO events (id, guild_id, name, status, created_at, updated_at) VALUES ('event-1', 'guild-1', 'Test', 'active', 1, 1)").run();
  await upsertParticipant(db, 'test', 'event-1', 'guild-1', 'user-1', {
    displayName: 'Tester', experience: 'veteran', roleTrack: 'backend', skills: ['backend_node'], teamPref: 'create_team',
  });
  return db;
}

test('create-team waits for participant lookup and refuses missing signup', async () => {
  const db = await delayedMissingParticipantDb();
  const i = interaction();
  await handleUserCommand(i.value, context(db), 'create-team');
  assert.equal(i.modalShown(), false);
  assert.equal(i.replies.length, 1);
  assert.equal((i.replies[0] as { content?: string }).content, t('en', 'discord.teams.signup_first'));
  db.close();
});

test('teammates waits for participant lookup and refuses missing signup', async () => {
  const db = await delayedMissingParticipantDb();
  const i = interaction();
  await handleUserCommand(i.value, context(db), 'teammates');
  assert.equal(i.modalShown(), false);
  assert.equal(i.replies.length, 1);
  assert.equal((i.replies[0] as { content?: string }).content, t('en', 'discord.teams.signup_first'));
  db.close();
});

test('teams command awaits empty browser result and replies with the empty-state message', async () => {
  const db = await delayedMissingParticipantDb();
  const i = interaction();
  await handleUserCommand(i.value, context(db), 'teams');
  assert.equal(i.replies.length, 1);
  assert.equal((i.replies[0] as { content?: string }).content, t('en', 'discord.teams.none_open'));
  db.close();
});

test('signed-up unattached user can open create-team modal', async () => {
  const db = await signedUpDb();
  const i = interaction();
  await handleUserCommand(i.value, context(db), 'create-team');
  assert.equal(i.modalShown(), true);
  assert.equal(i.replies.length, 0);
  db.close();
});

test('teams command renders a nonempty browser after delayed lookups', async () => {
  const db = await signedUpDb();
  await createTeam(db, 'test', 'event-1', 'guild-1', 'Open Team', 'public', 'user-1');
  const i = interaction();
  await handleUserCommand(i.value, context(db), 'teams');
  assert.equal(i.replies.length, 1);
  const reply = i.replies[0] as { embeds?: unknown[]; components?: unknown[] };
  assert.equal(reply.embeds?.length, 1);
  assert.equal(reply.components?.length, 1);
  db.close();
});

function componentInteraction() {
  const replies: unknown[] = [];
  let modalShown = false;
  const value = {
    customId: IDS.followCreateTeam,
    user: { id: 'user-1', username: 'tester' },
    reply: async (payload: unknown) => { replies.push(payload); },
    showModal: async () => { modalShown = true; },
  };
  return { value, replies, modalShown: () => modalShown };
}

test('create-team follow-up waits for signup and membership checks', async () => {
  const missingDb = await delayedMissingParticipantDb();
  const missing = componentInteraction();
  await onComponent(missing.value as never, { ...context(missingDb), announce: async () => undefined });
  assert.equal(missing.modalShown(), false);
  assert.equal((missing.replies[0] as { content?: string }).content, t('en', 'discord.teams.signup_first'));
  missingDb.close();

  const db = await signedUpDb();
  const member = componentInteraction();
  await createTeam(db, 'test', 'event-1', 'guild-1', 'Existing', 'public', 'user-1');
  await onComponent(member.value as never, { ...context(db), announce: async () => undefined });
  assert.equal(member.modalShown(), false);
  assert.equal((member.replies[0] as { content?: string }).content, t('en', 'errors.already_in_team'));
  db.close();
});

test('create-team refuses a signed-up user who already has team membership', async () => {
  const db = await signedUpDb();
  await createTeam(db, 'test', 'event-1', 'guild-1', 'Existing', 'public', 'user-1');
  const i = interaction();
  await handleUserCommand(i.value, context(db), 'create-team');
  assert.equal(i.modalShown(), false);
  assert.equal((i.replies[0] as { content?: string }).content, t('en', 'errors.already_in_team'));
  db.close();
});
