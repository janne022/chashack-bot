import { Link } from '@tanstack/react-router'
import { CalendarDays, Plus, Settings2, Bell, Copy, Trash2, ExternalLink, Radio, Users, UsersRound, CalendarClock, Lock } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useAppContext } from '@/lib/app-context'
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
  const events = state.events ?? []
  const activeEvent = events.find((e) => e.status === 'active') ?? null

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">Events</h1>
          <p className="text-sm text-muted-foreground">Create, configure and run hackathon events</p>
        </div>
        <NewEventButton />
      </header>

      {activeEvent !== null && <ActiveEventCard event={activeEvent} refresh={refresh} />}

      <InsightsSection participants={state.participants} config={state.config} />

      <section>
        <h2 className="font-display mb-3 text-sm uppercase tracking-wide text-muted-foreground">
          All events ({events.length})
        </h2>
        {events.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState
                icon={<CalendarDays className="size-5" />}
                title="No events yet"
                description="Create your first event, configure the signup form, then activate it."
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
      toast.error(parsed.error.issues[0]?.message ?? 'Invalid input')
      return
    }
    setBusy(true)
    try {
      await api.createEvent(parsed.data)
      toast.success(`Event “${name.trim()}” created`)
      setOpen(false)
      setName('')
      setDescription('')
      setStartsAt('')
      setEndsAt('')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus />
        New event
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <Card
            className="w-full max-w-md animate-pop-in"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <CardHeader>
              <CardTitle>Create event</CardTitle>
              <CardDescription>Starts as a draft. Activate when the signup panel is ready.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="ChasHack 2026 Spring"
                  className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm"
                  maxLength={100}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Description</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="48-hour hackathon…"
                  className="min-h-16 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
                  maxLength={1000}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">Starts</span>
                  <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm" />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">Ends</span>
                  <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm" />
                </label>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button disabled={busy || name.trim().length < 3} onClick={() => void create()}>Create</Button>
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
            <Badge>live</Badge>
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
              void navigator.clipboard.writeText(event.id).then(() => toast.info('Event id copied'))
            }}
          >
            <Copy />
            Copy id
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-accent" />
            <div>
              <div className="text-muted-foreground text-xs">Starts</div>
              <div>{event.startsAt !== null ? `${dateTime(event.startsAt)} (${timeAgo(event.startsAt)})` : 'not set'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-danger" />
            <div>
              <div className="text-muted-foreground text-xs">Ends</div>
              <div>{event.endsAt !== null ? `${dateTime(event.endsAt)}` : 'not set'}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Users className="size-4 text-accent" />
            <div>
              <div className="text-muted-foreground text-xs">Signups</div>
              <div>{state.stats.active}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <UsersRound className="size-4 text-accent" />
            <div>
              <div className="text-muted-foreground text-xs">Teams</div>
              <div>{state.stats.teams}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Radio className="size-4 text-accent" />
            <div>
              <div className="text-muted-foreground text-xs">Cleanup</div>
              <div>{event.cleanupDone ? 'done' : `${event.cleanupDelayHours}h after end`}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CalendarClock className="size-4 text-accent" />
            <div>
              <div className="text-muted-foreground text-xs">Auto-match</div>
              <div className="flex items-center gap-1.5">
                {event.matchLocked && <Lock className="size-3 text-ok" />}
                <span>
                  {event.matchAt !== null
                    ? `${dateTime(event.matchAt)} (${timeAgo(event.matchAt)})${event.matchLocked ? ' · locked' : ''}`
                    : event.matchLocked
                      ? 'locked · manual'
                      : 'manual'}
                </span>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild>
            <Link to="/form">Configure form</Link>
          </Button>
          <NotificationButtons event={event} refresh={refresh} />
          <EndEventButton event={event} refresh={refresh} />
        </div>
      </CardContent>
    </Card>
  )
}

