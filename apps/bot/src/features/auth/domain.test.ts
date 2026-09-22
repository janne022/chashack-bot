import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openDb } from '../../shared/db.js';
import {
  ADMINISTRATOR,
  MANAGE_GUILD,
  base64Url,
  canManage,
  manageableGuilds,
  makePkcePair,
  makeState,
  safeEqual,
} from './domain.js';
import { makeOperatorToken, makeDiscordToken, verifyToken } from './domain.js';
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
  // real payloads arrive as decimal strings
  assert.equal(canManage('32'), true, '32 = MANAGE_GUILD');
  assert.equal(canManage('8'), true, '8 = ADMINISTRATOR');
  assert.equal(canManage('2048'), false, '2048 = SEND_MESSAGES only');
});

test('manageableGuilds: user rights AND bot presence', async () => {
  const user = [
    guild('1', 'Zeta', MANAGE_GUILD),
    guild('2', 'Alpha', ADMINISTRATOR),
    guild('3', 'Member Only', 1n << 11n),
    guild('4', 'No Bot', MANAGE_GUILD),
  ];
  const only = manageableGuilds(user, new Set(['1', '2', '3']));
  assert.deepEqual(only.map((g) => g.name), ['Alpha', 'Zeta'], 'sorted, admin-only, bot-present');

  const all = manageableGuilds(user, null);
  assert.deepEqual(all.map((g) => g.id), ['2', '4', '1'], 'no gateway → trust the OAuth list');
});

test('tokens: operator format is unchanged, discord format carries a session id', async () => {
  const now = 1_000_000;
  const operator = makeOperatorToken(SECRET, now);
  assert.equal(operator.split('.').length, 2, 'legacy shape preserved');
  assert.deepEqual(verifyToken(SECRET, operator, now), { kind: 'operator' });

  const discord = makeDiscordToken(SECRET, 'abc123', now);
  assert.equal(discord.split('.')[1], 'd');
  assert.deepEqual(verifyToken(SECRET, discord, now), { kind: 'discord', sessionId: 'abc123' });

  // tampering and expiry
  assert.equal(verifyToken(SECRET, `${operator}x`, now), null);
  assert.equal(verifyToken('other-secret', operator, now), null);
  assert.equal(verifyToken(SECRET, operator, now + 8 * 24 * 3600 * 1000), null, 'expired');
  assert.equal(verifyToken(SECRET, 'garbage', now), null);
  assert.equal(verifyToken(SECRET, makeDiscordToken(SECRET, 'abc', now).replace('abc', 'xyz'), now), null, 'swapped id');
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
  const db = openDb(':memory:');
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
  assert.equal(await getSession(db, session.id)?.username, 'janne');

  assert.equal(await selectGuild(db, session.id, 'g2'), true);
  assert.equal(await getSession(db, session.id)?.selectedGuildId, 'g2');
  assert.equal(await selectGuild(db, session.id, 'not-mine'), false, 'must not be able to switch to a foreign guild');
  assert.equal(await getSession(db, session.id)?.selectedGuildId, 'g2', 'refusal leaves the selection alone');

  await deleteSession(db, session.id);
  assert.equal(await getSession(db, session.id), null);
});

test('sessions: expired rows are dropped, not served', async () => {
  const db = openDb(':memory:');
  const session = await createSession(db, {
    userId: 'u2',
    username: 'ghost',
    avatar: null,
    guilds: [{ id: 'g1', name: 'One', icon: null }],
  });
  const later = Date.now() + 8 * 24 * 3600 * 1000;
  assert.equal(await getSession(db, session.id, later), null, 'expired session is not returned');
  assert.equal(await purgeExpiredSessions(db, later), 0, 'it deleted itself on read');
});
