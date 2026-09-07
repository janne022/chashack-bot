import type { FormConfig, Participant, Team } from '@/types'
import { Badge } from '@/components/ui/badge'

export function labelFor(config: FormConfig, list: 'experiences' | 'roleTracks' | 'skills' | 'teamPrefs', id: string): string {
  const found = config[list].find((item) => item.id === id)
  return found?.label ?? id
}

export function StatusBadge({ status }: { status: Participant['status'] }) {
  switch (status) {
    case 'active':
      return <Badge variant="success">active</Badge>
    case 'blocked':
      return <Badge variant="destructive">blocked</Badge>
    case 'withdrawn':
      return <Badge variant="secondary">withdrawn</Badge>
  }
}

export function TeamKindBadge({ kind }: { kind: Team['kind'] }) {
  switch (kind) {
    case 'public':
      return <Badge variant="default">public</Badge>
    case 'private':
      return <Badge variant="warning">private</Badge>
    case 'matched':
      return <Badge variant="success">matched</Badge>
  }
}

export function teamName(teams: Team[], teamId: string | null): string {
  if (teamId === null) return '—'
  return teams.find((t) => t.id === teamId)?.name ?? 'unknown'
}
