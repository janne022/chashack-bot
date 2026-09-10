import { Link } from '@tanstack/react-router'
import { CalendarDays, Plus, Settings2, Bell, Copy, Trash2, ExternalLink, Radio, Users, UsersRound, CalendarClock, Lock, Send, LayoutTemplate, FilePlus, Layers, Clock } from 'lucide-react'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { useAppContext } from '@/lib/app-context'
import { useT } from '@/lib/i18n'
import { api } from '@/api'
import { createEventSchema, announceSchema, cleanupDelaySchema } from '@/lib/schemas'
import type { FormConfig, HackathonEvent, Participant } from '@/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea-label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { DateRangePicker } from '@/components/ui/date-range-picker'
import { ScheduleEditor } from '@/components/ui/schedule-editor'
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
  const { state, refresh } = useAppContext()
  const t = useT()
  const [chooserOpen, setChooserOpen] = useState(false)
  const [open, setOpen] = useState(false)
  const [chooserTemplateId, setChooserTemplateId] = useState<string>('')
  const [templateId, setTemplateId] = useState<string>('')
  const [formMode, setFormMode] = useState<'blank' | 'template'>('blank')
  const [formTemplateId, setFormTemplateId] = useState<string>('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [schedule, setSchedule] = useState<import('@/types').ScheduleItem[]>([])
  const [panelChannelId, setPanelChannelId] = useState('')
  const [announceChannelId, setAnnounceChannelId] = useState('')
  const [announceTitle, setAnnounceTitle] = useState('')
  const [announceMessage, setAnnounceMessage] = useState('')
  const [dmOnAnnounce, setDmOnAnnounce] = useState(false)
  const [busy, setBusy] = useState(false)

  const eventTemplates = (state.templates ?? []).filter((tpl) => tpl.kind === 'event')
  const formTemplates = (state.templates ?? []).filter((tpl) => tpl.kind === 'form')
  const defaults = state.guildSettings

  function onOpenChooser() {
    setChooserOpen(true)
  }

  function openBlank() {
    setTemplateId('')
    setChooserTemplateId('')
    setChooserOpen(false)
    setOpen(true)
    if (!panelChannelId && defaults.defaultPanelChannelId) setPanelChannelId(defaults.defaultPanelChannelId)
    if (!announceChannelId && defaults.defaultAnnouncementChannelId) setAnnounceChannelId(defaults.defaultAnnouncementChannelId)
  }

  function openFromTemplate() {
    if (!chooserTemplateId) return
    applyTemplate(chooserTemplateId)
    setChooserOpen(false)
    setOpen(true)
    if (!panelChannelId && defaults.defaultPanelChannelId) setPanelChannelId(defaults.defaultPanelChannelId)
    if (!announceChannelId && defaults.defaultAnnouncementChannelId) setAnnounceChannelId(defaults.defaultAnnouncementChannelId)
  }

  function applyTemplate(id: string) {
    setTemplateId(id)
    if (id === '') return
    const tpl = eventTemplates.find((x) => x.id === id)
    if (!tpl) return
    try {
      const parsed = JSON.parse(tpl.json) as { name?: string; description?: string; cleanupDelayHours?: number; schedule?: import('@/types').ScheduleItem[] }
      if (parsed.name) setName(parsed.name)
      if (parsed.description) setDescription(parsed.description)
      if (Array.isArray(parsed.schedule)) setSchedule(parsed.schedule)
      toast.info(t('events.template_applied', { name: tpl.name }))
    } catch {
      // ignore parse errors, still send templateId to server
    }
  }

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
      await api.createEvent({
        ...parsed.data,
        ...(templateId ? { templateId } : {}),
        ...(formTemplateId ? { formTemplateId } : {}),
        panelChannelId: panelChannelId || null,
        announcementChannelId: announceChannelId || null,
        ...(schedule.length > 0 ? { schedule } : {}),
      })
      toast.success(t('events.created', { name: name.trim() }))

      setOpen(false)
      setChooserTemplateId('')
      setTemplateId('')
      setFormMode('blank')
      setFormTemplateId('')
      setName('')
      setDescription('')
      setStartsAt('')
      setEndsAt('')
      setSchedule([])
      setPanelChannelId('')
      setAnnounceChannelId('')
      setAnnounceTitle('')
      setAnnounceMessage('')
      setDmOnAnnounce(false)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('events.create_failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button onClick={onOpenChooser}>
        <Plus />
        {t('events.new')}
      </Button>
      {chooserOpen && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setChooserOpen(false)}>
          <Card className="w-full max-w-md animate-pop-in" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle>{t('events.chooser_title')}</CardTitle>
              <CardDescription>{t('events.chooser_desc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <button
                type="button"
                onClick={openBlank}
                className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-4 text-left transition-colors hover:border-accent/40 hover:bg-accent-soft"
              >
                <span className="flex size-10 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <FilePlus className="size-5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold">{t('events.new_event')}</span>
                  <span className="block text-xs text-muted-foreground">{t('events.new_event_hint')}</span>
                </span>
              </button>

              <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2/40 p-3">
                <div className="flex items-center gap-3">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <Layers className="size-4" />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold">{t('events.from_template')}</span>
                    <span className="block text-xs text-muted-foreground">{t('events.from_template_desc')}</span>
                  </span>
                </div>
                {eventTemplates.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('events.no_templates_hint')}</p>
                ) : (
                  <>
                    <Select value={chooserTemplateId} onValueChange={setChooserTemplateId}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('events.pick_template')} />
                      </SelectTrigger>
                      <SelectContent>
                        {eventTemplates.map((tpl) => (
                          <SelectItem key={tpl.id} value={tpl.id}>{tpl.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button disabled={!chooserTemplateId} onClick={openFromTemplate}>
                      {t('events.continue_with_template')}
                    </Button>
                  </>
                )}
              </div>

              <Button variant="ghost" onClick={() => setChooserOpen(false)}>{t('common.cancel')}</Button>
            </CardContent>
          </Card>
        </div>
      )}
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <Card
            className="w-full max-w-[min(48rem,95vw)] animate-pop-in overflow-y-auto max-h-[85vh]"
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
          >
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle>{t('events.create_title')}</CardTitle>
                <CardDescription>{t('events.create_desc')}</CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setOpen(false); setChooserOpen(true) }}>
                {t('events.change_template')}
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">

              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('events.name')}</span>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('events.name_placeholder')} maxLength={100} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('events.description')}</span>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('events.desc_placeholder')} maxLength={1000} />
              </label>
              <DateRangePicker from={startsAt} to={endsAt} onChange={({ from, to }) => { setStartsAt(from); setEndsAt(to) }} label={t('events.when')} />

              <ScheduleEditor value={schedule} onChange={setSchedule} />

              <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2/40 p-3">
                <span className="text-sm font-medium">{t('events.form_section')}</span>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { setFormMode('blank'); setFormTemplateId('') }}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      formMode === 'blank' ? "border-accent bg-background ring-1 ring-accent" : "border-border bg-surface-2 hover:border-accent/40"
                    )}
                  >
                    <FilePlus className={cn("size-4", formMode === 'blank' ? "text-accent" : "text-muted-foreground")} />
                    <span>
                      <span className="block text-sm font-medium">{t('events.new_form')}</span>
                      <span className="block text-xs text-muted-foreground">{t('events.new_form_desc')}</span>
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormMode('template')}
                    disabled={formTemplates.length === 0}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors disabled:opacity-50",
                      formMode === 'template' ? "border-accent bg-background ring-1 ring-accent" : "border-border bg-surface-2 hover:border-accent/40"
                    )}
                  >
                    <LayoutTemplate className={cn("size-4", formMode === 'template' ? "text-accent" : "text-muted-foreground")} />
                    <span>
                      <span className="block text-sm font-medium">{t('events.pick_form')}</span>
                      <span className="block text-xs text-muted-foreground">{t('events.pick_form_desc')}</span>
                    </span>
                  </button>
                </div>
                {formMode === 'template' && (
                  <Select value={formTemplateId} onValueChange={setFormTemplateId}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('events.pick_form_template')} />
                    </SelectTrigger>
                    <SelectContent>
                      {formTemplates.map((tpl) => (
                        <SelectItem key={tpl.id} value={tpl.id}>
                          {tpl.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <span className="text-xs text-muted-foreground">
                  {formMode === 'blank' ? t('events.new_form_hint') : t('events.form_template_hint')}
                </span>
              </div>

              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('events.panel_channel')}</span>
                <Input value={panelChannelId} onChange={(e) => setPanelChannelId(e.target.value)} placeholder="Discord channel ID" maxLength={30} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('events.announce_channel')}</span>
                <Input value={announceChannelId} onChange={(e) => setAnnounceChannelId(e.target.value)} placeholder="Discord channel ID (defaults to panel)" maxLength={30} />
              </label>

              <fieldset className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2 p-3">
                <legend className="text-xs font-medium text-muted-foreground px-1">{t('events.announce_at_create')}</legend>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">{t('events.headline_placeholder')}</span>
                  <Input value={announceTitle} onChange={(e) => setAnnounceTitle(e.target.value)} placeholder="Event is live!" maxLength={100} />
                </label>
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="font-medium">{t('events.message_placeholder')}</span>
                  <Textarea value={announceMessage} onChange={(e) => setAnnounceMessage(e.target.value)} placeholder="The signup panel is ready..." maxLength={800} />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={dmOnAnnounce} onCheckedChange={setDmOnAnnounce} />
                  {t('events.also_dm')}
                </label>
              </fieldset>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
                <Button disabled={busy || name.trim().length < 3} onClick={() => void create()}>
                  <Send />
                  {t('common.create')}
                </Button>
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
        {event.schedule && event.schedule.length > 0 && (
          <div className="mb-4 flex flex-col gap-2 rounded-lg border border-border bg-surface-2/40 p-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('events.schedule')}</span>
            <div className="flex flex-col gap-1.5">
              {[...event.schedule].sort((a,b)=>a.time-b.time).map((it) => (
                <div key={it.id} className="flex items-center gap-3 text-sm">
                  <span className="shrink-0 rounded-md bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                    {new Date(it.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="font-medium">{it.title}</span>
                  {it.description && <span className="text-muted-foreground">· {it.description}</span>}
                  <Badge variant="secondary" className="ml-auto text-[10px]">{it.kind ?? 'custom'}</Badge>
                </div>
              ))}
            </div>
            <EditableSchedule event={event} refresh={refresh} />
          </div>
        )}
        {(!event.schedule || event.schedule.length === 0) && (
          <div className="mb-4">
            <EditableSchedule event={event} refresh={refresh} />
          </div>
        )}
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
            <Link to="/templates">{t('events.configure_form')}</Link>
          </Button>
          <EventFormPicker event={event} refresh={refresh} />
          <NotificationButtons event={event} refresh={refresh} />
          <EndEventButton event={event} refresh={refresh} />
        </div>
      </CardContent>
    </Card>
  )
}

function EditableSchedule({ event, refresh }: { event: HackathonEvent; refresh: () => Promise<void> }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState(event.schedule ?? [])
  const [busy, setBusy] = useState(false)

  // sync when event changes (after save)
  useEffect(() => { if (!open) setItems(event.schedule ?? []) }, [event.schedule, open])

  async function save() {
    setBusy(true)
    try {
      await api.updateEvent(event.id, { schedule: items })
      toast.success(t('events.schedule_saved'))
      setOpen(false)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('events.schedule_save_failed'))
    } finally { setBusy(false) }
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Clock className="size-3.5" />
        {event.schedule?.length ? t('events.edit_schedule') : t('events.add_schedule')}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <Card className="w-full max-w-xl animate-pop-in max-h-[85vh] overflow-y-auto" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle>{t('events.edit_schedule_title')}</CardTitle>
              <CardDescription>{t('events.edit_schedule_desc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ScheduleEditor value={items} onChange={setItems} />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
                <Button disabled={busy} onClick={() => void save()}>{t('common.save')}</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}

function EventFormPicker({ event, refresh }: { event: HackathonEvent; refresh: () => Promise<void> }) {
  const { state } = useAppContext()
  const t = useT()
  const [open, setOpen] = useState(false)
  const [formTemplateId, setFormTemplateId] = useState('')
  const [busy, setBusy] = useState(false)

  const formTemplates = (state.templates ?? []).filter((tpl) => tpl.kind === 'form')

  async function apply() {
    if (!formTemplateId) return
    setBusy(true)
    try {
      await api.setEventForm(event.id, { formTemplateId })
      toast.success(t('events.form_updated'))
      setOpen(false)
      setFormTemplateId('')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('events.form_update_failed'))
    } finally { setBusy(false) }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <LayoutTemplate className="size-3.5" />
        {t('events.change_form')}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <Card className="w-full max-w-md animate-pop-in" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle>{t('events.change_form_title')}</CardTitle>
              <CardDescription>{t('events.change_form_desc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('templates.form_templates')}</span>
                <Select value={formTemplateId} onValueChange={setFormTemplateId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('events.pick_form_template')} />
                  </SelectTrigger>
                  <SelectContent>
                    {formTemplates.map((tpl) => (
                      <SelectItem key={tpl.id} value={tpl.id}>{tpl.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
                <Button disabled={busy || !formTemplateId} onClick={() => void apply()}>
                  {t('common.save')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}

function NotificationButtons({ event, refresh }: { event: HackathonEvent; refresh: () => Promise<void> }) {
  const t = useT()
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [dm, setDm] = useState(false)
  const [channelId, setChannelId] = useState('')
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
      const targetChannel = channelId.trim() || undefined
      const res = await api.announce(event.id, title.trim(), message.trim(), dm, targetChannel)
      toast.success(res.posted ? (dm ? t('events.posted_with_dms', { count: res.dmSent }) : t('events.posted')) : t('events.posted_unreachable'))
      if (res.dmFailed > 0) toast.info(t('events.dms_failed', { count: res.dmFailed }))
      setOpen(false)
      setTitle('')
      setMessage('')
      setChannelId('')
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
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('events.channel')}</span>
                <Input value={channelId} onChange={(e) => setChannelId(e.target.value)} placeholder="Override channel ID (optional)" maxLength={30} />
              </label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t('events.headline_placeholder')} maxLength={100} />
              <Textarea value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('events.message_placeholder')} maxLength={800} />
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={dm} onCheckedChange={setDm} />
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
      <Input type="number" min={0} max={720} value={hours} onChange={(e) => setHours(e.target.value)} className="h-7 w-16" aria-label={t('events.cleanup_delay_aria')} />
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