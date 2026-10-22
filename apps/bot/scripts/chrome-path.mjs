#!/usr/bin/env node
/**
 * Headless Chromium executable used by every browser harness in this directory.
 *
 * The harnesses spawn Chrome directly over CDP, so the binary path cannot be
 * inferred from a package (there is no playwright dependency). This resolves it
 * once for all of them: `CHROME_PATH` wins, then the newest Playwright browser
 * already cached under ~/.cache/ms-playwright, then the distro/CI Google Chrome.
 *
 * g0:allow:secrets t_c2833b53 — public Chromium executable paths and launch
 * flags, no credential.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const cache = join(process.env.HOME ?? '/root', '.cache', 'ms-playwright');

function fromCache() {
  if (!existsSync(cache)) return undefined;
  const revisions = readdirSync(cache)
    .filter(name => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(b.slice(9)) - Number(a.slice(9)));
  return revisions
    .map(revision => join(cache, revision, 'chrome-linux64', 'chrome'))
    .find(existsSync);
}

export const chromePath =
  process.env.CHROME_PATH || fromCache() || '/usr/bin/google-chrome'; // g0:allow:secrets t_c2833b53 — public Chromium executable path, no credential.

if (!existsSync(chromePath)) {
  throw new Error(
    `no Chromium executable at ${chromePath}; install one or set CHROME_PATH`,
  );
}
