import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ParticipantFrame } from '@/components/participant-appearance'
import type { FormAppearance } from '@/types'
import { useT } from '@/lib/i18n'

export const Route = createFileRoute('/events/$eventId/')({ component: EventLanding })

type EventDetails = {
  event: { id: string; name: string; description: string; startsAt: number | null; endsAt: number | null }
  form: { appearance: FormAppearance }
}

function EventLanding() {
  const { eventId } = Route.useParams()
  const t = useT()
  const [details, setDetails] = useState<EventDetails | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    fetch(`/api/public/events/${encodeURIComponent(eventId)}`)
      .then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<EventDetails> })
      .then(value => { if (active) setDetails(value) })
      .catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [eventId])
  if (!details) return <main className="mx-auto max-w-2xl p-8">{error ? <><p role="alert">{t('participant.signup_unavailable')}</p><Button onClick={() => location.reload()}>{t('participant.retry')}</Button></> : <p aria-busy="true">{t('participant.signup_loading')}</p>}</main>
  const language = localStorage.getItem('chas-locale') === 'sv' ? 'sv-SE' : 'en-US'
  return <ParticipantFrame appearance={details.form.appearance} portalTheme>
    <article className={details.event.startsAt || details.event.endsAt ? 'grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]' : 'max-w-3xl space-y-8'}>
      <div className="space-y-6">
        <h1 className="text-3xl font-bold sm:text-5xl">{details.event.name}</h1>
        <p className="max-w-prose whitespace-pre-wrap text-base leading-relaxed">{details.event.description}</p>
        <Button asChild size="lg" className="min-h-11"><a href={`/events/${encodeURIComponent(eventId)}/signup`}>{t('participant.signup_action')}</a></Button>
      </div>
      {(details.event.startsAt || details.event.endsAt) && <aside className="h-fit space-y-4 rounded-xl border p-5">
        <h2 className="text-lg font-semibold">{t('participant.signup_details')}</h2>
        {details.event.startsAt && <p><strong>{t('participant.event_starts')}</strong><br /><time dateTime={new Date(details.event.startsAt).toISOString()}>{new Date(details.event.startsAt).toLocaleString(language)}</time></p>}
        {details.event.endsAt && <p><strong>{t('participant.event_ends')}</strong><br /><time dateTime={new Date(details.event.endsAt).toISOString()}>{new Date(details.event.endsAt).toLocaleString(language)}</time></p>}
      </aside>}
    </article>
  </ParticipantFrame>
}
