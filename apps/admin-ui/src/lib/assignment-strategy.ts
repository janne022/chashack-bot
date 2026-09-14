import { Shuffle, Copy } from 'lucide-react'
import type { AssignmentStrategy } from '@/types'

/**
 * How an event's assignment pool is dealt out to teams. Shared by the event
 * template editor and the create-event dialog so both offer the same choices.
 */
export const STRATEGY_OPTIONS: {
  id: AssignmentStrategy
  label: string
  hint: string
  icon: typeof Shuffle
}[] = [
  {
    id: 'random',
    label: 'Random per team',
    hint: 'Shuffle the pool and deal a distinct assignment to each team (wraps if fewer assignments than teams).',
    icon: Shuffle,
  },
  {
    id: 'same',
    label: 'Same for all',
    hint: 'Every team gets the first assignment in the list.',
    icon: Copy,
  },
]
