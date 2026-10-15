/**
 * Form config domain: what the signup form asks, admin-editable.
 * Stored as JSON in form_config (single row). Pure data + validation.
 */
import { t } from '../../shared/i18n.js';

export type Experience = 'first_timer' | 'some_experience' | 'veteran';
/** How the participant wants to find their team. */
export type TeamPref = 'create_team' | 'join_team' | 'random_team';
export type TeamKind = 'public' | 'private';

export interface SkillOption {
  id: string;
  label: string;
  /** Optional Swedish label; the bot uses it when BOT_LANGUAGE=sv. */
  label_sv?: string;
  /** Stack group: skills within a group are mutually exclusive (e.g. backend languages). */
  group: string;
}

export interface FormConfig {
  version: number;
  title: string;
  description: string;
  /** Max members per matched or joined team. */
  teamSize: number;
  experiences: { id: Experience; label: string; label_sv?: string }[];
  roleTracks: { id: string; label: string; label_sv?: string }[];
  skills: SkillOption[];
  teamPrefs: { id: TeamPref; label: string; label_sv?: string }[];
  customQuestions?: CustomQuestion[];
  bannerUrl?: string | null;
  themePreset?: 'default' | 'halloween' | 'christmas';
  accentColor?: string;
}

export type LocalizedText = { en: string; sv?: string };
export interface CustomQuestion {
  id: string;
  kind: 'text' | 'single_choice' | 'multi_choice';
  label: LocalizedText;
  help: LocalizedText;
  required: boolean;
  presentation: 'web' | 'both';
  visibility: 'self_and_organizer' | 'organizer_only';
  choices?: { id: string; label: LocalizedText }[];
  mapping?: { field: 'experience' | 'role' | 'skills'; importance: 'low' | 'normal' | 'high'; choiceValues: Record<string, string> };
}

export type CustomAnswersResult =
  | { ok: true; answers: Record<string, string | string[]>; missingRequiredQuestionIds: string[] }
  | { ok: false; errors: string[] };

export function validBannerUrl(value: unknown): value is string | null | undefined {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value !== 'string' || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  } catch { return false; }
}

export function validateCustomQuestions(raw: unknown, config?: Pick<FormConfig, 'experiences' | 'roleTracks' | 'skills'>): { ok: true; questions: CustomQuestion[] } | { ok: false; errors: string[] } {
  if (!Array.isArray(raw)) return { ok: false, errors: ['questions must be an array'] };
  if (raw.length > 25) return { ok: false, errors: ['at most 25 custom questions are allowed'] };
  const errors: string[] = [];
  const ids = new Set<string>();
  const questions: CustomQuestion[] = [];
  for (const item of raw as CustomQuestion[]) {
    if (item === null || typeof item !== 'object' || !/^[a-zA-Z0-9_-]{1,64}$/.test(item.id) || ids.has(item.id)) {
      errors.push('question IDs must be unique stable identifiers');
      continue;
    }
    ids.add(item.id);
    if (!['text', 'single_choice', 'multi_choice'].includes(item.kind) || !['web', 'both'].includes(item.presentation) ||
        !['self_and_organizer', 'organizer_only'].includes(item.visibility) || typeof item.required !== 'boolean' ||
        typeof item.label?.en !== 'string' || item.label.en.length < 1 || item.label.en.length > 200 ||
        (item.label.sv !== undefined && (typeof item.label.sv !== 'string' || item.label.sv.length > 200)) ||
        typeof item.help?.en !== 'string' || item.help.en.length > 500 ||
        (item.help.sv !== undefined && (typeof item.help.sv !== 'string' || item.help.sv.length > 500))) {
      errors.push(`invalid question definition: ${item.id}`);
      continue;
    }
    if (item.mapping !== undefined && (item.mapping === null || typeof item.mapping !== 'object' || Object.getPrototypeOf(item.mapping) !== Object.prototype || Object.keys(item.mapping).sort().join(',') !== 'choiceValues,field,importance' || !['experience', 'role', 'skills'].includes(item.mapping.field) || !['low', 'normal', 'high'].includes(item.mapping.importance) || item.visibility === 'organizer_only' || !['self_and_organizer'].includes(item.visibility) || (item.mapping.field === 'skills' ? !['single_choice', 'multi_choice'].includes(item.kind) : item.kind !== 'single_choice') || !item.mapping.choiceValues || typeof item.mapping.choiceValues !== 'object' || Array.isArray(item.mapping.choiceValues) || Object.getPrototypeOf(item.mapping.choiceValues) !== Object.prototype || Object.values(item.mapping.choiceValues).some((value) => typeof value !== 'string'))) {
      errors.push(`private or invalid matching mapping: ${item.id}`);
      continue;
    }
    if (item.kind === 'text' && item.choices !== undefined) errors.push(`text question cannot have choices: ${item.id}`);
    if (item.kind !== 'text') {
      const choices = item.choices;
      if (!Array.isArray(choices) || choices.length < 1 || choices.length > 25 || choices.some((choice) =>
        choice === null || typeof choice !== 'object' || !/^[a-zA-Z0-9_-]{1,64}$/.test(choice.id) || typeof choice.label?.en !== 'string' || choice.label.en.length < 1 || choice.label.en.length > 200)) {
        errors.push(`invalid choices: ${item.id}`);
      } else if (new Set(choices.map((choice) => choice.id)).size !== choices.length) errors.push(`duplicate choice IDs: ${item.id}`);
    }
    if (item.mapping !== undefined) {
      const choiceIds = (item.choices ?? []).map((choice) => choice.id).sort();
      const keys = Object.keys(item.mapping.choiceValues).sort();
      const targets = item.mapping.field === 'experience' ? config?.experiences : item.mapping.field === 'role' ? config?.roleTracks : config?.skills;
      if (keys.length !== choiceIds.length || keys.some((key, i) => key !== choiceIds[i]) || (targets && Object.values(item.mapping.choiceValues).some((value) => !targets.some((target) => target.id === value))) || (item.mapping.field === 'experience' && !config && Object.values(item.mapping.choiceValues).some((value) => !['first_timer', 'some_experience', 'veteran'].includes(value)))) errors.push(`invalid choice mapping: ${item.id}`);
      if (questions.some((question) => question.mapping?.field === item.mapping!.field)) errors.push(`duplicate mapping target: ${item.mapping.field}`);
    }
    questions.push(item);
  }
  return errors.length ? { ok: false, errors } : { ok: true, questions };
}

