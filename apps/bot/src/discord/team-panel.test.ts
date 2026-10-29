import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTeamPanel } from './team-panel.js';
import { isCurrentTeamPanel } from './team-panel.js';
import type { Team } from '../features/teams/data.js';

test('team panel is event-bound and excludes private join codes', () => {
  const team: Team = {
    id: 'team-1', eventId: 'event-1', guildId: 'guild-1', name: 'Alpha', kind: 'private',
    ownerId: 'owner', joinCode: 'secret-code', roleId: null, textChannelId: 'channel-1',
    voiceChannelId: null, colorId: null, createdAt: 1,
  };
  const payload = buildTeamPanel(team, [{ userId: 'owner', displayName: 'Owner' }], 'sv');
  const json = JSON.stringify({ embeds: payload.embeds.map((embed) => embed.toJSON()), components: payload.components.map((row) => row.toJSON()) });
  assert.match(JSON.stringify(json), /Alpha/);
  assert.match(JSON.stringify(json), /hack:team-panel:event-1:team-1:/);
  assert.doesNotMatch(JSON.stringify(json), /secret-code/);
  assert.match(JSON.stringify(json), /👑 Owner — Teamägare/);
  const english = buildTeamPanel(team, [{ userId: 'owner', displayName: 'Owner' }, { userId: 'member', displayName: 'Member' }], 'en');
  const description = english.embeds[0]!.toJSON().description!;
  assert.match(description, /👑 Owner — Team owner/);
  assert.match(description, /• Member/);
  assert.match(description, /Visibility: private/);
  assert.match(description, /Status: space available/);
  assert.match(buildTeamPanel({ ...team, kind: 'public' }, [], 'sv').embeds[0]!.toJSON().description!, /Synlighet: offentligt/);
  assert.doesNotMatch(buildTeamPanel({ ...team, ownerId: null }, [{ userId: 'owner', displayName: 'Owner' }], 'en').embeds[0]!.toJSON().description!, /👑/);
});

test('leave confirmation is bound to the stored current panel message', () => {
  assert.equal(isCurrentTeamPanel({ channelId: 'c', messageId: 'm' }, 'c', 'm'), true);
  assert.equal(isCurrentTeamPanel({ channelId: 'c', messageId: 'm' }, 'c', 'copied'), false);
  assert.equal(isCurrentTeamPanel(null, 'c', 'm'), false);
});
