#!/usr/bin/env node
/**
 * Supply-chain guard: refuses to install if any dependency declares a
 * preinstall/postinstall/prepare script, except for an explicit allowlist.
 *
 * pnpm >= 10.16 already blocks build scripts unless allowlisted, but this hook
 * also blocks `prepare` (which pnpm ignores) and documents intent at install
 * time. Wired as `postinstall` in package.json.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWED = new Set(); // none today — all deps are pure JS

let pnpmRoot;
try {
  pnpmRoot = execFileSync('pnpm', ['root'], { cwd: root, encoding: 'utf8' }).trim();
} catch {
  // not running under pnpm install (e.g. direct `npm test`); nothing to check
  process.exit(0);
}

const { dependencies = {} } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const offenders = [];

for (const name of Object.keys(dependencies)) {
  try {
    const pkg = JSON.parse(readFileSync(join(pnpmRoot, name, 'package.json'), 'utf8'));
    const scripts = pkg.scripts ?? {};
    if (['preinstall', 'postinstall', 'prepare'].some((k) => typeof scripts[k] === 'string' && !ALLOWED.has(name))) {
      offenders.push(`${name}@${pkg.version} (${Object.keys(scripts).filter((k) => k !== 'test').join(', ')})`);
    }
  } catch {
    // dependency not installed (postinstall during a dry run) — skip
  }
}

if (offenders.length > 0) {
  console.error('Refusing to continue: install scripts detected in dependencies:');
  for (const o of offenders) console.error(`  ${o}`);
  console.error('If you have reviewed and trust them, add the package to scripts/no-install-scripts.mjs ALLOWED.');
  process.exit(1);
}

console.log('No install scripts in runtime dependencies. OK.');