/** Validate participant answers without coercion or truncation. */
export function validateCustomAnswers(
  config: Pick<FormConfig, 'customQuestions'>,
  raw: unknown,
): CustomAnswersResult {
  const errors: string[] = [];
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['answers must be an object'] };
  const input = raw as Record<string, unknown>;
  const definitionCheck = validateCustomQuestions(config.customQuestions ?? [], config as FormConfig);
  if (!definitionCheck.ok) return { ok: false, errors: ['invalid form question definitions'] };
  const questions = definitionCheck.questions;
  const byId = new Map(questions.map((question) => [question.id, question]));
  if (questions.length > 25) errors.push('at most 25 custom questions are allowed');
  for (const id of Object.keys(input)) if (!byId.has(id)) errors.push(`unknown question: ${id}`);
  const answers: Record<string, string | string[]> = {};
  const missingRequiredQuestionIds: string[] = [];
  for (const question of questions) {
    const value = input[question.id];
    if (value === undefined || value === null || value === '' || (typeof value === 'string' && value.trim() === '') || (Array.isArray(value) && value.length === 0)) {
      if (question.required && question.visibility !== 'organizer_only') missingRequiredQuestionIds.push(question.id);
      continue;
    }
    if (question.kind === 'text') {
      if (typeof value !== 'string' || value.length > 2000) errors.push(`invalid text answer: ${question.id}`);
      else answers[question.id] = value;
      continue;
    }
    const choices = new Set((question.choices ?? []).map((choice) => choice.id));
    if (question.kind === 'single_choice') {
      if (typeof value !== 'string' || !choices.has(value)) errors.push(`invalid choice answer: ${question.id}`);
      else answers[question.id] = value;
    } else if (!Array.isArray(value) || value.some((choice) => typeof choice !== 'string' || !choices.has(choice)) || new Set(value).size !== value.length) {
      errors.push(`invalid choice answer: ${question.id}`);
    } else answers[question.id] = value as string[];
  }
  return errors.length ? { ok: false, errors } : { ok: true, answers, missingRequiredQuestionIds };
}

