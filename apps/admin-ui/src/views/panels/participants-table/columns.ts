import type { ColumnDef } from '@tanstack/react-table'
import type { Participant } from '@/types'
import type { ParticipantsFeatures } from './features'

/**
 * Column meta for the participants table, declared through the v9
 * `columnMeta` type-only slot (see features.ts) so cell/header templates get
 * full typing without global declaration merging.
 */
export interface ParticipantsColumnMeta {
  /** Reserved for per-column flags (none needed yet). */
  align?: 'left' | 'right'
}

export type ParticipantsColumnDef = ColumnDef<ParticipantsFeatures, Participant>

/**
 * Column ids for the display-only columns — they carry no accessor, so
 * sorting is automatically disabled for them (v9 gates sorting on
 * `accessorFn` presence).
 */
export const PARTICIPANTS_ACTIONS_COLUMN_ID = 'actions'
export const PARTICIPANTS_TEAM_COLUMN_ID = 'team'
