/** Shared API types (mirror of bot's DB shapes). */

export type ParticipantStatus = 'active' | 'blocked' | 'withdrawn'

export interface Participant {
  userId: string
  displayName: string
  experience: string
  roleTrack: string
  skills: string[]
  teamPref: string
  teammates: string[]
  teamId: string | null
  status: ParticipantStatus
  blockReason: string | null
  createdAt: number
  updatedAt: number
}

export interface TeamMember {
  userId: string
  displayName: string
  roleTrack: string
  experience: string
  skills: string[]
}

export interface Team {
  id: string
  name: string
  kind: 'public' | 'private' | 'matched'
  ownerId: string | null
  joinCode: string | null
  createdAt: number
  members: TeamMember[]
}

export interface SkillOption {
  id: string
  label: string
  group: string
}

export interface FormConfig {
  version: number
  title: string
  description: string
  teamSize: number
  experiences: { id: string; label: string }[]
  roleTracks: { id: string; label: string }[]
  skills: SkillOption[]
  teamPrefs: { id: string; label: string }[]
}

export interface AuditEntry {
  id: number
  ts: number
  actor: string
  action: string
  target: string | null
  details: string | null
}

export interface MatchTeam {
  name: string
  memberIds: string[]
  score: number
  notes: string[]
}

export interface MatchResult {
  teams: MatchTeam[]
  conflicts: string[]
}

export interface Stats {
  signups: number
  active: number
  blocked: number
  unteamed: number
  matchingOptIn: number
  teams: number
}

export interface AppState {
  participants: Participant[]
  teams: Team[]
  config: FormConfig
  audit: AuditEntry[]
  lastMatch: { at: number; teams: number } | null
  stats: Stats
}
