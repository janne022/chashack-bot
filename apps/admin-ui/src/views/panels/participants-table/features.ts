import {
  createCoreRowModel,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
} from '@tanstack/react-table'
import type { ParticipantsTableMeta } from './types'

/**
 * Feature set for the participants table (TanStack Table v9).
 *
 * v9 composes a table from explicitly registered features, built statically
 * outside the component per library guidance. Registered here:
 * - `rowSortingFeature` — sorting state, column APIs and toggle handlers
 * - `coreRowModel` / `sortedRowModel` — the row-model pipeline factories
 *   (getCoreRowModel + getSortedRowModel)
 * - `sortFns` — the string comparators the auto-resolved sort functions for
 *   the Name/Joined columns resolve to (text + alphanumeric)
 * - `tableMeta` — type-only slot declaring the `meta` option shape
 */
export const participantsFeatures = tableFeatures({
  rowSortingFeature,
  coreRowModel: createCoreRowModel(),
  sortedRowModel: createSortedRowModel(),
  sortFns: { text: sortFn_text, alphanumeric: sortFn_alphanumeric },
  tableMeta: {} as ParticipantsTableMeta,
})

export type ParticipantsFeatures = typeof participantsFeatures
