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
  roleId: string | null
  textChannelId: string | null
  voiceChannelId: string | null
  colorId: string | null
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

export interface TeamSuggestion {
  teamId: string
  teamName: string
  score: number
}

export interface Stats {
  signups: number
  active: number
  blocked: number
  unteamed: number
  matchingOptIn: number
  teams: number
}

export interface HackathonEvent {
  id: string
  guildId: string
  name: string
  description: string
  startsAt: number | null
  endsAt: number | null
  status: 'draft' | 'active' | 'ended'
  formJson: string | null
  panelChannelId: string | null
  categoryId: string | null
  cleanupDelayHours: number
  cleanupDone: boolean
  reminded24h: boolean
  matchAt: number | null
  matchLocked: boolean
  discordEventIds: string[]
  createdAt: number
  updatedAt: number
}

export interface EventTemplate {
  id: string
  guildId: string | null
  name: string
  kind: 'event' | 'form'
  json: string
  createdAt: number
}

export interface AppState {
  participants: Participant[]
  teams: Team[]
  config: FormConfig
  audit: AuditEntry[]
  lastMatch: { at: number; teams: number } | null
  guildSettings: { teamCategoryId: string | null }
  events: HackathonEvent[]
  templates: EventTemplate[]
  activeEventId: string | null
  stats: Stats
}

export const TEAM_COLOR_SWATCHES: { id: string; label: string; hex: string }[] = [
  { id: 'blurple', label: 'Blurple', hex: '#5865F2' },
  { id: 'green', label: 'Green', hex: '#3EC46D' },
  { id: 'orange', label: 'Orange', hex: '#F0B429' },
  { id: 'red', label: 'Red', hex: '#EF4444' },
  { id: 'purple', label: 'Purple', hex: '#9B59B6' },
  { id: 'cyan', label: 'Cyan', hex: '#1ABC9C' },
  { id: 'pink', label: 'Pink', hex: '#E91E63' },
]
