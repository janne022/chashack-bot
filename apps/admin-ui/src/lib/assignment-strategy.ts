import { Shuffle, Copy } from 'lucide-react'
import type { AssignmentStrategy } from '@/types'

/**
 * How an event's assignment pool is dealt out to teams. Shared by the event
 * template editor and the create-event dialog so both offer the same choices.
 */
export const STRATEGY_OPTIONS: {
  id: AssignmentStrategy
  labelKey: string
  hintKey: string
  icon: typeof Shuffle
}[] = [
  {
    id: 'random',
    labelKey: 'assignment.random',
    hintKey: 'assignment.random_hint',
    icon: Shuffle,
  },
  {
    id: 'same',
    labelKey: 'assignment.same',
    hintKey: 'assignment.same_hint',
    icon: Copy,
  },
]
