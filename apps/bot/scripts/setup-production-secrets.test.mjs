import assert from 'node:assert/strict';
import { chmod, chown, mkdtemp, mkdir, readFile, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setupProductionSecrets } from './setup-production-secrets.mjs';

const paths = [
  'database/postgres_bootstrap_password', 'database/chashack_app_password', 'database/chashack_migration_password',
  'app/database_url', 'app/admin_session_secret', 'migration/migration_database_url',
];
const linuxRoot = process.platform === 'linux' && process.getuid?.() === 0;
const options = { skip: linuxRoot ? false : 'Run inside a disposable Linux container as root to verify real UID/GID permissions.' };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'chashack-setup-'));
  await mkdir(join(root, 'postgres'));
  await mkdir(join(root, 'legacy'));
  await mkdir(join(root, 'inputs'));
  await writeFile(join(root, 'inputs/discord_token'), 'synthetic-fixture-token');
  await writeFile(join(root, 'inputs/discord_client_secret'), 'synthetic-fixture-client-secret');
  t.after(async () => {
    await chown(join(root, 'postgres'), 0, 0);
    await chmod(join(root, 'postgres'), 0o700);
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
async function snapshot(root) {
  return Promise.all(paths.map(path => readFile(join(root, path), 'utf8')));
}

test('first startup creates distinct secrets with correct role URLs and access permissions', options, async t => {
  const root = await fixture(t);
  assert.equal(await setupProductionSecrets(root), 'generated');
  const values = await snapshot(root);
  for (const index of [0, 1, 2, 4]) assert.match(values[index].trim(), /^[a-f0-9]{64}$/);
  assert.equal(new Set([values[0], values[1], values[2], values[4]]).size, 4);
  assert.equal(values[3], `postgresql://chashack_app:${values[1].trim()}@db:5432/chashack\n`);
  assert.equal(values[5], `postgresql://chashack_migrate:${values[2].trim()}@db:5432/chashack\n`);
  for (const path of paths) {
    const info = await stat(join(root, path));
    assert.equal(info.mode & 0o777, 0o440);
    assert.equal(info.uid, 0);
    assert.equal(info.gid, path.startsWith('database/') ? 70 : 10001);
  }
  for (const scope of ['database', 'app', 'migration']) assert.equal((await stat(join(root, scope))).mode & 0o777, 0o750);
  assert.equal((await stat(join(root, 'store/credentials.json'))).mode & 0o777, 0o600);
  for (const name of ['discord_token', 'discord_client_secret']) {
    const info = await stat(join(root, 'app', name));
    assert.equal(info.mode & 0o777, 0o440);
    assert.equal(info.uid, 0);
    assert.equal(info.gid, 10001);
  }
  assert.match(await readFile(join(root, 'edge-config/Caddyfile'), 'utf8'), /trusted_proxies_strict/);
  assert.match(await readFile(join(root, 'postgres-init/10-roles.sh'), 'utf8'), /CREATE ROLE chashack_app/);
  assert.doesNotMatch(await readFile(join(root, 'postgres-init/10-roles.sh'), 'utf8'), /\r/);
});

test('Compose Up reruns preserve every credential even after PostgreSQL initializes', options, async t => {
  const root = await fixture(t);
  await setupProductionSecrets(root);
  const before = await snapshot(root);
  await writeFile(join(root, 'postgres/PG_VERSION'), '17\n');
  assert.equal(await setupProductionSecrets(root), 'reused');
  assert.deepEqual(await snapshot(root), before);
});

test('an interrupted projection is repaired from the committed credential record', options, async t => {
  const root = await fixture(t);
  await setupProductionSecrets(root);
  const before = await snapshot(root);
  await unlink(join(root, paths[3]));
  await writeFile(join(root, 'postgres/PG_VERSION'), '17\n');
  assert.equal(await setupProductionSecrets(root), 'reused');
  assert.deepEqual(await snapshot(root), before);
});

test('conflicting files are rejected without replacing values', options, async t => {
  const root = await fixture(t);
  await setupProductionSecrets(root);
  await chmod(join(root, paths[3]), 0o600);
  await writeFile(join(root, paths[3]), 'conflicting-value\n', { mode: 0o440 });
  await assert.rejects(setupProductionSecrets(root), /differs from the saved credentials/);
  assert.equal(await readFile(join(root, paths[3]), 'utf8'), 'conflicting-value\n');
});

test('missing credentials never generate replacement passwords against existing database data', options, async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'postgres/PG_VERSION'), '17\n');
  await chmod(join(root, 'postgres'), 0o700);
  await chown(join(root, 'postgres'), 70, 70);
  await assert.rejects(setupProductionSecrets(root), /PostgreSQL data already exists/);
  await assert.rejects(stat(join(root, 'store/credentials.json')), { code: 'ENOENT' });
});

