#!/usr/bin/env node
/** Checks EN/SV catalog key parity in shared/i18n.ts and lists gaps. */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'i18n.ts'), 'utf8');
const enBlock = src.match(/const EN: Catalog = \{([\s\S]*?)\n\};/)[1];
const svBlock = src.match(/const SV: Catalog = \{([\s\S]*?)\n\};/)[1];
const keys = (b) => new Set([...b.matchAll(/'([^']+)':/g)].map((m) => m[1]));
const en = keys(enBlock);
const sv = keys(svBlock);
const missingInSv = [...en].filter((k) => !sv.has(k));
const missingInEn = [...sv].filter((k) => !en.has(k));
console.log(`EN: ${en.size} | SV: ${sv.size} | missing in SV: ${missingInSv.length} | extra in SV: ${missingInEn.length}`);
missingInSv.slice(0, 25).forEach((k) => console.log('  SV-missing:', k));
missingInEn.slice(0, 10).forEach((k) => console.log('  EN-missing (sv-only):', k));

// Also: values that are still identical to EN (likely untranslated)
const getVals = (b) => {
  const map = {};
  for (const m of b.matchAll(/'([^']+)':\s*'((?:[^'\\]|\\.)*)'/g)) map[m[1]] = m[2];
  return map;
};
const enV = getVals(enBlock);
const svV = getVals(svBlock);
const untranslated = [...en].filter((k) => svV[k] !== undefined && svV[k] === enV[k] && /[a-z]{4}/.test(enV[k]) && !/^(ChasHack|Team)$/.test(enV[k]));
console.log(`identical EN/SV values (possibly untranslated): ${untranslated.length}`);
untranslated.slice(0, 30).forEach((k) => console.log('  same:', k, '=>', JSON.stringify(enV[k]).slice(0, 60)));
