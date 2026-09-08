/**
 * Form config domain: what the signup form asks, admin-editable.
 * Stored as JSON in form_config (single row). Pure data + validation.
 */

export type Experience = 'first_timer' | 'some_experience' | 'veteran';
/** How the participant wants to find their team. */
export type TeamPref = 'create_team' | 'join_team' | 'random_team';
export type TeamKind = 'public' | 'private';

export interface SkillOption {
  id: string;
  label: string;
  /** Stack group: skills within a group are mutually exclusive (e.g. backend languages). */
  group: string;
}

export interface FormConfig {
  version: number;
  title: string;
  description: string;
  /** Max members per matched or joined team. */
  teamSize: number;
  experiences: { id: Experience; label: string }[];
  roleTracks: { id: string; label: string }[];
  skills: SkillOption[];
  teamPrefs: { id: TeamPref; label: string }[];
}

export const DEFAULT_SKILLS: SkillOption[] = [
  // group "" = freely combinable (multi-select)
  { id: 'frontend_react', label: 'Frontend — React', group: 'frontend' },
  { id: 'frontend_vue', label: 'Frontend — Vue', group: 'frontend' },
  { id: 'frontend_mobile', label: 'Frontend — Mobile', group: 'frontend' },
  { id: 'ui_design', label: 'UI/UX Design', group: '' },
  { id: 'devops', label: 'DevOps / Infra', group: '' },
  { id: 'data_ml', label: 'Data / ML', group: '' },
  { id: 'ai_integrations', label: 'AI integrations', group: '' },
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
  { id: 'flex', label: 'Flex / wherever needed' },
];

export const DEFAULT_FORM: FormConfig = {
  version: 1,
  title: 'Hackathon Signup',
  description: 'Tell us how you work and we will build a team around you.',
  teamSize: 4,
  experiences: [
    { id: 'first_timer', label: 'First hackathon' },
    { id: 'some_experience', label: '1–3 hackathons' },
    { id: 'veteran', label: 'Veteran (4+)' },
  ],
  roleTracks: DEFAULT_ROLE_TRACKS,
  skills: DEFAULT_SKILLS,
  teamPrefs: [
    { id: 'create_team', label: 'Create my own team and invite people' },
    { id: 'join_team', label: 'Ask to join an existing team' },
    { id: 'random_team', label: 'Get matched into a random team' },
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
): { ok: true; value: ValidatedSignup } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const displayName = raw.displayName.trim().replace(/\s+/g, ' ').slice(0, 60);
  if (displayName.length < 2) errors.push('Name must be at least 2 characters.');

  if (!EXPERIENCE_IDS.includes(raw.experience as Experience)) errors.push('Pick an experience level.');
  if (!TEAM_PREF_IDS.includes(raw.teamPref as TeamPref)) errors.push('Pick a team preference.');

  const roleTrackIds = config.roleTracks.map((r) => r.id);
  const roleTrack = roleTrackIds.includes(raw.roleTrack) ? raw.roleTrack : '';
  if (roleTrack === '') errors.push('Pick a role track.');

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
