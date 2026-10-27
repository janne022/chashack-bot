import { ParticipantNavigation } from '@/components/participant-navigation'
import { PageSkeleton } from '@/components/ui/skeleton'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ParticipantFrame } from '@/components/participant-appearance'
import { useT } from '@/lib/i18n'
import { useLocale } from '@/lib/i18n'
import { LiveStatus, useLiveUpdates } from '@/lib/live-updates'
import { publicEventQuery } from '@/lib/public-event'
import { ParticipantSubmission } from '@/components/ParticipantSubmission'

export const Route = createFileRoute('/events/$eventId/')({ component: EventLanding })

function EventLanding() {
  const { eventId } = Route.useParams()
  const t = useT()
  const locale = useLocale()
  const view = new URLSearchParams(window.location.search).get('view')
  // The signup page reads the same cache entry, so moving between the overview
  // and the form does not download the event twice.
  const details = useQuery(publicEventQuery(eventId))
  const reload = () => void details.refetch()
  if (!details.data) return <main className="mx-auto max-w-2xl p-8">{details.isError ? <><p role="alert">{t('participant.signup_unavailable')}</p><Button onClick={reload}>{t('participant.retry')}</Button></> : <PageSkeleton />}</main>
  const language = locale === 'sv' ? 'sv-SE' : 'en-US'
  const event = details.data
  return <ParticipantFrame appearance={event.form.appearance}><ParticipantNavigation eventId={eventId} active={view === 'schedule' ? 'schedule' : view === 'submission' ? 'submission' : 'overview'} />
    {view === 'schedule' ? <ParticipantSchedule eventId={eventId} locale={language} /> : view === 'submission' ? <ParticipantSubmission eventId={eventId} /> :
    <article className={event.event.startsAt || event.event.endsAt ? 'grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]' : 'max-w-3xl space-y-8'}>
      <div className="space-y-6">
        <h1 className="text-3xl font-bold sm:text-5xl">{event.event.name}</h1>
        <p className="max-w-prose whitespace-pre-wrap text-base leading-relaxed">{event.event.description}</p>
        <Button asChild size="lg" className="min-h-11"><a href={`/events/${encodeURIComponent(eventId)}/signup`}>{t('participant.signup_action')}</a></Button>
      </div>
      {(event.event.startsAt || event.event.endsAt) && <aside className="h-fit space-y-4 rounded-xl border p-5">
        <h2 className="text-lg font-semibold">{t('participant.signup_details')}</h2>
        {event.event.startsAt && <p><strong>{t('participant.event_starts')}</strong><br /><time dateTime={new Date(event.event.startsAt).toISOString()}>{new Date(event.event.startsAt).toLocaleString(language)}</time></p>}
        {event.event.endsAt && <p><strong>{t('participant.event_ends')}</strong><br /><time dateTime={new Date(event.event.endsAt).toISOString()}>{new Date(event.event.endsAt).toLocaleString(language)}</time></p>}
      </aside>}
    </article>}
  </ParticipantFrame>
}

type ScheduleItem = { id: string; time: number; title: string; description?: string }

function ParticipantSchedule({ eventId, locale }: { eventId: string; locale: string }) {
  const t = useT()
  const [items, setItems] = useState<ScheduleItem[] | null>(null)
  const [error, setError] = useState('')
  const [signIn, setSignIn] = useState(false)
  const url = `/api/participant/events/${encodeURIComponent(eventId)}`
  const load = async (signal?: AbortSignal) => {
    try {
      const response = await fetch(`${url}/schedule`, { signal })
      if (signal?.aborted) return
      if (response.status === 401) { setSignIn(true); setError(''); return }
      if (!response.ok) throw new Error(response.status === 404 ? t('participant.schedule_access') : t('participant.schedule_error'))
      const data = await response.json() as { schedule: ScheduleItem[] }
      if (!signal?.aborted) { setItems(data.schedule); setSignIn(false); setError('') }
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : t('participant.schedule_error')) }
  }
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [eventId])
  const live = useLiveUpdates(items ? `${url}/live` : null, load)
  return <section className="max-w-3xl space-y-6">
    <LiveStatus {...live} />
    <h1 className="participant-title">{t('participant.schedule_tab')}</h1>
    {signIn ? <div className="space-y-3"><p>{t('participant.signup_login_desc')}</p><Button onClick={() => location.assign('/auth/participant')}>{t('participant.signup_continue')}</Button></div> :
      error ? <div role="alert" className="space-y-3"><p>{error}</p><Button variant="outline" onClick={() => void load()}>{t('participant.retry')}</Button></div> :
      items === null ? <PageSkeleton /> : items.length === 0 ? <p className="rounded-xl border border-dashed p-6">{t('participant.schedule_empty')}</p> :
      <ol className="space-y-3">{items.map(item => <li key={item.id} className="rounded-xl border bg-card p-5">
        <time className="text-sm font-medium text-muted-foreground" dateTime={new Date(item.time).toISOString()}>{new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short' }).format(item.time)}</time>
        <h2 className="mt-2 text-lg font-semibold">{item.title}</h2>
        {item.description && <p className="mt-2 whitespace-pre-wrap text-sm">{item.description}</p>}
      </li>)}</ol>}
  </section>
}
