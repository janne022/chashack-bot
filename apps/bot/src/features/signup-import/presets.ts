/**
 * Reusable column maps for imported signup CSVs.
 *
 * A preset names the questions an organizer's form actually asks, so a known
 * export (for example the Hackoween Google Form) needs no hand mapping. Header
 * matching is folded (`foldKey`), so accents, punctuation and a trailing "?"
 * do not matter. Anything a preset does not recognise falls back to the generic
 * keyword table, and unresolved columns are kept as `source:` values.
 */
import { foldKey } from './normalize.js';

export interface ImportPresetColumn {
  /** Every header spelling that should map to `target`. */
  headers: string[];
  /** Core field key or custom-question id. */
  target: string;
}

export interface ImportPreset {
  id: string;
  label: { en: string; sv: string };
  description: { en: string; sv: string };
  columns: ImportPresetColumn[];
}

/**
 * The ChaS Hackoween form as it is exported from Google Forms. Targets are the
 * core import fields; the free-text Discord username is intentionally optional
 * and can be filled in by an organizer later.
 */
export const HACKOWEEN_FORM_PRESET: ImportPreset = {
  id: 'hackoween-google-form',
  label: { en: 'Hackoween Google Form', sv: 'Hackoween Google-formulär' },
  description: {
    en: 'Name and class, Chas e-mail, optional Discord username, allergies, how you join, group size, group name, members and preferred work areas.',
    sv: 'Namn och klass, Chas-mail, valfritt Discord-namn, allergier, hur du deltar, gruppstorlek, gruppnamn, medlemmar och önskade arbetsområden.',
  },
  columns: [
    { target: 'sourceTimestamp', headers: ['Tidstämpel', 'Tidsstämpel', 'Timestamp'] },
    { target: 'name', headers: ['Ditt namn och klass', 'Namn och klass', 'Ditt namn', 'Name', 'Namn'] },
    { target: 'email', headers: ['Din Chas-mail', 'Din chas mail', 'Chas-mail', 'Chas mail', 'E-post', 'Email', 'E-mail'] },
    { target: 'discordUsername', headers: ['Din discord username', 'Ditt discord-namn', 'Discord username', 'Discord-användarnamn', 'Discord'] },
    { target: 'allergies', headers: ['Har du några allergier vi ska ta hänsyn till när vi köper fika', 'Allergier', 'Allergies', 'Dietary restrictions'] },
    { target: 'teamPref', headers: ['Hur vill du delta i Hackoween', 'Hur vill du delta', 'Participation', 'Deltagande'] },
    { target: 'groupSize', headers: ['Hur många är ni i er grupp', 'Hur många är ni', 'Group size', 'Gruppstorlek'] },
    { target: 'groupName', headers: ['Gruppnamn för dig som anmäler en färdig grupp', 'Gruppnamn (för dig som anmäler i en färdig grupp)', 'Gruppnamn', 'Group name'] },
    { target: 'members', headers: ['Namn på medlemmarna i gruppen', 'Medlemmar', 'Members', 'Teammates'] },
    { target: 'skills', headers: ['Vilket område vill du helst jobba med under Hackatonet', 'Vilket område vill du helst jobba med', 'Preferred work areas', 'Område'] },
  ],
};

export const IMPORT_PRESETS: ImportPreset[] = [HACKOWEEN_FORM_PRESET];

export function presetExists(id: string): boolean {
  return IMPORT_PRESETS.some((preset) => preset.id === id);
}

