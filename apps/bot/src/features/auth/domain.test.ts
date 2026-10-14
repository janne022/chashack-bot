import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openTestDb } from '../../shared/test-db.js';
import {
  ADMINISTRATOR,
  MANAGE_GUILD,
  base64Url,
  canManage,
  candidateGuilds,
  makePkcePair,
  makeState,
  safeEqual,
  hasGuildManageAuthority,
} from './domain.js';
import { makeDiscordToken, verifyToken } from './domain.js';
import { createSession, getSession, selectGuild, deleteSession, purgeExpiredSessions } from './data.js';

const SECRET = 'test-secret';

const guild = (id: string, name: string, permissions: bigint) => ({
  id,
  name,
  icon: null,
  permissions: permissions.toString(),
});

test('canManage: MANAGE_GUILD or ADMINISTRATOR, nothing else', async () => {
  assert.equal(canManage(MANAGE_GUILD), true);
  assert.equal(canManage(ADMINISTRATOR), true);
  assert.equal(canManage(ADMINISTRATOR | MANAGE_GUILD), true);
  assert.equal(canManage(0n), false);
  assert.equal(canManage(1n << 11n), false, 'SEND_MESSAGES is not admin');
  assert.equal(canManage('not-a-number'), false);
  assert.equal(canManage('32'), true, '32 = MANAGE_GUILD');
  assert.equal(canManage('8'), true, '8 = ADMINISTRATOR');
  assert.equal(canManage('2048'), false, '2048 = SEND_MESSAGES only');
});

test('candidateGuilds include bot guilds regardless of OAuth permission snapshot', async () => {
  const user = [
    guild('1', 'Zeta', MANAGE_GUILD),
    guild('2', 'Alpha', ADMINISTRATOR),
    guild('3', 'Member Only', 1n << 11n),
    guild('4', 'No Bot', MANAGE_GUILD),
    guild('5', 'Delegated Only', 0n),
  ];
  const only = candidateGuilds(user, new Set(['1', '2', '3', '5']));
  assert.deepEqual(only.map((g) => g.name), ['Alpha', 'Delegated Only', 'Member Only', 'Zeta'], 'OAuth permissions do not define current authority');

  const all = candidateGuilds(user, null);
  assert.deepEqual(all, [], 'missing bot client fails closed');
});

test('fresh authority is owner, administrator, or an explicitly delegated role', () => {
  assert.equal(hasGuildManageAuthority('owner', 'owner', '0', [], []), true);
  assert.equal(hasGuildManageAuthority('admin', 'owner', '8', [], []), true);
  assert.equal(hasGuildManageAuthority('manager', 'owner', '32', [], []), false);
  assert.equal(hasGuildManageAuthority('delegate', 'owner', '0', ['role-a'], ['role-a']), true);
  assert.equal(hasGuildManageAuthority('member', 'owner', '0', ['role-a'], ['role-b']), false);
  assert.equal(hasGuildManageAuthority('member', 'owner', 'bogus', ['role-a'], ['role-a']), false);
});

test('tokens accept Discord sessions only; reject legacy operator tokens', async () => {
  const now = 1_000_000;
  const discord = makeDiscordToken(SECRET, 'abc123', now);
  assert.deepEqual(verifyToken(SECRET, discord, now), { kind: 'discord', sessionId: 'abc123', audience: 'organizer' });
  const participant = makeDiscordToken(SECRET, 'abc123', now, 'participant');
  assert.deepEqual(verifyToken(SECRET, participant, now), { kind: 'discord', sessionId: 'abc123', audience: 'participant' });
  assert.equal(verifyToken(SECRET, participant.replace('.participant.', '.organizer.'), now), null, 'audience cannot be changed');
  assert.equal(verifyToken(SECRET, '1000000000.legacy', now), null);
  assert.equal(verifyToken('other-secret', discord, now), null);
  assert.equal(verifyToken(SECRET, discord, now + 8 * 24 * 3600 * 1000), null);
  assert.equal(verifyToken(SECRET, 'garbage', now), null);
});

test('makeState: unique per call, url-safe', async () => {
  const a = makeState();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notEqual(a, makeState());
});

test('PKCE: S256 challenge derived from the verifier, RFC 7636 alphabet', async () => {
  const { verifier, challenge } = makePkcePair();
  assert.match(verifier, /^[A-Za-z0-9\-_]{43,128}$/, 'verifier uses the unreserved alphabet');
  assert.equal(challenge, base64Url(createHash('sha256').update(verifier).digest()), 'challenge = S256(verifier)');
  assert.doesNotMatch(challenge, /[+/=]/, 'base64url, so it survives a query string');
  const other = makePkcePair();
  assert.notEqual(other.verifier, verifier, 'fresh pair per attempt');
  assert.notEqual(other.challenge, challenge);
});

test('safeEqual: compares without leaking length or content by short-circuit', async () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', ''), true);
});

test('sessions: create, select an authorised guild, refuse an unauthorised one', async () => {
  const db = await openTestDb();
  const session = await createSession(db, {
    userId: 'u1',
    username: 'janne',
    avatar: null,
    guilds: [
      { id: 'g1', name: 'One', icon: null },
      { id: 'g2', name: 'Two', icon: null },
    ],
  });
  assert.equal(session.selectedGuildId, 'g1', 'first guild is selected by default');
  assert.equal((await getSession(db, session.id))?.username, 'janne');

  assert.equal(await selectGuild(db, session.id, 'g2'), true);
  assert.equal((await getSession(db, session.id))?.selectedGuildId, 'g2');
  assert.equal(await selectGuild(db, session.id, 'not-mine'), false);
  assert.equal((await getSession(db, session.id))?.selectedGuildId, 'g2');

  await deleteSession(db, session.id);
  assert.equal(await getSession(db, session.id), null);
  await db.close();
});

test('sessions: expired rows are dropped, not served', async () => {
  const db = await openTestDb();
  const session = await createSession(db, {
    userId: 'u2',
    username: 'ghost',
    avatar: null,
    guilds: [{ id: 'g1', name: 'One', icon: null }],
  });
  const later = Date.now() + 8 * 24 * 3600 * 1000;
  assert.equal(await getSession(db, session.id, later), null);
  assert.equal(await purgeExpiredSessions(db, later), 0);
  await db.close();
});
