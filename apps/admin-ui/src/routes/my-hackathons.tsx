import { PageSkeleton } from '@/components/ui/skeleton'
import { ArrowUpRight, CheckCircle2, Users, CalendarDays } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ParticipantFrame } from '@/components/participant-appearance'
import { useLocale, useT } from '@/lib/i18n'
import { LiveStatus, useLiveUpdates } from '@/lib/live-updates'

type Registration = { eventId: string; name: string; description: string; startsAt: number | null; endsAt: number | null; status: string; teamId: string | null; complete?: boolean }
export const Route = createFileRoute('/my-hackathons')({ component: MyHackathons })
function MyHackathons() {
  const t = useT()
  const locale = useLocale()
  const [items, setItems] = useState<Registration[] | null>(null)
  const [error, setError] = useState('')
  const load = async (signal?: AbortSignal) => {
    setError('')
    try {
      const response = await fetch('/api/participant/registrations', signal ? { signal } : undefined)
      if (signal?.aborted) return
      if (response.status === 401) { location.assign('/auth/participant'); return }
      if (!response.ok) throw new Error(t('participant.my_error'))
      const registrations = (await response.json() as { registrations: Registration[] }).registrations
      const next = await Promise.all(registrations.map(async (item) => {
        const detail = await fetch(`/api/participant/events/${encodeURIComponent(item.eventId)}/registration`, signal ? { signal } : undefined)
        if (!detail.ok) return item
        return { ...item, complete: (await detail.json() as { complete: boolean }).complete }
      }))
      if (!signal?.aborted) setItems(next)
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : t('participant.my_error')) }
  }
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [])
  const live = useLiveUpdates(items !== null ? '/api/participant/live' : null, load)
  return <ParticipantFrame appearance={{ themePreset: 'default', accentColor: '#55bbda', bannerUrl: null }}><div className="space-y-8"><header className="participant-hero"><p className="mb-4 text-sm font-semibold opacity-65">{t('participant.my_title')}</p><h1 className="participant-title max-w-xl">{t('participant.your_events')}</h1><p className="text-muted-foreground">{t('participant.my_desc')}</p></header>
    <LiveStatus {...live} />
    {error && items !== null && <p role="alert">{error}</p>}
    {items === null ? error ? <section role="alert" className="space-y-3"><p>{error}</p><Button onClick={() => void load()}>{t('participant.retry')}</Button></section> : <PageSkeleton /> : items.length === 0 ? <section className="rounded-xl border border-dashed p-6"><h2 className="text-lg font-semibold">{t('participant.my_empty')}</h2><p className="mt-2 text-muted-foreground">{t('participant.my_empty_desc')}</p><a className="mt-4 inline-flex min-h-11 items-center text-accent underline" href="https://discord.com/channels/@me">{t('participant.open_discord')}</a></section> : <ul className="grid gap-6 md:grid-cols-2">{items.map((item) => <li key={item.eventId} className="participant-event-card">
      <div className="flex items-center justify-between gap-3 text-sm"><span className="participant-pill">{item.status === 'active' ? t('participant.active') : item.status}</span><CalendarDays size={20} aria-hidden="true" /></div>
      <h2 className="mt-7 text-2xl font-semibold tracking-tight">{item.name}</h2>
      <p className="mt-3 line-clamp-3 text-sm leading-relaxed opacity-75">{item.description}</p>
      {item.startsAt && <p className="mt-5 text-sm font-medium">{new Intl.DateTimeFormat(locale === 'sv' ? 'sv-SE' : 'en-US', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(item.startsAt))}</p>}
      <div className="my-6 grid grid-cols-2 gap-3 border-y py-4 text-sm"><p className="flex items-center gap-2"><CheckCircle2 size={17} aria-hidden="true" />{item.complete === undefined ? t('participant.signup_unknown') : item.complete ? t('participant.saved') : t('participant.signup_pending')}</p><p className="flex items-center gap-2"><Users size={17} aria-hidden="true" />{item.teamId ? t('participant.has_team') : t('participant.no_team')}</p></div>
      <div className="mt-auto flex flex-wrap gap-3"><Button asChild className="min-h-11"><a href={`/events/${encodeURIComponent(item.eventId)}/signup`}>{item.complete ? t('participant.view_signup') : t('participant.signup_pending')}<ArrowUpRight aria-hidden="true" size={16} /></a></Button><Button asChild variant="outline" className="min-h-11"><a href={`/team?eventId=${encodeURIComponent(item.eventId)}`}>{item.teamId ? t('participant.view_team') : t('participant.team_browse')}</a></Button></div>
    </li>)}</ul>}
  </div></ParticipantFrame>
}
