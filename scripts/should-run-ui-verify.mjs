#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const base = process.argv[2];
if (!base) throw new Error('base revision is required');
const paths = [
  'apps/admin-ui', 'apps/bot/src', 'apps/bot/scripts/*browser*.mjs',
  'apps/bot/scripts/chrome-*.mjs', 'package.json', '.hermes/pipeline.yaml',
  '.github/workflows/ci.yml', 'scripts/should-run-ui-verify.mjs', '.hermes/pipeline',
];
const diff = spawnSync('git', ['diff', '--quiet', `${base}...HEAD`, '--', ...paths], { stdio: 'inherit' });
if (diff.error) throw diff.error;
if (diff.status === 1) process.exit(0);
if (diff.status !== 0) process.exit(diff.status ?? 1);
process.exit(1);
