import { randomBytes } from 'node:crypto';
import { chmod, chown, link, lstat, mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const files = [
  ['database', 'postgres_bootstrap_password', 70],
  ['database', 'chashack_app_password', 70],
  ['database', 'chashack_migration_password', 70],
  ['app', 'database_url', 10001],
  ['app', 'admin_session_secret', 10001],
  ['migration', 'migration_database_url', 10001],
];

async function readOptional(path) {
  let info;
  try { info = await lstat(path); } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    throw error;
  }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expected a regular secret file: ${path}`);
  return readFile(path, 'utf8');
}

async function permissions(path, gid, mode) {
  await chown(path, 0, gid);
  await chmod(path, mode);
}

async function directory(path, gid, mode) {
  await mkdir(path, { recursive: true, mode });
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Expected a real directory: ${path}`);
  await permissions(path, gid, mode);
}

// Publish only complete, synced files. Linking the temporary file makes creation
// atomic without ever replacing an existing secret, including under concurrency.
async function publish(path, value, gid, mode, replace = false) {
  const temp = join(dirname(path), `.setup-${randomBytes(16).toString('hex')}`);
  const handle = await open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(value, 'utf8');
    await handle.chown(0, gid);
    await handle.chmod(mode);
    await handle.sync();
  } finally { await handle.close(); }
  try {
    if (replace) await rename(temp, path);
    else await link(temp, path);
    // Persist the directory entry before allowing PostgreSQL to initialize.
    const parent = await open(dirname(path), 'r');
    try { await parent.sync(); } finally { await parent.close(); }
  } finally {
    await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

function validate(credentials) {
  if (credentials?.version !== 1) throw new Error('Stored credentials have an unsupported format. Restore the credential backup.');
  for (const key of ['bootstrapPassword', 'appPassword', 'migrationPassword', 'sessionSecret']) {
    const value = credentials[key];
    if (typeof value !== 'string' || value.length < 32 || /[\r\n\0]/.test(value)) {
      throw new Error(`Invalid stored ${key}. Restore the credential backup.`);
    }
  }
  if (!/^[a-z0-9]{32,}$/.test(credentials.appPassword) || !/^[a-z0-9]{32,}$/.test(credentials.migrationPassword)) {
    throw new Error('Stored role passwords do not match PostgreSQL initialization requirements.');
  }
  const values = ['bootstrapPassword', 'appPassword', 'migrationPassword', 'sessionSecret'].map(key => credentials[key]);
  if (new Set(values).size !== values.length) throw new Error('Database roles and session signing must use separate credentials.');
  return credentials;
}

function projections(credentials) {
  return [
    credentials.bootstrapPassword,
    credentials.appPassword,
    credentials.migrationPassword,
    `postgresql://chashack_app:${credentials.appPassword}@db:5432/chashack`,
    credentials.sessionSecret,
    `postgresql://chashack_migrate:${credentials.migrationPassword}@db:5432/chashack`,
  ];
}

async function importFiles(paths) {
  const contents = await Promise.all(paths.map(path => readOptional(path)));
  const count = contents.filter(value => value !== undefined).length;
  if (!count) return undefined;
  if (count !== files.length) throw new Error('Only part of the credential set exists. Restore its missing files; credentials were not regenerated.');
  const values = contents.map(value => value.replace(/\r?\n$/, ''));
  const credentials = validate({
    version: 1,
    bootstrapPassword: values[0], appPassword: values[1], migrationPassword: values[2], sessionSecret: values[4],
  });
  // Only import URLs for the bundled database, with the corresponding role.
  for (const [index, role, password] of [[3, 'chashack_app', values[1]], [5, 'chashack_migrate', values[2]]]) {
    let url;
    try { url = new URL(values[index]); } catch { throw new Error('An existing database URL is invalid; credentials were not changed.'); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== 'db' || url.port !== '5432'
      || url.pathname !== '/chashack' || url.username !== role || decodeURIComponent(url.password) !== password || url.search || url.hash) {
      throw new Error('An existing database URL does not match its role password or the bundled database.');
    }
  }
  return credentials;
}

export async function setupProductionSecrets(root = '/state', configSource = sourceRoot) {
  process.umask(0o077);
  const discordInputs = [];
  for (const name of ['discord_token', 'discord_client_secret']) {
    const value = (await readOptional(join(root, 'inputs', name)))?.replace(/\r?\n$/, '');
    if (!value || /\s|\0/.test(value) || value.startsWith('REPLACE_')) {
      throw new Error(`Set ${name.toUpperCase()} to the credential issued by Discord in the stack's private .env settings.`);
    }
    discordInputs.push([name, value]);
  }
  for (const [name, gid, mode] of [
    ['store', 0, 0o700], ['database', 70, 0o750], ['app', 10001, 0o750], ['migration', 10001, 0o750],
    ['edge-config', 0, 0o755], ['postgres-init', 0, 0o755],
  ]) await directory(join(root, name), gid, mode);

  const manifest = join(root, 'store', 'credentials.json');
  let saved = await readOptional(manifest);
  let status = 'reused';
  if (saved === undefined) {
    const current = await importFiles(files.map(([scope, name]) => join(root, scope, name)));
    const legacy = current ?? await importFiles(files.map(([, name]) => join(root, 'legacy', name)));
    let credentials = legacy;
    if (legacy) status = 'imported';
    else {
      // Never replace lost credentials with new passwords against an old DB.
      if ((await readdir(join(root, 'postgres'))).length) {
        throw new Error('PostgreSQL data already exists but its credentials are missing. Restore the credential volumes or the original deploy/secrets files.');
      }
      credentials = validate({
        version: 1,
        bootstrapPassword: randomBytes(32).toString('hex'),
        appPassword: randomBytes(32).toString('hex'),
        migrationPassword: randomBytes(32).toString('hex'),
        sessionSecret: randomBytes(32).toString('hex'),
      });
      status = 'generated';
    }
    try { await publish(manifest, `${JSON.stringify(credentials)}\n`, 0, 0o600); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      status = 'reused';
    }
    saved = await readOptional(manifest);
  }
  let credentials;
  try { credentials = JSON.parse(saved); } catch { throw new Error('Stored credentials are damaged. Restore the credential backup.'); }
  validate(credentials);
  await permissions(manifest, 0, 0o600);
  const values = projections(credentials);
  for (let index = 0; index < files.length; index += 1) {
    const [scope, name, gid] = files[index];
    const path = join(root, scope, name);
    try { await publish(path, `${values[index]}\n`, gid, 0o440); } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    if ((await readOptional(path))?.replace(/\r?\n$/, '') !== values[index]) {
      throw new Error(`Existing ${name} differs from the saved credentials. No secret was overwritten; restore the matching set.`);
    }
    await permissions(path, gid, 0o440);
  }
  // Compose does not honor secret uid/gid/mode outside Swarm. Only this offline
  // setup container sees its input mounts; the app gets protected copies.
  // Discord-issued inputs may intentionally rotate when the operator edits .env.
  for (const [name, value] of discordInputs) {
    await publish(join(root, 'app', name), `${value}\n`, 10001, 0o440, true);
  }

  // Package the canonical deployment files with the app image. A copied Compose
  // stack then needs no checkout, host scripts or manually created config files.
  for (const [source, target] of [
    ['deploy/Caddyfile', 'edge-config/Caddyfile'], // g0:allow:secrets #62 - public configuration file paths, not credentials.
    ['postgres-init/10-roles.sh', 'postgres-init/10-roles.sh'],
  ]) {
    const content = (await readFile(join(configSource, source), 'utf8')).replace(/\r\n/g, '\n');
    await publish(join(root, target), content, 0, 0o444, true);
  }
  return status;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.getuid?.() !== 0) {
    console.error('Secret setup must run as the Compose provisioning user (root).');
    process.exitCode = 1;
  } else {
    setupProductionSecrets().then(status => console.log(`Secret setup complete: credentials ${status}; deployment configuration ready.`)).catch(error => {
      console.error(`Secret setup failed: ${error.message}`);
      process.exitCode = 1;
    });
  }
}
