import { Link } from '@tanstack/react-router'
import { CalendarDays, Plus, Settings2, Bell, Copy, Trash2, ExternalLink, Radio, Users, UsersRound } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useAppContext } from '@/lib/app-context'
import { useT } from '@/lib/i18n'
import { api } from '@/api'
import { createEventSchema, announceSchema, cleanupDelaySchema } from '@/lib/schemas'
import type { FormConfig, HackathonEvent, Participant } from '@/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { dateTime, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { SignupsTimeline } from '@/views/panels/charts/SignupsTimeline'
import { TeamComposition } from '@/views/panels/charts/TeamComposition'

export function EventsPage() {
  const { state, refresh } = useAppContext()
  const t = useT()
  const events = state.events ?? []
  const activeEvent = events.find((e) => e.status === 'active') ?? null

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">{t('events.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('events.subtitle')}</p>
        </div>
        <NewEventButton />
      </header>

      {activeEvent !== null && <ActiveEventCard event={activeEvent} refresh={refresh} />}

      <InsightsSection participants={state.participants} config={state.config} />

      <section>
        <h2 className="font-display mb-3 text-sm uppercase tracking-wide text-muted-foreground">
          {t('events.all', { count: events.length })}
        </h2>
        {events.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState
                icon={<CalendarDays className="size-5" />}
                title={t('events.none_title')}
                description={t('events.none_desc')}
                action={<NewEventButton />}
              />
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {events.map((event) => (
              <EventCard key={event.id} event={event} isActive={activeEvent?.id === event.id} refresh={refresh} />
            ))}
          </div>
        )}
      </section>

      <QuickLinks activeEventId={activeEvent?.id ?? null} />
    </div>
  )
}