/** Generic fallback: a single normalised header that is safe to map anywhere. */
const GENERIC_TARGETS: Record<string, string> = {
  timestamp: 'sourceTimestamp',
  tidstampel: 'sourceTimestamp',
  nameclass: 'name',
  dittnamnochklass: 'name',
  name: 'name',
  namn: 'name',
  chasemail: 'email',
  chasmail: 'email',
  dinchasmail: 'email',
  email: 'email',
  epost: 'email',
  discordusername: 'discordUsername',
  discord: 'discordUsername',
  allergies: 'allergies',
  allergier: 'allergies',
  dietary: 'allergies',
  hardunagrallergierviskatahansyntillnarkoperfika: 'allergies',
  hardunagraallergierviskatahansyntillnarvikoperfika: 'allergies',
  participationpreference: 'teamPref',
  deltagande: 'teamPref',
  hurvildeltaihackoween: 'teamPref',
  hurvilldudeltaihackoween: 'teamPref',
  groupsize: 'groupSize',
  gruppstorlek: 'groupSize',
  hurmangaarnierergrupp: 'groupSize',
  hurmangaarniiergrupp: 'groupSize',
  groupname: 'groupName',
  gruppnamn: 'groupName',
  gruppnamnfordiganmalerienfardiggrupp: 'groupName',
  gruppnamnfordigsomanmalerienfardiggrupp: 'groupName',
  gruppnamnfordigsomanmalerenfardiggrupp: 'groupName',
  members: 'members',
  medlemmar: 'members',
  namnpamedlemmarnaigruppen: 'members',
  preferredworkareas: 'skills',
  omrade: 'skills',
  vilketomradevillduhelstjobbameddurhackatonet: 'skills',
  vilketomradevillduhelstjobbamedunderhackatonet: 'skills',
};

/** The header alone, folded, as the generic table keys things. */
export function genericTarget(header: string): string | null {
  return GENERIC_TARGETS[foldKey(header).replace(/ /g, '')] ?? null;
}

function presetTarget(preset: ImportPreset, header: string): string | null {
  const folded = foldKey(header);
  if (folded.length < 3) return null;
  // Exact folded match first: it is what the preset author spelled out, and it
  // keeps "Namn på medlemmarna i gruppen" from being claimed by "Namn".
  for (const column of preset.columns) {
    if (column.headers.some((candidate) => foldKey(candidate) === folded)) return column.target;
  }
  let best: { target: string; length: number } | null = null;
  for (const column of preset.columns) {
    for (const candidate of column.headers) {
      const candidateFolded = foldKey(candidate);
      if (candidateFolded.length < 4) continue;
      if (!folded.includes(candidateFolded) && !candidateFolded.includes(folded)) continue;
      if (best === null || candidateFolded.length > best.length) best = { target: column.target, length: candidateFolded.length };
    }
  }
  return best?.target ?? null;
}

export interface SuggestedMapping {
  mapping: Record<string, string>;
  /** Preset that recognised the export, if any. */
  presetId: string | null;
}

/**
 * Map CSV headers to import targets. An explicit preset wins; otherwise the
 * preset matching the most headers (at least two, so one coincidental column
 * cannot claim the file) is used before the generic fallback.
 */
export function suggestMapping(headers: string[], presetId?: string | null): SuggestedMapping {
  const explicit = presetId ? IMPORT_PRESETS.find((preset) => preset.id === presetId) ?? null : null;
  let chosen = explicit;
  if (chosen === null) {
    let best = 0;
    for (const preset of IMPORT_PRESETS) {
      const hits = headers.filter((header) => presetTarget(preset, header) !== null).length;
      if (hits >= 2 && hits > best) { best = hits; chosen = preset; }
    }
  }
  const mapping: Record<string, string> = {};
  for (const header of headers) {
    const target = (chosen ? presetTarget(chosen, header) : null) ?? genericTarget(header);
    if (target) mapping[header] = target;
  }
  return { mapping, presetId: chosen?.id ?? null };
}

/** Public shape for the console's template picker. */
export function presetCatalog(): { id: string; label: { en: string; sv: string }; description: { en: string; sv: string }; columns: { header: string; target: string }[] }[] {
  return IMPORT_PRESETS.map((preset) => ({
    id: preset.id,
    label: preset.label,
    description: preset.description,
    columns: preset.columns.flatMap((column) => column.headers.slice(0, 1).map((header) => ({ header, target: column.target }))),
  }));
}
