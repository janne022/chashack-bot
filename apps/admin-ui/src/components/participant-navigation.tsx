import { CalendarDays, ClipboardCheck, FileText, List, Users } from 'lucide-react'
import { useT } from '@/lib/i18n'

export function ParticipantNavigation({ eventId, active }: { eventId: string; active: 'overview' | 'signup' | 'team' | 'schedule' | 'submission' }) {
  const t = useT()
  const root = `/events/${encodeURIComponent(eventId)}`
  const items = [
    { id: 'overview', href: root, label: t('participant.overview'), icon: CalendarDays },
    { id: 'signup', href: `${root}/signup`, label: t('participant.registration'), icon: ClipboardCheck },
    { id: 'submission', href: `${root}?view=submission`, label: t('submission.title'), icon: FileText },
    { id: 'team', href: `/team?eventId=${encodeURIComponent(eventId)}`, label: t('participant.team_title'), icon: Users },
    { id: 'schedule', href: `${root}?view=schedule`, label: t('participant.schedule_tab'), icon: List },
  ]
  return <nav className="participant-tabs" aria-label={t('participant.signup_navigation')}>
    {items.map(({ id, href, label, icon: Icon }) => <a key={id} href={href} aria-current={active === id ? 'page' : undefined}><Icon aria-hidden="true" size={18} />{label}</a>)}
  </nav>
}
