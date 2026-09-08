#!/usr/bin/env node
/** Finds t() keys used in discord/ but missing from shared/i18n.ts catalogs. */
const fs = require('fs');
const path = require('path');

function walk(dir) {
  let r = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const s = fs.statSync(p);
    if (s.isDirectory()) r.push(...walk(p));
    else if (f.endsWith('.ts') && !f.includes('.test.')) r.push(p);
  }
  return r;
}

const base = path.join(__dirname, '..');
const used = new Set();
for (const file of walk(path.join(base, 'src', 'discord'))) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(/t\(\s*(?:locale|botLocale\(\))\s*,\s*'([^']+)'/g)) {
    used.add(m[1]);
  }
}

const i18n = fs.readFileSync(path.join(base, 'src', 'shared', 'i18n.ts'), 'utf8');
const enBlock = i18n.match(/const EN: Catalog = \{([\s\S]*?)\n\};/)[1];
const defined = new Set([...enBlock.matchAll(/'([^']+)':/g)].map((m) => m[1]));

const missing = [...used].filter((k) => !defined.has(k));
console.log(`used: ${used.size} | defined: ${defined.size} | MISSING: ${missing.length}`);
missing.forEach((k) => console.log(' ', k));
