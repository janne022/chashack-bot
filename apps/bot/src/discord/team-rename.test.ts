import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Client } from 'discord.js';
import type { Db } from '../shared/db.js';
import type { Team } from '../features/teams/data.js';
import { syncRoleColor, syncTeamChannelNames } from './provision.js';

test('a renamed team updates its existing Discord role and channels', async () => {
  const names: string[] = [];
  const role = { hoist: true, setColor: async () => undefined, setName: async (name: string) => { names.push(`role:${name}`); } };
  const guild = { roles: { fetch: async () => role }, channels: { edit: async (id: string, update: { name: string }) => { names.push(`${id}:${update.name}`); } } };
  const client = { guilds: { fetch: async () => guild } } as unknown as Client;
  const team = { id: 'team', guildId: 'guild', name: 'Team Better', roleId: 'role', textChannelId: 'text', voiceChannelId: 'voice', colorId: 'cyan' } as Team;
  const deps = { db: {} as Db, client, categoryIdFor: () => undefined };
  await syncRoleColor(deps, team);
  await syncTeamChannelNames(deps, team);
  assert.deepEqual(names, ['role:Team Better', 'text:team-better', 'voice:Team Better']);
});