export const DEFAULT_SKILLS: SkillOption[] = [
  // group "" = freely combinable (multi-select)
  { id: 'frontend_react', label: 'Frontend — React', group: 'frontend' },
  { id: 'frontend_vue', label: 'Frontend — Vue', group: 'frontend' },
  { id: 'frontend_mobile', label: 'Frontend — Mobile', label_sv: 'Frontend — Mobil', group: 'frontend' },
  { id: 'ui_design', label: 'UI/UX Design', group: '' },
  { id: 'devops', label: 'DevOps / Infra', group: '' },
  { id: 'data_ml', label: 'Data / ML', group: '' },
  { id: 'ai_integrations', label: 'AI integrations', label_sv: 'AI-integrationer', group: '' },
  { id: 'pm_pitch', label: 'PM / Pitching', group: '' },
  { id: 'backend_node', label: 'Backend — Node/TypeScript', group: 'backend' },
  { id: 'backend_python', label: 'Backend — Python', group: 'backend' },
  { id: 'backend_csharp', label: 'Backend — C#/.NET', group: 'backend' },
  { id: 'backend_go', label: 'Backend — Go', group: 'backend' },
  { id: 'backend_java', label: 'Backend — Java/Kotlin', group: 'backend' },
];

export const DEFAULT_ROLE_TRACKS = [
  { id: 'frontend', label: 'Frontend' },
  { id: 'backend', label: 'Backend' },
  { id: 'fullstack', label: 'Fullstack' },
  { id: 'design', label: 'Design' },
  { id: 'devops', label: 'DevOps' },
  { id: 'flex', label: 'Flex / wherever needed', label_sv: 'Flex / där det behövs' },
];

export const DEFAULT_FORM: FormConfig = {
  version: 1,
  title: 'Hackathon Signup',
  description: 'Tell us how you work and we will build a team around you.',
  teamSize: 4,
  experiences: [
    { id: 'first_timer', label: 'First hackathon', label_sv: 'Första hackathonet' },
    { id: 'some_experience', label: '1–3 hackathons', label_sv: '1–3 hackathons' },
    { id: 'veteran', label: 'Veteran (4+)', label_sv: 'Veteran (4+)' },
  ],
  roleTracks: DEFAULT_ROLE_TRACKS,
  skills: DEFAULT_SKILLS,
  teamPrefs: [
    { id: 'create_team', label: 'Create my own team and invite people', label_sv: 'Skapa mitt eget team och bjuda in folk' },
    { id: 'join_team', label: 'Ask to join an existing team', label_sv: 'Be om att få gå med i ett befintligt team' },
    { id: 'random_team', label: 'Get matched into a random team', label_sv: 'Bli matchad till ett slumpmässigt team' },
  ],
};

export const EXPERIENCE_IDS: Experience[] = ['first_timer', 'some_experience', 'veteran'];
export const TEAM_PREF_IDS: TeamPref[] = ['create_team', 'join_team', 'random_team'];

/** Role color palette for team creation (Discord modals have no color picker). */
export const TEAM_COLORS: { id: string; label: string; hex: string; int: number }[] = [
  { id: 'blurple', label: 'Blurple', hex: '#5865F2', int: 0x5865f2 },
  { id: 'green', label: 'Green', hex: '#3EC46D', int: 0x3ec46d },
  { id: 'orange', label: 'Orange', hex: '#F0B429', int: 0xf0b429 },
  { id: 'red', label: 'Red', hex: '#EF4444', int: 0xef4444 },
  { id: 'purple', label: 'Purple', hex: '#9B59B6', int: 0x9b59b6 },
  { id: 'cyan', label: 'Cyan', hex: '#1ABC9C', int: 0x1abc9c },
  { id: 'pink', label: 'Pink', hex: '#E91E63', int: 0xe91e63 },
];

export function teamColor(colorId: string | null): { hex: string; int: number } {
  const found = TEAM_COLORS.find((c) => c.id === colorId);
  return found ?? TEAM_COLORS[0]!;
}

/** Discord component custom_id, kept stable for the collector. */
export const MODAL_IDS = {
  signup: 'hack:signup:modal',
  name: 'hack:signup:name',
  experience: 'hack:signup:experience',
  roleTrack: 'hack:signup:role',
  skills: 'hack:signup:skills',
  teamPref: 'hack:signup:teampref',
} as const;

export interface ValidatedSignup {
  displayName: string;
  experience: Experience;
  roleTrack: string;
  skills: string[];
  teamPref: TeamPref;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Validate + normalize raw modal input against a config. Returns error strings
 * per field so the bot can show a helpful message instead of failing silently.
 */
export function validateSignupInput(
  config: FormConfig,
  raw: { displayName: string; experience: string; roleTrack: string; skills: string[]; teamPref: string },
  locale: 'en' | 'sv' = 'en',
): { ok: true; value: ValidatedSignup } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const displayName = raw.displayName.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (displayName.length < 2) errors.push(t(locale, 'form.err_name_short'));

