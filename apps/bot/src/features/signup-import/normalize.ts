/**
 * Imported-signup normalization (pure — no database, no Discord).
 *
 * Google Forms exports the *labels* a participant picked, not the option ids
 * the app stores. A CSV preview must therefore translate each cell to the id the
 * event form uses, and a save must never reject a whole batch because one cell
 * could not be translated. Everything unresolved stays visible in the row's
 * `source:<header>` values and in the returned `issues`.
 */
import type { FormConfig, CustomQuestion } from '../form/domain.js';
import { validateCustomAnswers } from '../form/domain.js';

export interface LabelledOption {
  id: string;
  label?: string | undefined;
  label_sv?: string | undefined;
}

/** Lowercase, strip diacritics and punctuation so labels compare reliably. */
export function foldKey(value: string): string {
  return value
    .toLocaleLowerCase('sv-SE')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Google Forms joins checkbox answers inconsistently (`, `, `;`, `|`, newlines).
 * Split on all of them; no option id or label of ours contains these characters.
 */
export function splitValues(raw: string): string[] {
  return raw.split(/[,;|\r\n]+/).map((value) => value.trim()).filter(Boolean);
}

/**
 * Words that identify one of the three participation choices when the exported
 * answer is a full sentence ("Jag vill bli tilldelad en grupp"). Candidates are
 * only accepted when the event form actually offers that option.
 */
const TEAM_PREF_KEYWORDS: { id: string; words: string[] }[] = [
  { id: 'random_team', words: ['slump', 'random', 'tilldel', 'tilldela', 'placera', 'placerad', 'matcha', 'matchad', 'assigned', 'assigned group', 'auto'] },
  { id: 'join_team', words: ['fardig', 'fardig grupp', 'redan', 'befintlig', 'existerande', 'ready', 'ready made', 'existing', 'join', 'medlem i'] },
  { id: 'create_team', words: ['oppen', 'oppet', 'open', 'fler', 'flera', 'skapa', 'egen', 'egna', 'own', 'create', 'more', 'larger'] },
];

function keywordIds(raw: string, options: LabelledOption[]): string[] {
  const folded = foldKey(raw);
  if (!folded) return [];
  const ids: string[] = [];
  for (const rule of TEAM_PREF_KEYWORDS) {
    if (!rule.words.some((word) => folded.includes(word))) continue;
    if (!options.some((option) => option.id === rule.id)) continue;
    ids.push(rule.id);
  }
  return ids;
}

/**
 * Resolve one exported cell to an option id.
 *
 * Order: exact id → folded id → exact label (en/sv) → the option's label being
 * contained in the cell or the cell in the label → participation keywords.
 * Ambiguity is resolved towards the shortest matching label so "Frontend"
 * becomes the first, most specific frontend skill instead of failing.
 */
export function matchOption(raw: string, options: LabelledOption[], keywords = false): string | null {
  const value = raw.trim();
  if (!value) return null;
  const direct = options.find((option) => option.id === value);
  if (direct) return direct.id;
  const folded = foldKey(value);
  if (!folded) return null;
  const byId = options.find((option) => foldKey(option.id) === folded);
  if (byId) return byId.id;
  const labels = (option: LabelledOption) => [option.label, option.label_sv].filter((label): label is string => typeof label === 'string' && label !== '').map(foldKey);
  const exact = options.find((option) => labels(option).includes(folded));
  if (exact) return exact.id;
  const contained = options
    .filter((option) => labels(option).some((label) => label.length >= 3 && (label.includes(folded) || folded.includes(label))))
    .sort((a, b) => Math.min(...labels(a).map((label) => label.length)) - Math.min(...labels(b).map((label) => label.length)));
  if (contained.length > 0) return contained[0]!.id;
  if (keywords) {
    const candidate = keywordIds(value, options)[0];
    if (candidate) return candidate;
  }
  return null;
}

/**
 * Broad Google Form checkboxes ("Frontend", "Backend", "UX") name a whole area
 * rather than one of our skill options. Map them to the most representative
 * built-in skill; the alias only applies when the form actually offers that id,
 * so a trimmed skill list keeps working.
 */
const SKILL_AREA_ALIASES: Record<string, string> = {
  frontend: 'frontend_react',
  frontendutveckling: 'frontend_react',
  frontenddevelopment: 'frontend_react',
  ux: 'ui_design',
  ui: 'ui_design',
  uiux: 'ui_design',
  uiuxdesign: 'ui_design',
  design: 'ui_design',
  backend: 'backend_node',
  backendutveckling: 'backend_node',
  backenddevelopment: 'backend_node',
  devops: 'devops',
  infra: 'devops',
  infrastruktur: 'devops',
  data: 'data_ml',
  ml: 'data_ml',
  ai: 'ai_integrations',
  pm: 'pm_pitch',
  pitch: 'pm_pitch',
};

function matchSkill(raw: string, options: LabelledOption[]): string | null {
  const alias = SKILL_AREA_ALIASES[foldKey(raw).replace(/ /g, '')];
  if (alias && options.some((option) => option.id === alias)) return alias;
  return matchOption(raw, options);
}

export interface NormalizedRow {
  values: Record<string, string>;
  answers: Record<string, string | string[]>;
  /** Human-readable notes about cells that were dropped or rewritten. */
  issues: string[];
}

function coreOptions(form: FormConfig, key: 'experience' | 'role' | 'teamPref'): LabelledOption[] {
  return key === 'experience' ? form.experiences : key === 'role' ? form.roleTracks : form.teamPrefs;
}
const CORE_SELECT_KEYS = ['experience', 'role', 'teamPref'] as const;

function coerceQuestionAnswer(question: CustomQuestion, value: string | string[]): string | string[] | null {
  const choices: LabelledOption[] = (question.choices ?? []).map((choice) => ({ id: choice.id, label: choice.label.en, label_sv: choice.label.sv }));
  if (question.kind === 'multi_choice') {
    const tokens = Array.isArray(value) ? value : splitValues(value);
    const ids = [...new Set(tokens.map((token) => matchOption(token, choices)).filter((id): id is string => id !== null))];
    return ids.length ? ids : null;
  }
  // An array is only ever valid for a multi-choice question.
  if (Array.isArray(value)) value = value.join(', ');
  if (question.kind === 'slider') {
    const number = Number.parseInt(value, 10);
    if (!Number.isFinite(number)) return null;
    return String(Math.min(10, Math.max(1, number)));
  }
  if (question.kind === 'toggle') {
    const folded = foldKey(value);
    if (['yes', 'y', 'ja', 'true', '1', 'j'].includes(folded)) return 'yes';
    if (['no', 'n', 'nej', 'false', '0'].includes(folded)) return 'no';
    return null;
  }
  if (question.kind === 'single_choice') return matchOption(value, choices);
  return value;
}

/**
 * Translate every answer to the value the form validator accepts, dropping only
 * what cannot be translated. Never throws and never returns a partially invalid
 * payload.
 */
export function sanitizeAnswers(form: FormConfig, raw: Record<string, unknown>): { answers: Record<string, string | string[]>; issues: string[] } {
  const issues: string[] = [];
  const questions = form.customQuestions ?? [];
  const byId = new Map(questions.map((question) => [question.id, question]));
  const answers: Record<string, string | string[]> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (value === undefined || value === null || value === '') continue;
    const question = byId.get(id);
    if (!question) { issues.push(`Unknown question dropped: ${id}`); continue; }
    if (Array.isArray(value) && question.kind !== 'multi_choice') { issues.push(`Unexpected list dropped: ${id}`); continue; }
    const checkable = { ...form, customQuestions: [question] };
    const direct = validateCustomAnswers(checkable, { [id]: value });
    if (direct.ok) { answers[id] = direct.answers[id]!; continue; }
    const coerced = coerceQuestionAnswer(question, value as string | string[]);
    if (coerced === null) { issues.push(`Unreadable answer dropped: ${question.label.en}`); continue; }
    const retried = validateCustomAnswers(checkable, { [id]: coerced });
    if (!retried.ok) { issues.push(`Unreadable answer dropped: ${question.label.en}`); continue; }
    answers[id] = retried.answers[id]!;
    issues.push(`Answer interpreted: ${question.label.en}`);
  }
  return { answers, issues };
}

