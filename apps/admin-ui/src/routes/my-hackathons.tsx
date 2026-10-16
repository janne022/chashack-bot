import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useLocale, useT } from '@/lib/i18n'

type Registration = { eventId: string; name: string; description: string; startsAt: number | null; endsAt: number | null; status: string; teamId: string | null; complete?: boolean }
export const Route = createFileRoute('/my-hackathons')({ component: MyHackathons })
function MyHackathons() {
  const t = useT()
  const locale = useLocale()
  const [items, setItems] = useState<Registration[] | null>(null)
  const [error, setError] = useState('')
  const load = async () => {
    setError('')
    try {
      const response = await fetch('/api/participant/registrations')
      if (response.status === 401) { location.assign('/auth/participant'); return }
      if (!response.ok) throw new Error(t('participant.my_error'))
      const registrations = (await response.json() as { registrations: Registration[] }).registrations
      setItems(await Promise.all(registrations.map(async (item) => {
        const detail = await fetch(`/api/participant/events/${encodeURIComponent(item.eventId)}/registration`)
        if (!detail.ok) return item
        return { ...item, complete: (await detail.json() as { complete: boolean }).complete }
      })))
    } catch (e) { setError(e instanceof Error ? e.message : t('participant.my_error')) }
  }
  useEffect(() => { void load() }, [])
  return <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8"><header><h1 className="text-3xl font-bold">{t('participant.my_title')}</h1><p className="mt-2 text-muted-foreground">{t('participant.my_desc')}</p></header>
    {items === null ? error ? <section role="alert" className="space-y-3"><p>{error}</p><Button onClick={() => void load()}>{t('participant.retry')}</Button></section> : <p aria-busy="true">{t('participant.my_loading')}</p> : items.length === 0 ? <section className="rounded-xl border border-dashed p-6"><h2 className="text-lg font-semibold">{t('participant.my_empty')}</h2><p className="mt-2 text-muted-foreground">{t('participant.my_empty_desc')}</p><a className="mt-4 inline-block text-accent underline" href="https://discord.com/channels/@me">{t('participant.open_discord')}</a></section> : <ul className="space-y-3">{items.map((item) => <li key={item.eventId} className="rounded-xl border p-4"><h2 className="text-lg font-semibold">{item.name}</h2><p className="mt-1 text-sm text-muted-foreground">{item.description}</p><p className="mt-3 text-sm">{t('participant.status', { status: item.status === 'active' ? t('participant.active') : item.status })}</p>{!item.complete && <p className="mt-2 text-sm text-warn">{t('participant.action_needed')}</p>}{item.startsAt && <p className="mt-2 text-sm">{t('participant.schedule', { start: new Intl.DateTimeFormat(locale === 'sv' ? 'sv-SE' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(item.startsAt)) })}</p>}<div className="mt-4 flex gap-4"><a className="text-accent underline" href={`/events/${encodeURIComponent(item.eventId)}/signup`}>{t('participant.view_signup')}</a>{item.teamId && <a className="text-accent underline" href={`/team?eventId=${encodeURIComponent(item.eventId)}`}>{t('participant.view_team')}</a>}</div></li>)}</ul>}
  </main>
}
