#!/usr/bin/env node
/**
 * Asserts that the admin UI i18n catalogs (en.json / sv.json) have IDENTICAL
 * key sets. Exits 1 and prints the offending keys otherwise.
 *
 * Usage: node scripts/check-i18n.mjs   (from the repo root)
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const enPath = path.join(root, 'apps/admin-ui/src/lib/i18n/en.json');
const svPath = path.join(root, 'apps/admin-ui/src/lib/i18n/sv.json');

const en = JSON.parse(readFileSync(enPath, 'utf8'));
const sv = JSON.parse(readFileSync(svPath, 'utf8'));

const enKeys = new Set(Object.keys(en));
const svKeys = new Set(Object.keys(sv));

const missingInSv = [...enKeys].filter((k) => !svKeys.has(k)).sort();
const missingInEn = [...svKeys].filter((k) => !enKeys.has(k)).sort();

const enCount = enKeys.size;
const svCount = svKeys.size;

if (missingInSv.length === 0 && missingInEn.length === 0) {
  console.log(`i18n check OK: en=${enCount} keys, sv=${svCount} keys — key sets identical`);
  process.exit(0);
}

if (missingInSv.length > 0) {
  console.error(`Keys missing in sv.json (${missingInSv.length}):`);
  for (const k of missingInSv) console.error(`  - ${k}`);
}
if (missingInEn.length > 0) {
  console.error(`Keys missing in en.json (${missingInEn.length}):`);
  for (const k of missingInEn) console.error(`  - ${k}`);
}
process.exit(1);