  if (!EXPERIENCE_IDS.includes(raw.experience as Experience)) errors.push(t(locale, 'form.err_experience'));
  if (!TEAM_PREF_IDS.includes(raw.teamPref as TeamPref)) errors.push(t(locale, 'form.err_teampref'));

  const roleTrackIds = config.roleTracks.map((r) => r.id);
  const roleTrack = roleTrackIds.includes(raw.roleTrack) ? raw.roleTrack : '';
  if (roleTrack === '') errors.push(t(locale, 'form.err_role'));

  const validSkills = new Set(config.skills.map((s) => s.id));
  const skills = [...new Set(raw.skills)].filter((s) => validSkills.has(s));

  // Respect group exclusivity: max one skill per group.
  const seenGroups = new Set<string>();
  const finalSkills: string[] = [];
  for (const id of config.skills.map((s) => s.id)) {
    if (!skills.includes(id)) continue;
    const group = config.skills.find((s) => s.id === id)?.group ?? '';
    if (group !== '') {
      if (seenGroups.has(group)) continue;
      seenGroups.add(group);
    }
    finalSkills.push(id);
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      displayName,
      experience: raw.experience as Experience,
      roleTrack: roleTrack,
      skills: finalSkills,
      teamPref: raw.teamPref as TeamPref,
    },
  };
}

/** Replace the option lists while keeping the shape sane. Used by admin UI. */
export function normalizeFormUpdate(current: FormConfig, update: Partial<FormConfig>): FormConfig {
  const next: FormConfig = { ...current, ...update };

  if (typeof next.teamSize !== 'number' || !Number.isInteger(next.teamSize)) next.teamSize = current.teamSize;
  next.teamSize = Math.min(Math.max(next.teamSize, 2), 25);

  next.title = (next.title ?? '').trim().slice(0, 45) || current.title;
  next.description = (next.description ?? '').trim().slice(0, 300);

  const cleanList = <T extends { id: string; label: string }>(list: T[], fallback: T[]): T[] => {
    if (!Array.isArray(list)) return fallback;
    const out: T[] = [];
    const seen = new Set<string>();
    for (const item of list) {
      const id = slug(String(item?.id ?? '')).slice(0, 40);
      const label = String(item?.label ?? '').trim().slice(0, 80);
      if (id === '' || label === '' || seen.has(id)) continue;
      seen.add(id);
      out.push({ ...item, id, label });
    }
    return out.length >= 1 ? out : fallback;
  };

  next.experiences = cleanList(next.experiences, DEFAULT_FORM.experiences) as FormConfig['experiences'];
  next.roleTracks = cleanList(next.roleTracks, DEFAULT_FORM.roleTracks);
  next.teamPrefs = cleanList(next.teamPrefs, DEFAULT_FORM.teamPrefs) as FormConfig['teamPrefs'];

  if (!Array.isArray(next.skills)) {
    next.skills = current.skills;
  } else {
    const out: SkillOption[] = [];
    const seen = new Set<string>();
    for (const s of next.skills) {
      const id = slug(String(s?.id ?? '')).slice(0, 40);
      const label = String(s?.label ?? '').trim().slice(0, 80);
      const group = slug(String(s?.group ?? '')).slice(0, 40);
      if (id === '' || label === '' || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, label, group });
    }
    if (out.length >= 1) next.skills = out;
    else next.skills = current.skills;
  }

  next.version = Math.max(1, Math.floor(Number(next.version) || current.version));
  return next;
}

export function labelFor(config: FormConfig, list: 'experiences' | 'roleTracks' | 'skills' | 'teamPrefs', id: string): string {
  const found = config[list].find((item) => item.id === id);
  return found?.label ?? id;
}

/** Like labelFor but prefers the Swedish label when one exists (bot locale sv). */
export function labelForLocale(
  config: FormConfig,
  list: 'experiences' | 'roleTracks' | 'skills' | 'teamPrefs',
  id: string,
  locale: 'en' | 'sv' = 'en',
): string {
  const found = config[list].find((item) => item.id === id);
  if (found === undefined) return id;
  if (locale === 'sv') return found.label_sv ?? found.label;
  return found.label;
}
