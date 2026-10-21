import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatInputCommandInteraction } from 'discord.js';
import { DEFAULT_FORM } from '../features/form/domain.js';
import { upsertParticipant } from '../features/signup/data.js';
import { createTeam } from '../features/teams/data.js';
import { openTestDb } from '../shared/test-db.js';
import { t } from '../shared/i18n.js';
import { handleUserCommand } from './user-commands.js';
import { onComponent, onModalSubmit } from './components.js';
import { IDS } from './shared.js';
import type { Ctx } from './shared.js';

function context(db: Awaited<ReturnType<typeof openTestDb>>): Ctx {
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
  const db = await openTestDb();
  const get = db.get.bind(db);
  db.get = async <T>(sql: string, ...params: unknown[]) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return get<T>(sql, ...params);
  };
  return db;
}

async function signedUpDb() {
  const db = await delayedMissingParticipantDb();
  await db.run("INSERT INTO events (id, guild_id, name, status, created_at, updated_at) VALUES ('event-1', 'guild-1', 'Test', 'active', 1, 1)");
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
  await db.close();
});

test('teammates waits for participant lookup and refuses missing signup', async () => {
  const db = await delayedMissingParticipantDb();
  const i = interaction();
  await handleUserCommand(i.value, context(db), 'teammates');
  assert.equal(i.modalShown(), false);
  assert.equal(i.replies.length, 1);
  assert.equal((i.replies[0] as { content?: string }).content, t('en', 'discord.teams.signup_first'));
  await db.close();
});

test('teams command awaits empty browser result and replies with the empty-state message', async () => {
  const db = await delayedMissingParticipantDb();
  const i = interaction();
  await handleUserCommand(i.value, context(db), 'teams');
  assert.equal(i.replies.length, 1);
  assert.equal((i.replies[0] as { content?: string }).content, t('en', 'discord.teams.none_open'));
  await db.close();
});

test('signed-up unattached user can open create-team modal', async () => {
  const db = await signedUpDb();
  const i = interaction();
  await handleUserCommand(i.value, context(db), 'create-team');
  assert.equal(i.modalShown(), true);
  assert.equal(i.replies.length, 0);
  await db.close();
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
  await db.close();
});

function componentInteraction() {
  const replies: unknown[] = [];
  let modalShown = false;
  const value = {
    customId: `${IDS.followCreateTeam}:event-1`,
    isButton: () => true,
    user: { id: 'user-1', username: 'tester' },
    reply: async (payload: unknown) => { replies.push(payload); },
    showModal: async () => { modalShown = true; },
  };
  return { value, replies, modalShown: () => modalShown };
}

test('create-team follow-up waits for signup and membership checks', async () => {
  const missingDb = await delayedMissingParticipantDb();
  await missingDb.run("INSERT INTO events (id, guild_id, name, status, created_at, updated_at) VALUES ('event-1', 'guild-1', 'Test', 'active', 1, 1)");
  const missing = componentInteraction();
  await onComponent(missing.value as never, { ...context(missingDb), announce: async () => undefined });
  assert.equal(missing.modalShown(), false);
  assert.equal((missing.replies[0] as { content?: string }).content, t('en', 'discord.teams.signup_first'));
  await missingDb.close();

  const db = await signedUpDb();
  const member = componentInteraction();
  await createTeam(db, 'test', 'event-1', 'guild-1', 'Existing', 'public', 'user-1');
  await onComponent(member.value as never, { ...context(db), announce: async () => undefined });
  assert.equal(member.modalShown(), false);
  assert.equal((member.replies[0] as { content?: string }).content, t('en', 'errors.already_in_team'));
  await db.close();
});

test('create-team refuses a signed-up user who already has team membership', async () => {
  const db = await signedUpDb();
  await createTeam(db, 'test', 'event-1', 'guild-1', 'Existing', 'public', 'user-1');
  const i = interaction();
  await handleUserCommand(i.value, context(db), 'create-team');
  assert.equal(i.modalShown(), false);
  assert.equal((i.replies[0] as { content?: string }).content, t('en', 'errors.already_in_team'));
  await db.close();
});

test('completed signup offers button-first create, browse and invitations actions', async () => {
  const db = await signedUpDb();
  const replies: unknown[] = [];
  const modal = {
    customId: 'hack:signup:event:event-1',
    user: { id: 'user-1', username: 'tester' },
    fields: {
      getTextInputValue: () => 'Tester',
      getStringSelectValues: (id: string) => id.endsWith('experience') ? ['veteran'] : id.endsWith('role') ? ['backend'] : id.endsWith('skills') ? ['backend_node'] : ['random_team'],
    },
    reply: async (payload: unknown) => { replies.push(payload); },
  };
  await onModalSubmit(modal as never, { ...context(db), announce: async () => undefined });
  const payload = replies[0] as { components?: { components?: { data?: { custom_id?: string } }[] }[] };
  assert.deepEqual(payload.components?.[0]?.components?.map((button) => button.data?.custom_id), [`${IDS.followCreateTeam}:event-1`, `${IDS.followBrowseTeams}:event-1`, `${IDS.followInvitations}:event-1`]);
  await db.close();
});

test('button-first invitations opens the current user request view without a slash command', async () => {
  const db = await signedUpDb();
  const interaction = componentInteraction();
  Object.defineProperty(interaction.value, 'customId', { value: `${IDS.followInvitations}:event-1` });
  await onComponent(interaction.value as never, { ...context(db), announce: async () => undefined });
  assert.equal(interaction.replies.length, 1);
  const reply = interaction.replies[0] as { embeds?: { data?: { title?: string; description?: string } }[] };
  assert.equal(reply.embeds?.[0]?.data?.title, t('en', 'discord.teams.pending_title'));
  assert.equal(reply.embeds?.[0]?.data?.description, t('en', 'discord.teams.nothing_pending'));
  await db.close();
});

test('incomplete custom-question signup links to the event web form instead of team actions', async () => {
  const db = await signedUpDb();
  const replies: unknown[] = [];
  const modal = {
    customId: 'hack:signup:event:event-1', user: { id: 'user-1', username: 'tester' },
    fields: {
      getTextInputValue: () => 'Tester',
      getStringSelectValues: (id: string) => id.endsWith('experience') ? ['veteran'] : id.endsWith('role') ? ['backend'] : id.endsWith('skills') ? ['backend_node'] : ['random_team'],
    },
    reply: async (payload: unknown) => { replies.push(payload); },
  };
  const config = { ...DEFAULT_FORM, customQuestions: [{ id: 'required-web', kind: 'text' as const, label: { en: 'Goal' }, help: { en: '' }, required: true, presentation: 'web' as const, visibility: 'self_and_organizer' as const }] };
  await db.run('UPDATE events SET form_json = ? WHERE id = ?', JSON.stringify(config), 'event-1');
  await onModalSubmit(modal as never, { ...context(db), config, webCompletionUrl: 'https://example.test/events/event-1/signup', announce: async () => undefined });
  const payload = replies[0] as { components?: { components?: { toJSON: () => { url?: string; custom_id?: string } }[] }[] };
  const button = payload.components?.[0]?.components?.[0] as { data?: { url?: string; custom_id?: string } } | undefined;
  assert.equal(button?.data?.url, 'https://example.test/events/event-1/signup');
  assert.equal(button?.data?.custom_id, undefined);
  await db.close();
});