test('incomplete credentials without a committed record stop for recovery', options, async t => {
  const root = await fixture(t);
  await setupProductionSecrets(root);
  await unlink(join(root, 'store/credentials.json'));
  await unlink(join(root, paths[3]));
  await assert.rejects(setupProductionSecrets(root), /Only part of the credential set exists/);
  await assert.rejects(stat(join(root, paths[3])), { code: 'ENOENT' });
});

test('complete projections can recover a missing private credential record', options, async t => {
  const root = await fixture(t);
  await setupProductionSecrets(root);
  const before = await snapshot(root);
  await unlink(join(root, 'store/credentials.json'));
  await writeFile(join(root, 'postgres/PG_VERSION'), '17\n');
  assert.equal(await setupProductionSecrets(root), 'imported');
  assert.deepEqual(await snapshot(root), before);
});

test('previous file-based credentials import unchanged with an existing database', options, async t => {
  const original = await fixture(t);
  await setupProductionSecrets(original);
  const before = await snapshot(original);
  const root = await fixture(t);
  for (let index = 0; index < paths.length; index += 1) {
    await writeFile(join(root, 'legacy', paths[index].split('/')[1]), before[index]);
  }
  await writeFile(join(root, 'postgres/PG_VERSION'), '17\n');
  assert.equal(await setupProductionSecrets(root), 'imported');
  assert.deepEqual(await snapshot(root), before);
});

test('damaged credential records fail with a redacted error', options, async t => {
  const root = await fixture(t);
  await setupProductionSecrets(root);
  await writeFile(join(root, 'store/credentials.json'), '{"appPassword":"sensitive-fixture-value"');
  await assert.rejects(setupProductionSecrets(root), error => {
    assert.match(error.message, /Stored credentials are damaged/);
    assert.doesNotMatch(error.message, /sensitive-fixture-value/);
    return true;
  });
});

test('symlinked secret files are rejected', options, async t => {
  const root = await fixture(t);
  await setupProductionSecrets(root);
  await unlink(join(root, paths[3]));
  await symlink(join(root, paths[0]), join(root, paths[3]));
  await assert.rejects(setupProductionSecrets(root), /Expected a regular secret file/);
});

test('concurrent setup attempts agree on one complete credential set', options, async t => {
  const root = await fixture(t);
  await Promise.all([setupProductionSecrets(root), setupProductionSecrets(root)]);
  const before = await snapshot(root);
  assert.equal(await setupProductionSecrets(root), 'reused');
  assert.deepEqual(await snapshot(root), before);
});

test('updated Discord inputs rotate their protected copies without changing generated credentials', options, async t => {
  const root = await fixture(t);
  await setupProductionSecrets(root);
  const before = await snapshot(root);
  await writeFile(join(root, 'inputs/discord_token'), 'synthetic-replacement-token');
  assert.equal(await setupProductionSecrets(root), 'reused');
  assert.equal(await readFile(join(root, 'app/discord_token'), 'utf8'), 'synthetic-replacement-token\n');
  assert.deepEqual(await snapshot(root), before);
});

test('unset or placeholder Discord inputs fail before generating a credential record', options, async t => {
  const root = await fixture(t);
  await writeFile(join(root, 'inputs/discord_token'), 'REPLACE_WITH_DISCORD_BOT_TOKEN');
  await assert.rejects(setupProductionSecrets(root), /Set DISCORD_TOKEN/);
  await assert.rejects(stat(join(root, 'store/credentials.json')), { code: 'ENOENT' });
});
