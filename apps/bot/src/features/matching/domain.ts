/**
 * Compatibility scoring + team formation. Pure functions, deterministic.
 *
 * Model:
 *  - Pairwise score 0..100 based on skill complementarity, role-track mix and
 *    experience spread.
 *  - Mutual friend mentions are HARD constraints (must be on the same team),
 *    unless the friend group is larger than teamSize — then they degrade to a
 *    very strong soft pull and the conflict is reported.
 *  - One-directional mentions are a strong soft pull.
 *  - Greedy agglomerative: friend groups seed teams, then the globally best
 *    (team, candidate) pairing is chosen repeatedly.
 */
import type { FormConfig } from '../form/domain.js';
import type { Participant } from '../signup/data.js';

const EXP_LEVEL: Record<string, number> = {
  first_timer: 0,
  some_experience: 1,
  veteran: 2,
};

export interface MatchTeam {
  name: string;
  memberIds: string[];
  score: number;
  notes: string[];
}

export interface MatchResult {
  teams: MatchTeam[];
  /** Mentioned-but-split friendships and oversized friend groups. */
  conflicts: string[];
}

const COMPLEMENTARY: string[][] = [
  ['frontend', 'backend'],
  ['frontend', 'design'],
  ['backend', 'design'],
  ['devops', 'frontend'],
  ['devops', 'backend'],
  ['fullstack', 'design'],
  ['fullstack', 'devops'],
];

export function scorePair(a: Participant, b: Participant): number {
  let score = 50;

  // Skill overlap: shared skills help collaboration.
  const shared = a.skills.filter((s) => b.skills.includes(s));
  score += Math.min(shared.length * 8, 24);

  // Group diversity between the two.
  const aGroups = new Set(a.skills.map((s) => skillGroup(s)));
  const bGroups = new Set(b.skills.map((s) => skillGroup(s)));
  const diverse = [...aGroups].filter((g) => !bGroups.has(g) && g !== '').length;
  score += Math.min(diverse * 4, 12);

  // Role track mix.
  if (a.roleTrack === b.roleTrack) {
    score += 5;
  } else if (COMPLEMENTARY.some(([x, y]) => (a.roleTrack === x && b.roleTrack === y) || (a.roleTrack === y && b.roleTrack === x))) {
    score += 9;
  }

  // Experience spread: adjacent levels mix best (mentorship without a gap).
  const la = EXP_LEVEL[a.experience] ?? 1;
  const lb = EXP_LEVEL[b.experience] ?? 1;
  const diff = Math.abs(la - lb);
  if (diff === 1) score += 6;
  else if (diff === 0) score += 3;

  // Friend pulls.
  if (a.teammates.includes(b.userId) && b.teammates.includes(a.userId)) {
    score += 100; // effectively hard; also enforced structurally
  } else if (a.teammates.includes(b.userId) || b.teammates.includes(a.userId)) {
    score += 25;
  }

  return Math.max(0, Math.min(100, score));
}

/** Group is encoded in the skill id prefix (backend_x, frontend_y); '' skills are standalone. */
function skillGroup(skillId: string): string {
  const idx = skillId.indexOf('_');
  return idx === -1 ? '' : skillId.slice(0, idx);
}

function teamScore(members: Participant[]): number {
  if (members.length <= 1) return 0;
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      total += scorePair(members[i]!, members[j]!);
      pairs++;
    }
  }
  return Math.round(total / pairs);
}

interface Seed {
  memberIds: string[];
}

/** Union-find over mutual friend mentions. Returns groups that are >1 person. */
function friendGroups(participants: Participant[], byId: Map<string, Participant>): Seed[] {
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    return root;
  };
  const union = (x: string, y: string): void => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  };
  for (const p of participants) {
    parent.set(p.userId, p.userId);
  }
  for (const p of participants) {
    for (const tid of p.teammates) {
      if (byId.has(tid) && p.userId < tid) {
        const other = byId.get(tid)!;
        if (other.teammates.includes(p.userId)) union(p.userId, tid);
      }
    }
  }
  const groups = new Map<string, string[]>();
  for (const p of participants) {
    const root = find(p.userId);
    const list = groups.get(root) ?? [];
    list.push(p.userId);
    groups.set(root, list);
  }
  return [...groups.values()]
    .filter((ids) => ids.length > 1)
    .sort((a, b) => a.join(',').localeCompare(b.join(',')))
    .map((ids) => ({ memberIds: ids }));
}