/**
 * Normalize the core profile values of one imported row.
 *
 * `experience`, `role` and `teamPref` collapse to a known id or disappear;
 * `skills` keeps the ids it could resolve. `participationPreference` is an older
 * alias of `teamPref` and is folded into it.
 */
export function normalizeValues(form: FormConfig, raw: Record<string, unknown>): { values: Record<string, string>; issues: string[] } {
  const issues: string[] = [];
  const values: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string') { issues.push(`Non-text value dropped: ${key}`); continue; }
    if (value === '') continue;
    values[key] = value;
  }

  if (!values.teamPref && values.participationPreference) values.teamPref = values.participationPreference;
  delete values.participationPreference;

  for (const key of CORE_SELECT_KEYS) {
    const cell = values[key];
    if (!cell) continue;
    const options = coreOptions(form, key);
    if (options.length === 0) { delete values[key]; continue; }
    const resolved = matchOption(cell, options, key === 'teamPref');
    if (resolved === null) { issues.push(`Unmatched ${key} value dropped: ${cell}`); delete values[key]; continue; }
    if (resolved !== cell) issues.push(`${key} interpreted as ${resolved}`);
    values[key] = resolved;
  }

  if (values.skills) {
    const tokens = splitValues(values.skills);
    const resolved: string[] = [];
    const unresolved: string[] = [];
    for (const token of tokens) {
      const id = matchSkill(token, form.skills);
      if (id === null) unresolved.push(token);
      else if (!resolved.includes(id)) resolved.push(id);
    }
    if (unresolved.length) issues.push(`Unmatched skill values dropped: ${unresolved.join(', ')}`);
    if (resolved.length) values.skills = resolved.join(',');
    else delete values.skills;
  }

  return { values, issues };
}

/** Values + answers of one imported row, ready to persist. */
export function normalizeImportedRow(form: FormConfig, values: Record<string, unknown>, answers: Record<string, unknown>): NormalizedRow {
  const normalized = normalizeValues(form, values);
  const checked = sanitizeAnswers(form, answers);
  return { values: normalized.values, answers: checked.answers, issues: [...normalized.issues, ...checked.issues] };
}

/** Profile fields derived from a claimed imported row (only ids the form knows). */
export function importedRowProfile(form: FormConfig, values: Record<string, string>): { experience: string; roleTrack: string; skills: string[]; teamPref: string } {
  const skillIds = values.skills ? splitValues(values.skills) : [];
  return {
    experience: form.experiences.some((option) => option.id === values.experience) ? values.experience! : '',
    roleTrack: form.roleTracks.some((option) => option.id === values.role) ? values.role! : '',
    skills: skillIds.filter((id) => form.skills.some((option) => option.id === id)),
    teamPref: form.teamPrefs.some((option) => option.id === values.teamPref) ? values.teamPref! : '',
  };
}