function NotificationButtons({ event, refresh }: { event: HackathonEvent; refresh: () => Promise<void> }) {
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [dm, setDm] = useState(false)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function send() {
    const parsed = announceSchema.safeParse({ eventId: event.id, title: title.trim(), message: message.trim(), dm })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Invalid input')
      return
    }
    setBusy(true)
    try {
      const res = await api.announce(event.id, title.trim(), message.trim(), dm)
      toast.success(res.posted ? `Posted${dm ? ` · ${res.dmSent} DMs sent` : ''}` : 'Posted (channel unreachable)')
      if (res.dmFailed > 0) toast.info(`${res.dmFailed} DMs failed (closed DMs)`)
      setOpen(false)
      setTitle('')
      setMessage('')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Announce failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <Bell />
        Announce
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <Card className="w-full max-w-md animate-pop-in" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle>Announce</CardTitle>
              <CardDescription>Posts to the signup panel channel. DMs go to every active signup.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Headline"
                className="h-9 rounded-lg border border-border bg-surface-2 px-3 text-sm"
                maxLength={100}
              />
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What to say…"
                className="min-h-24 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm"
                maxLength={800}
              />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={dm} onChange={(e) => setDm(e.target.checked)} className="size-4 accent-[var(--color-accent)]" />
                Also DM all participants
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button disabled={busy || title.trim() === '' || message.trim() === ''} onClick={() => void send()}>
                  <Bell />
                  Send
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
  const [hours, setHours] = useState(String(event.cleanupDelayHours))
  const [busy, setBusy] = useState(false)
  const dirty = Number(hours) !== event.cleanupDelayHours && hours !== ''

  async function save() {
    const parsed = cleanupDelaySchema.safeParse(Number(hours))
    if (!parsed.success) {
      toast.error('Delay must be 0–720 hours')
      return
    }
    setBusy(true)
    try {
      await api.updateEvent(event.id, { cleanupDelayHours: parsed.data })
      toast.success(`Cleanup delay set to ${parsed.data}h after the event ends`)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <label className="flex items-center gap-2 text-xs text-muted-foreground">
      Cleanup delay
      <input
        type="number"
        min={0}
        max={720}
        value={hours}
        onChange={(e) => setHours(e.target.value)}
        className="h-7 w-16 rounded-md border border-border bg-surface-2 px-2 text-foreground"
        aria-label="Cleanup delay in hours after the event ends"
      />
      h
      {dirty && (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void save()}>
          Save
        </Button>
      )}
    </label>
  )
}

function EndEventButton({ event, refresh }: { event: HackathonEvent; refresh: () => Promise<void> }) {
  void updateCleanupPlaceholder
  const [confirming, setConfirming] = useState(false)

  async function end() {
    try {
      await api.endEvent(event.id)
      toast.success('Event ended — cleanup scheduled')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'End failed')
    }
  }

  return (
    <>
      <CleanupDelayConfig event={event} refresh={refresh} />
      <Button variant="destructive" size="sm" onClick={() => setConfirming(true)}>
        <Trash2 />
        End event
      </Button>
      {confirming && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setConfirming(false)}>
          <Card className="w-full max-w-md animate-pop-in" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle>End “{event.name}”?</CardTitle>
              <CardDescription>
                Team roles, channels and Discord events are cleaned up automatically{' '}
                <strong>{event.cleanupDelayHours}h</strong> after the end time — people keep a grace window to
                grab photos and screenshots (warnings go out at 72h and 24h before removal). Data is kept for archive.
                Change the delay in the event config below.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
              <Button variant="destructive" onClick={() => { setConfirming(false); void end() }}>End event</Button>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}

function EventCard({ event, isActive, refresh }: { event: HackathonEvent; isActive: boolean; refresh: () => Promise<void> }) {
  async function activate() {
    try {
      await api.activateEvent(event.id)
      toast.success(`“${event.name}” is now live`)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Activate failed')
    }
  }

  return (
    <Card className={cn(isActive && 'border-accent/40')}>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div className="min-w-0">
          <CardTitle className="truncate">{event.name}</CardTitle>
          <CardDescription className="pt-1">
            {event.startsAt !== null ? dateTime(event.startsAt) : 'no date set'}
          </CardDescription>
        </div>
        <Badge variant={event.status === 'active' ? 'success' : event.status === 'ended' ? 'secondary' : 'warning'}>
          {event.status}
        </Badge>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-xs text-muted-foreground">{event.id}</span>
        {event.status === 'draft' ? (
          <Button size="sm" variant="secondary" onClick={() => void activate()}>
            <ExternalLink />
            Activate
          </Button>
        ) : (
          <Button size="sm" variant="ghost" asChild>
            <Link to="/events">View</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function QuickLinks({ activeEventId }: { activeEventId: string | null }) {
  const cards = [
    { to: '/participants', label: 'Participants', desc: 'Review signups, move people, block' },
    { to: '/teams', label: 'Teams', desc: 'Inspect team spaces, kick, rotate codes' },
    { to: '/matching', label: 'Matching', desc: 'Preview & commit compatibility teams' },
    { to: '/audit', label: 'Audit log', desc: 'Every mutation, newest first' },
  ] as const

  return (
    <section>
      <h2 className="font-display mb-3 text-sm uppercase tracking-wide text-muted-foreground">Operate</h2>
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
          No active event — create and activate one first; the other tabs operate on it.
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
  return (
    <section>
      <h2 className="font-display mb-3 text-sm uppercase tracking-wide text-muted-foreground">
        Insights
      </h2>
      <div className="grid gap-3 md:grid-cols-2">
        <SignupsTimeline participants={participants} />
        <TeamComposition participants={participants} config={config} />
      </div>
    </section>
  )
}
