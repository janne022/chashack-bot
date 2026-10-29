import { CalendarDays, ClipboardCheck, FileText, List, Users } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useT } from '@/lib/i18n'

export function ParticipantNavigation({ eventId, active }: { eventId: string; active: 'overview' | 'signup' | 'team' | 'schedule' | 'submission' }) {
  const t = useT()
  const items = [
    { id: 'overview', label: t('participant.overview'), icon: CalendarDays },
    { id: 'signup', label: t('participant.registration'), icon: ClipboardCheck },
    { id: 'submission', label: t('submission.title'), icon: FileText },
    { id: 'team', label: t('participant.team_title'), icon: Users },
    { id: 'schedule', label: t('participant.schedule_tab'), icon: List },
  ]
  return <nav className="participant-tabs" aria-label={t('participant.signup_navigation')}>
    {items.map(({ id, label, icon: Icon }) => {
      const state = <><Icon aria-hidden="true" size={18} />{label}</>
      const ariaCurrent = active === id ? 'page' as const : undefined
      if (id === 'signup') return <Link key={id} activeOptions={{ exact: true, explicitUndefined: true }} to="/events/$eventId/signup" params={{ eventId }} aria-current={ariaCurrent}>{state}</Link>
      if (id === 'team') return <Link key={id} activeOptions={{ exact: true, explicitUndefined: true }} to="/team" search={{ eventId }} aria-current={ariaCurrent}>{state}</Link>
      const view = id === 'schedule' || id === 'submission' ? id : undefined
      return <Link key={id} activeOptions={{ exact: true, explicitUndefined: true }} to="/events/$eventId" params={{ eventId }} search={{ view }} aria-current={ariaCurrent}>{state}</Link>
    })}
  </nav>
}
