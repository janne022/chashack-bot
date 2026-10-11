import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ChatInputCommandInteraction } from 'discord.js';
import { DEFAULT_FORM } from '../features/form/domain.js';
import { openDb } from '../shared/db.js';
import { t } from '../shared/i18n.js';
import { handleUserCommand } from './user-commands.js';
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
