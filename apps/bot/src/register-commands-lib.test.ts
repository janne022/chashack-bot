import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registrationPlan } from './register-commands-lib.js';

test('commands go to every guild the bot serves, not just the configured one', () => {
  assert.deepEqual(registrationPlan(['561622936197398674', '999000000000000999']), {
    kind: 'guild',
    guildIds: ['561622936197398674', '999000000000000999'],
  });
});

test('the guild list is sorted so boot logs and diffs are stable', () => {
  assert.deepEqual(registrationPlan(['2', '10', '1']), { kind: 'guild', guildIds: ['1', '10', '2'] });
});

test('a single guild stays guild-scoped — instant propagation, not the 1h global wait', () => {
  assert.deepEqual(registrationPlan(['9']), { kind: 'guild', guildIds: ['9'] });
});

test('no guilds yet → global, so the command exists the moment the bot is invited', () => {
  assert.deepEqual(registrationPlan([]), { kind: 'global' });
});