const TEAM_NAMES = [
  'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel',
  'India', 'Juliett', 'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa',
  'Quebec', 'Romeo', 'Sierra', 'Tango', 'Uniform', 'Victor', 'Whiskey',
  'X-ray', 'Yankee', 'Zulu',
];

export function buildTeams(participants: Participant[], config: FormConfig): MatchResult {
  const teamSize = config.teamSize;
  const byId = new Map(participants.map((p) => [p.userId, p]));
  const conflicts: string[] = [];

  // 1) Friend groups. Oversized ones degrade to soft and are reported.
  const seeds: Participant[][] = [];
  const seeded = new Set<string>();
  for (const group of friendGroups(participants, byId)) {
    if (group.memberIds.length <= teamSize) {
      seeds.push(group.memberIds.map((id) => byId.get(id)!));
      for (const id of group.memberIds) seeded.add(id);
    } else {
      conflicts.push(
        `Friend group of ${group.memberIds.length} people is larger than team size ${teamSize}; treated as a preference, not a guarantee.`,
      );
    }
  }

  // 2) Candidates: everyone not seeded, in stable order.
  const candidates = participants
    .filter((p) => !seeded.has(p.userId))
    .sort((a, b) => a.createdAt - b.createdAt || a.userId.localeCompare(b.userId));

  // 3) Greedy: repeatedly place the globally best (team, candidate) pair.
  const teams: Participant[][] = seeds.map((members) => [...members]);
  while (teams.length < 1 || candidates.length > 0) {
    let best: { teamIdx: number; candIdx: number; score: number } | null = null;
    for (let t = 0; t < teams.length; t++) {
      if (teams[t]!.length >= teamSize) continue;
      for (let c = 0; c < candidates.length; c++) {
        const memberScores = teams[t]!.map((m) => scorePair(m, candidates[c]!));
        const avg = memberScores.reduce((s, v) => s + v, 0) / memberScores.length;
        const tie = best === null ? 1 : 0;
        if (tie || avg > best!.score) {
          best = { teamIdx: t, candIdx: c, score: avg };
        }
      }
    }
    if (best === null) {
      // No open team with space: start a new one with the first remaining candidate.
      const next = candidates.shift()!;
      teams.push([next]);
      continue;
    }
    const chosen = candidates.splice(best.candIdx, 1)[0]!;
    teams[best.teamIdx]!.push(chosen);
  }

  // 4) Report.
  const result: MatchTeam[] = teams.map((members, i) => ({
    name: `Team ${TEAM_NAMES[i % TEAM_NAMES.length]}${i >= TEAM_NAMES.length ? ` ${Math.floor(i / TEAM_NAMES.length) + 1}` : ''}`,
    memberIds: members.map((m) => m.userId),
    score: teamScore(members),
    notes: [],
  }));

  // Flag one-directional friend mentions that got split across teams.
  const placement = new Map<string, string>();
  for (const t of result) for (const id of t.memberIds) placement.set(id, t.name);
  for (const p of participants) {
    for (const tid of p.teammates) {
      const other = byId.get(tid);
      if (other === undefined) continue;
      const mutual = other.teammates.includes(p.userId);
      if (!mutual && placement.get(p.userId) !== placement.get(tid)) {
        const t = result.find((t) => t.memberIds.includes(p.userId));
        t?.notes.push(`${p.displayName} mentioned ${other.displayName}, but they landed on different teams.`);
        conflicts.push(`${p.displayName} → ${other.displayName} (one-way mention) split across teams.`);
      }
    }
  }

  return { teams: result, conflicts };
}