function NewEventButton() {
  const { refresh } = useAppContext()
  const t = useT()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [busy, setBusy] = useState(false)

  async function create() {
    const starts = startsAt !== '' ? Date.parse(startsAt) || null : null
    const ends = endsAt !== '' ? Date.parse(endsAt) || null : null
    const parsed = createEventSchema.safeParse({
      name: name.trim(),
      ...(description.trim() !== '' ? { description: description.trim() } : {}),
      startsAt: starts,
      endsAt: ends,
    })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? t('events.invalid_input'))
      return
    }
    setBusy(true)
    try {
      await api.createEvent(parsed.data)
      toast.success(t('events.created', { name: name.trim() }))
      setOpen(false)
      setName('')
      setDescription('')
      setStartsAt('')
      setEndsAt('')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('events.create_failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus />
        {t('events.new')}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <Card
            className="w-full max-w-md animate-pop-in"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <CardHeader>
              <CardTitle>{t('events.create_title')}</CardTitle>
              <CardDescription>{t('events.create_desc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('events.name')}</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('events.name_placeholder')}
                  className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm"
                  maxLength={100}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('events.description')}</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('events.desc_placeholder')}
                  className="min-h-16 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
                  maxLength={1000}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">{t('events.starts')}</span>
                  <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">{t('events.ends')}</span>
                  <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm" />
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
                <Button disabled={busy || name.trim().length < 3} onClick={() => void create()}>{t('common.create')}</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}

function ActiveEventCard({ event, refresh }: { event: HackathonEvent; refresh: () => Promise<void> }) {
  const { state } = useAppContext()
  const t = useT()

  return (
    <Card className="border-accent/40">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <div className="flex items-center gap-2">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" />
              <span className="relative inline-flex size-2.5 rounded-full bg-ok" />
            </span>
            <CardTitle className="font-display text-xl">{event.name}</CardTitle>
            <Badge>{t('events.live')}</Badge>
          </div>
          {event.description !== '' && (
            <CardDescription className="mt-1 max-w-2xl">{event.description}</CardDescription>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void navigator.clipboard.writeText(event.id).then(() => toast.info(t('events.id_copied')))
            }}
          >
            <Copy />
            {t('events.copy_id')}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-accent" />
            <div>
              <div className="text-muted-foreground text-xs">{t('events.starts')}</div>
              <div>{event.startsAt !== null ? `${dateTime(event.startsAt)} (${timeAgo(event.startsAt)})` : t('common.not_set')}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-danger" />
            <div>
              <div className="text-muted-foreground text-xs">{t('events.ends')}</div>
              <div>{event.endsAt !== null ? `${dateTime(event.endsAt)}` : t('common.not_set')}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Users className="size-4 text-accent" />
            <div>
              <div className="text-muted-foreground text-xs">{t('events.signups')}</div>
              <div>{state.stats.active}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <UsersRound className="size-4 text-accent" />
            <div>
              <div className="text-muted-foreground text-xs">{t('events.teams')}</div>
              <div>{state.stats.teams}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Radio className="size-4 text-accent" />
            <div>
              <div className="text-muted-foreground text-xs">{t('events.cleanup')}</div>
              <div>{event.cleanupDone ? t('events.cleanup_done') : t('events.cleanup_pending', { hours: event.cleanupDelayHours })}</div>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/form">{t('events.configure_form')}</Link>
          </Button>
          <NotificationButtons event={event} refresh={refresh} />
          <EndEventButton event={event} refresh={refresh} />
        </div>
      </CardContent>
    </Card>
  )
}

function NotificationButtons({ event, refresh }: { event: HackathonEvent; refresh: () => Promise<void> }) {
  const t = useT()
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [dm, setDm] = useState(false)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function send() {
    const parsed = announceSchema.safeParse({ eventId: event.id, title: title.trim(), message: message.trim(), dm })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? t('events.invalid_input'))
      return
    }
    setBusy(true)
    try {
      const res = await api.announce(event.id, title.trim(), message.trim(), dm)
      toast.success(res.posted ? (dm ? t('events.posted_with_dms', { count: res.dmSent }) : t('events.posted')) : t('events.posted_unreachable'))
      if (res.dmFailed > 0) toast.info(t('events.dms_failed', { count: res.dmFailed }))
      setOpen(false)
      setTitle('')
      setMessage('')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('events.announce_failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Bell />
        {t('events.announce')}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <Card className="w-full max-w-md animate-pop-in" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle>{t('events.announce')}</CardTitle>
              <CardDescription>{t('events.announce_desc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t('events.headline_placeholder')}
                className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm"
                maxLength={100}
              />
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('events.message_placeholder')}
                className="min-h-24 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
                maxLength={800}
              />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={dm} onChange={(e) => setDm(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
                {t('events.also_dm')}
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
                <Button disabled={busy || title.trim() === '' || message.trim() === ''} onClick={() => void send()}>
                  <Bell />
                  {t('events.send')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}

const updateCleanupPlaceholder = undefined

function CleanupDelayConfig({ event, refresh }: { event: HackathonEvent; refresh: () => Promise<void> }) {
  const t = useT()
  const [hours, setHours] = useState(String(event.cleanupDelayHours))
  const [busy, setBusy] = useState(false)
  const dirty = Number(hours) !== event.cleanupDelayHours && hours !== ''

  async function save() {
    const parsed = cleanupDelaySchema.safeParse(Number(hours))
    if (!parsed.success) {
      toast.error(t('events.cleanup_delay_aria'))
      return
    }
    setBusy(true)
    try {
      await api.updateEvent(event.id, { cleanupDelayHours: parsed.data })
      toast.success(t('events.cleanup_delay_saved', { hours: parsed.data }))
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('events.save_failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      {t('events.cleanup_delay')}
      <input
        type="number"
        min={0}
        max={720}
        value={hours}
        onChange={(e) => setHours(e.target.value)}
        className="h-7 w-16 rounded-md border border-border bg-surface-2 px-2 text-foreground"
        aria-label={t('events.cleanup_delay_aria')}
      />
      h
      {dirty && (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void save()}>
          {t('common.save')}
        </Button>
      )}
    </label>
  )
}

function EndEventButton({ event, refresh }: { event: HackathonEvent; refresh: () => Promise<void> }) {
  const t = useT()
  void updateCleanupPlaceholder
  const [confirming, setConfirming] = useState(false)

  async function end() {
    try {
      await api.endEvent(event.id)
      toast.success(t('events.ended_toast'))
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('events.end_failed'))
    }
  }

  return (
    <>
      <CleanupDelayConfig event={event} refresh={refresh} />
      <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
        <Trash2 />
        {t('events.end_event')}
      </Button>
      {confirming && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setConfirming(false)}>
          <Card className="w-full max-w-md animate-pop-in" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle>{t('events.end_confirm_title', { name: event.name })}</CardTitle>
              <CardDescription>
                {t('events.end_confirm_before')} <strong>{event.cleanupDelayHours}h</strong> {t('events.end_confirm_after')}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
              <Button variant="destructive" onClick={() => { setConfirming(false); void end() }}>{t('events.end_event')}</Button>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}

function EventCard({ event, isActive, refresh }: { event: HackathonEvent; isActive: boolean; refresh: () => Promise<void> }) {
  const t = useT()

  async function activate() {
    try {
      await api.activateEvent(event.id)
      toast.success(t('events.activated_toast', { name: event.name }))
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('events.activate_failed'))
    }
  }

  const statusKey =
    event.status === 'active'
      ? 'events.status_active'
      : event.status === 'ended'
        ? 'events.status_ended'
        : 'events.status_draft'

  return (
    <Card className={cn(isActive && 'border-accent/40')}>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="min-w-0">
          <CardTitle className="truncate">{event.name}</CardTitle>
          <CardDescription className="pt-1">
            {event.startsAt !== null ? dateTime(event.startsAt) : t('events.no_date')}
          </CardDescription>
        </div>
        <Badge variant={event.status === 'active' ? 'success' : event.status === 'ended' ? 'secondary' : 'warning'}>
          {t(statusKey)}
        </Badge>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-xs text-muted-foreground">{event.id}</span>
        {event.status === 'draft' ? (
          <Button size="sm" variant="secondary" onClick={() => void activate()}>
            <ExternalLink />
            {t('events.activate')}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" asChild>
            <Link to="/events">{t('events.view')}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function QuickLinks({ activeEventId }: { activeEventId: string | null }) {
  const t = useT()
  const cards = [
    { to: '/participants', label: t('nav.participants'), desc: t('events.ql_participants') },
    { to: '/teams', label: t('nav.teams'), desc: t('events.ql_teams') },
    { to: '/matching', label: t('nav.matching'), desc: t('events.ql_matching') },
    { to: '/audit', label: t('nav.audit'), desc: t('events.ql_audit') },
  ] as const

  return (
    <section>
      <h2 className="font-display mb-3 text-sm uppercase tracking-wide text-muted-foreground">{t('events.operate')}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Link key={c.to} to={c.to} className="group">
            <Card className="h-full transition-all group-hover:-translate-y-0.5 group-hover:border-accent/50">
              <CardContent className="flex items-center gap-3 p-4">
                <Settings2 className="size-4 shrink-0 text-accent" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{c.label}</div>
                  <div className="truncate text-xs text-muted-foreground">{c.desc}</div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
      {activeEventId === null && (
        <p className="mt-3 text-xs text-muted-foreground">
          {t('events.no_active')}
        </p>
      )}
    </section>
  )
}

function InsightsSection({
  participants,
  config,
}: {
  participants: Participant[]
  config: FormConfig
}) {
  const t = useT()
  return (
    <section>
      <h2 className="font-display mb-3 text-sm uppercase tracking-wide text-muted-foreground">
        {t('events.insights')}
      </h2>
      <div className="grid gap-3 md:grid-cols-2">
        <SignupsTimeline participants={participants} />
        <TeamComposition participants={participants} config={config} />
      </div>
    </section>
  )
}
