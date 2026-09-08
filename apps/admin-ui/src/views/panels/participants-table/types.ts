import type { Participant } from '@/types'
import type { Team } from '@/types'

/** Status actions the row dropdown can fire (block goes through the confirm dialog instead). */
export type ParticipantAction = 'unblock' | 'withdraw' | 'reactivate'

/**
 * Handler table passed into cell/header templates via TanStack Table's
 * `meta` option. Its shape is declared through the v9 `tableMeta` type-only
 * slot on the features object (see features.ts) — the value is phantom.
 */
export interface ParticipantsTableMeta {
  /** Teams available for the inline reassign Select. */
  teams: Team[]
  /** Reassign a participant to a team (null = kick off current team). */
  assignTeam: (userId: string, teamId: string | null) => void
  /** Open the block confirmation dialog for a participant. */
  onBlockRequest: (participant: Participant) => void
  /** Run a status action (unblock / withdraw / reactivate). */
  onAction: (participant: Participant, action: ParticipantAction) => void
}
