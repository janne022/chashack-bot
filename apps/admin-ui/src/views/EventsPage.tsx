import { CalendarDays, CalendarPlus, Plus, Bell, Copy, Trash2, Radio, Users, UsersRound, CalendarClock, Lock, Unlock, Send, LayoutTemplate, FilePlus, FileCheck, Layers, ClipboardList, Search, Rocket, Pencil, ChevronDown, ChevronUp, ChevronLeft, ArrowRight, ExternalLink } from 'lucide-react'
import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useAppContext } from '@/lib/app-context'
import { useT } from '@/lib/i18n'
import { api, ApiError } from '@/api'
import { copyText } from '@/lib/clipboard'
import { createEventSchema, announceSchema } from '@/lib/schemas'
import type { Assignment, AssignmentStrategy, FormConfig, FormAppearance, HackathonEvent, Participant } from '@/types'
import { STRATEGY_OPTIONS } from '@/lib/assignment-strategy'
import { DEFAULT_FORM } from '@/lib/default-form'
import { SYNTHETIC_BLOCK_IDS, resolveScheduleAnchors, consolidateSignupBlock, moveScheduleDates } from '@/lib/schedule-anchor'
import { FormConfigEditor } from '@/components/FormConfigEditor'
import { SubmissionManager } from '@/components/SubmissionManager'
import { AppearanceControls } from '@/components/appearance-controls'
import { resolveAppearance } from '@/components/participant-appearance'
import { questionErrors, validateQuestions } from '@/lib/question-validation'
import { announcementFailureKey } from '@/lib/announcement-result'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@/components/ui/context-menu'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label, Textarea } from '@/components/ui/textarea-label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog'
import { ScheduleEditor } from '@/components/ui/schedule-editor'
import { AssignmentsEditor } from '@/components/AssignmentsEditor'
import { ImportedSignups } from '@/components/ImportedSignups'
import { EmptyState } from '@/components/ui/empty-state'
import { OtterIllustration } from '@/components/OtterIllustration'
import { TagAutocompleteInput, TagAutocompleteTextarea } from '@/components/TagAutocomplete'
import { dateTime, timeAgo } from '@/lib/format'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { SignupsTimeline } from '@/views/panels/charts/SignupsTimeline'
import { TeamComposition } from '@/views/panels/charts/TeamComposition'

function toLocalIso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** Create wizard rail — one label per step, in the order the form is filled. */
const CREATE_STEPS = [
  { id: 'basics', labelKey: 'events.step_basics' },
  { id: 'schedule', labelKey: 'events.step_schedule' },
  { id: 'assignments', labelKey: 'events.step_assignments' },
  { id: 'form', labelKey: 'events.step_form' },
  { id: 'review', labelKey: 'events.step_review' },
] as const

export function EventsPage() {
  const { state, selectEvent, refresh } = useAppContext()
  const t = useT()
  const events = state.events ?? []
  const liveEvents = events.filter((e) => e.status === 'active')

  // The open event lives in the URL (?event=<id>) so the workspace survives a
  // refresh, is shareable, and the browser Back button returns to Overview.
  const search = useSearch({ from: '/events' }) as { event?: string } | undefined
  const navigate = useNavigate()
  const eventParam = typeof search?.event === 'string' && search.event !== '' ? search.event : null
  const openEvent = events.find((e) => e.id === eventParam) ?? null
  const tab = openEvent !== null ? openEvent.id : 'overview'

  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<'newest' | 'oldest' | 'name' | 'starts'>('newest')
  const [showEnded, setShowEnded] = useState(false)

  // A deep link / shared URL also drives the app-wide selection so Operations
  // and every event-scoped action follow the same event.
  useEffect(() => {
    if (openEvent !== null && state.selectedEventId !== openEvent.id) selectEvent(openEvent.id)
  }, [openEvent, state.selectedEventId, selectEvent])

  function setTab(next: string) {
    if (next === 'overview') navigate({ to: '/events', search: {} })
    else navigate({ to: '/events', search: { event: next } })
  }

  function openWorkspace(id: string) {
    selectEvent(id)
    setTab(id)
  }

  const bySort = (list: HackathonEvent[]) =>
    [...list].sort((a, b) => {
      switch (sortKey) {
        case 'oldest':
          return a.createdAt - b.createdAt
        case 'name':
          return a.name.localeCompare(b.name)
        case 'starts':
          if (a.startsAt === null) return 1
          if (b.startsAt === null) return -1
          return a.startsAt - b.startsAt
        default:
          return b.createdAt - a.createdAt
      }
    })

  const q = query.trim().toLowerCase()
  const matches = (e: HackathonEvent) =>
    q === '' || e.name.toLowerCase().includes(q) || (e.description ?? '').toLowerCase().includes(q)

  const live = bySort(liveEvents.filter(matches))
  const drafts = bySort(events.filter((e) => e.status === 'draft' && matches(e)))
  const ended = bySort(events.filter((e) => e.status === 'ended' && matches(e)))
  const shown = live.length + drafts.length + ended.length

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">{t('events.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('events.subtitle')}</p>
        </div>
        <NewEventButton />
      </header>

      {events.length > 0 && (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList variant="line">
            <TabsTrigger value="overview"><Layers className="size-3.5" />{t('events.overview')}</TabsTrigger>
            {openEvent !== null && (
              <TabsTrigger value={openEvent.id}>
                <span className={cn('size-1.5 rounded-full', openEvent.status === 'active' ? 'bg-ok' : openEvent.status === 'draft' ? 'bg-warning' : 'bg-muted-foreground')} />
                <span className="max-w-[10rem] truncate">{openEvent.name}</span>
              </TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="overview" className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[12rem] flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('events.search_placeholder')}
                  aria-label={t('events.search_placeholder')}
                  className="pl-8"
                  maxLength={100}
                />
              </div>
              <Select value={sortKey} onValueChange={(v) => setSortKey(v as never)}>
                <SelectTrigger aria-label={t('events.sort_label')} className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">{t('events.sort_newest')}</SelectItem>
                  <SelectItem value="oldest">{t('events.sort_oldest')}</SelectItem>
                  <SelectItem value="name">{t('events.sort_name')}</SelectItem>
                  <SelectItem value="starts">{t('events.sort_starts')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {shown === 0 ? (
              <Card>
                <CardContent className="py-6 text-center text-sm text-muted-foreground">
                  <OtterIllustration panel="B1" className="mb-2" />
                  {t('events.no_matches')}
                  {query.trim() !== '' && (
                    <Button variant="ghost" size="sm" className="ml-2" onClick={() => setQuery('')}>
                      {t('common.clear')}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ) : (
              <div className="flex flex-col gap-6">
                <EventSection
                  title={t('events.section_live')}
                  hint={t('events.section_live_hint')}
                  events={live}
                  selectedId={state.selectedEventId}
                  onOpen={openWorkspace}
                  refresh={refresh}
                  tone="live"
                />
                <EventSection
                  title={t('events.section_drafts')}
                  hint={t('events.section_drafts_hint')}
                  events={drafts}
                  selectedId={state.selectedEventId}
                  onOpen={openWorkspace}
                  refresh={refresh}
                  tone="draft"
                />
                <EventSection
                  title={t('events.section_ended')}
                  hint={t('events.section_ended_hint')}
                  events={ended}
                  selectedId={state.selectedEventId}
                  onOpen={openWorkspace}
                  refresh={refresh}
                  tone="ended"
                  collapsed={!showEnded}
                  onToggleCollapsed={() => setShowEnded((v) => !v)}
                />
              </div>
            )}
          </TabsContent>

          {openEvent !== null && (
            <TabsContent value={openEvent.id}>
              <EventWorkspace event={openEvent} refresh={refresh} onBack={() => setTab('overview')} />
            </TabsContent>
          )}
        </Tabs>
      )}

      {events.length === 0 && (
        <Card>
          <CardContent>
            <EmptyState
              icon={<CalendarDays className="size-5" />}
              illustration={<OtterIllustration panel="A1" />}
              title={t('events.none_title')}
              description={t('events.none_desc')}
              action={<NewEventButton />}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/** One status group on the overview (Live now / Drafts / Ended). */
function EventSection({
  title, hint, events, selectedId, onOpen, refresh, tone, collapsed, onToggleCollapsed,
}: {
  title: string
  hint: string
  events: HackathonEvent[]
  selectedId: string | null
  onOpen: (id: string) => void
  refresh: () => Promise<void>
  tone: 'live' | 'draft' | 'ended'
  collapsed?: boolean
  onToggleCollapsed?: () => void
}) {
  const t = useT()
  if (events.length === 0 && collapsed === undefined) {
    // Live / drafts: keep the group visible so the layout doesn't jump around.
    return (
      <section className="flex flex-col gap-3">
        <SectionHeader title={title} hint={hint} count={0} tone={tone} />
        <Card className="border-dashed">
          <CardContent className="py-4 text-sm text-muted-foreground">{t('events.section_empty')}</CardContent>
        </Card>
      </section>
    )
  }
  if (events.length === 0 && collapsed !== undefined) return null
  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        title={title}
        hint={hint}
        count={events.length}
        tone={tone}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
      />
      {!collapsed && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {events.map((event, i) => (
            <motion.div
              key={event.id}
              className="h-full"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut', delay: Math.min(i, 5) * 0.04 }}
            >
              <EventCard
                event={event}
                isSelected={selectedId === event.id}
                onOpen={() => onOpen(event.id)}
                refresh={refresh}
              />
            </motion.div>
          ))}
        </div>
      )}
    </section>
  )
}

function SectionHeader({
  title, hint, count, tone, collapsed, onToggleCollapsed,
}: {
  title: string
  hint: string
  count: number
  tone: 'live' | 'draft' | 'ended'
  collapsed?: boolean
  onToggleCollapsed?: () => void
}) {
  const dot = tone === 'live' ? 'bg-ok' : tone === 'draft' ? 'bg-warning' : 'bg-muted-foreground'
  const body = (
    <>
      <span className={cn('size-2 rounded-full', dot)} />
      <span className="font-display text-sm uppercase tracking-wide">{title}</span>
      <Badge variant="secondary" className="text-[10px]">{count}</Badge>
      <span className="hidden text-xs text-muted-foreground sm:inline">{hint}</span>
      {onToggleCollapsed && (collapsed ? <ChevronDown className="ml-auto size-4 text-muted-foreground" /> : <ChevronUp className="ml-auto size-4 text-muted-foreground" />)}
    </>
  )
  if (onToggleCollapsed) {
    return (
      <button type="button" onClick={onToggleCollapsed} className="flex w-full items-center gap-2 text-left">
        {body}
      </button>
    )
  }
  return <div className="flex w-full items-center gap-2">{body}</div>
}

function NewEventButton() {
  const { state, refresh } = useAppContext()
  const t = useT()
  const [chooserOpen, setChooserOpen] = useState(false)
  const [open, setOpen] = useState(false)
  const [createStep, setCreateStep] = useState(0)
  const [chooserTemplateId, setChooserTemplateId] = useState<string>('')
  const [templateId, setTemplateId] = useState<string>('')
  const [formMode, setFormMode] = useState<'default' | 'template' | 'custom'>('default')
  const [formTemplateId, setFormTemplateId] = useState<string>('')
  const [customForm, setCustomForm] = useState<FormConfig>(() => JSON.parse(JSON.stringify(DEFAULT_FORM)) as FormConfig)
  const [assignmentCollectionId, setAssignmentCollectionId] = useState<string>('')
  const [embeddedAssignments, setEmbeddedAssignments] = useState<Assignment[]>([])
  const [assignmentStrategy, setAssignmentStrategy] = useState<AssignmentStrategy>('random')
  const [cleanupDelayHours, setCleanupDelayHours] = useState<number>(48)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [endsAt, setEndsAt] = useState('')
  const [signupStartsAt, setSignupStartsAt] = useState('')
  const [signupEndsAt, setSignupEndsAt] = useState('')
  const [schedule, setSchedule] = useState<import('@/types').ScheduleItem[]>([])
  const [panelChannelId, setPanelChannelId] = useState('')
  const [announceChannelId, setAnnounceChannelId] = useState('')
  const [scheduleChannelId, setScheduleChannelId] = useState('')
  const [createDiscordEvent, setCreateDiscordEvent] = useState(true)
  const [saveAsTemplate, setSaveAsTemplate] = useState(false)
  const [busy, setBusy] = useState(false)
  const [guildChannels, setGuildChannels] = useState<{ id: string; name: string }[]>([])
  const [startActions, setStartActions] = useState<import('@/types').ScheduleAction[]>([])
  const [endActions, setEndActions] = useState<import('@/types').ScheduleAction[]>([])
  const [signupActions, setSignupActions] = useState<import('@/types').ScheduleAction[]>([])
  useEffect(() => {
    api.getGuildChannels().then(r=>setGuildChannels(r.channels ?? [])).catch(()=>undefined)
  }, [])

  function changeStart(next: string) {
    const nextMs = dateInputToMs(next), oldMs = dateInputToMs(startsAt)
    if (nextMs !== null) {
      const shift = (value: string, fallback: number) => { const ms = dateInputToMs(value); return toLocalIso(new Date(ms !== null && oldMs !== null ? ms + nextMs - oldMs : ms ?? fallback)) }
      setEndsAt(shift(endsAt, nextMs + 48 * 3600000))
      setSignupStartsAt(shift(signupStartsAt, nextMs - 7 * 86400000))
      setSignupEndsAt(shift(signupEndsAt, nextMs))
      setSchedule(items => moveScheduleDates(items, oldMs, nextMs))
    }
    setStartsAt(next)
  }

  // Default signup window: 7 days before hackathon start → hackathon start, if user hasn't touched it
  useEffect(()=>{
    if (startsAt && !signupStartsAt && !signupEndsAt) {
      const s = new Date(startsAt)
      if (!isNaN(s.getTime())) {
        const ends = new Date(s)
        const starts = new Date(s)
        starts.setDate(starts.getDate() - 7)
        setSignupStartsAt(toLocalIso(starts))
        setSignupEndsAt(toLocalIso(ends))
      }
    }
  }, [startsAt])

  // Anchored (template-authored) blocks follow the dates while the user edits
  // them — same rule the server applies on save.
  useEffect(() => {
    const dates = {
      startsAt: dateInputToMs(startsAt),
      endsAt: dateInputToMs(endsAt),
      signupStartsAt: dateInputToMs(signupStartsAt),
      signupEndsAt: dateInputToMs(signupEndsAt),
    }
    setSchedule(prev => {
      const next = resolveScheduleAnchors(prev, dates)
      return next.some((it, i) => it.time !== prev[i]!.time) ? next : prev
    })
  }, [startsAt, endsAt, signupStartsAt, signupEndsAt])

  const eventTemplates = (state.templates ?? []).filter((tpl) => tpl.kind === 'event')
  const formTemplates = (state.templates ?? []).filter((tpl) => tpl.kind === 'form')
  // Assignment collections (template kind `assignments`) with their pool sizes.
  const assignmentCollections = (state.templates ?? [])
    .filter((tpl) => tpl.kind === 'assignments')
    .map((tpl) => {
      let count = 0
      try { const p = JSON.parse(tpl.json) as { assignments?: unknown[] }; if (Array.isArray(p.assignments)) count = p.assignments.length } catch { /* keep 0 */ }
      return { id: tpl.id, name: tpl.name, count }
    })
  useEffect(() => {
    const elsewhere = [...signupActions, ...endActions, ...schedule.flatMap(item => item.actions ?? [])].some(action => action.type === 'distribute_assignments')
    if (!assignmentCollectionId || elsewhere) { setStartActions(actions => actions.filter(action => action.id !== DISTRIBUTE_ACTION_ID)); return }
    setStartActions(actions => {
      const existing = actions.find(action => action.type === 'distribute_assignments')
      return existing ? actions.map(action => action.id === DISTRIBUTE_ACTION_ID ? { ...action, mode: assignmentStrategy } : action)
        : [...actions, { id: DISTRIBUTE_ACTION_ID, type: 'distribute_assignments', mode: assignmentStrategy }]
    })
  }, [assignmentCollectionId, assignmentStrategy, signupActions, endActions, schedule])
  const defaults = state.guildSettings

  function onOpenChooser() {
    setChooserOpen(true)
  }

  function openBlank() {
    setTemplateId('')
    setChooserTemplateId('')
    setAssignmentCollectionId('')
    setEmbeddedAssignments([])
    setAssignmentStrategy('random')
    setName('')
    setDescription('')
    setCleanupDelayHours(48)
    setSchedule([])
    setStartActions([])
    setSignupActions([])
    setEndActions([])
    setFormMode('default')
    setFormTemplateId('')
    setCustomForm(JSON.parse(JSON.stringify(DEFAULT_FORM)) as FormConfig)
    setCreateDiscordEvent(true)
    setChooserOpen(false)
    setCreateStep(0)
    setOpen(true)
    if (!panelChannelId && defaults.defaultPanelChannelId) setPanelChannelId(defaults.defaultPanelChannelId)
    if (!announceChannelId && defaults.defaultAnnouncementChannelId) setAnnounceChannelId(defaults.defaultAnnouncementChannelId)
    if (!scheduleChannelId && (defaults as unknown as { defaultScheduleChannelId: string | null }).defaultScheduleChannelId) setScheduleChannelId((defaults as unknown as { defaultScheduleChannelId: string | null }).defaultScheduleChannelId ?? '')
  }

  function openFromTemplate() {
    if (!chooserTemplateId) return
    applyTemplate(chooserTemplateId)
    setChooserOpen(false)
    setCreateStep(0)
    setOpen(true)
    if (!panelChannelId && defaults.defaultPanelChannelId) setPanelChannelId(defaults.defaultPanelChannelId)
    if (!announceChannelId && defaults.defaultAnnouncementChannelId) setAnnounceChannelId(defaults.defaultAnnouncementChannelId)
    if (!scheduleChannelId && (defaults as unknown as { defaultScheduleChannelId: string | null }).defaultScheduleChannelId) setScheduleChannelId((defaults as unknown as { defaultScheduleChannelId: string | null }).defaultScheduleChannelId ?? '')
  }

  function applyTemplate(id: string) {
    setTemplateId(id)
    if (id === '') return
    const tpl = eventTemplates.find((x) => x.id === id)
    if (!tpl) return
    try {
      const parsed = JSON.parse(tpl.json) as {
        name?: string;
        description?: string;
        cleanupDelayHours?: number;
        schedule?: import('@/types').ScheduleItem[];
        assignments?: Assignment[];
        assignmentCollectionId?: string;
        assignmentStrategy?: AssignmentStrategy;
      }
      setName(typeof parsed.name === 'string' ? parsed.name : tpl.name)
      setDescription(typeof parsed.description === 'string' ? parsed.description : '')
      setCleanupDelayHours(typeof parsed.cleanupDelayHours === 'number' ? parsed.cleanupDelayHours : 48)
      setFormMode('default')
      setFormTemplateId('')
      setCustomForm(JSON.parse(JSON.stringify(DEFAULT_FORM)) as FormConfig)
      {
        // Templates carry block actions on synthetic items (__start__/__signup__/
        // __end__) and real blocks with anchors — split them so the block actions
        // land in the pinned blocks the user can see, and the itinerary resolves
        // onto this event's dates.
        const normalized = consolidateSignupBlock(Array.isArray(parsed.schedule) ? parsed.schedule : [])
        const blocks = normalized.filter(s => SYNTHETIC_BLOCK_IDS.includes(s.id))
        const items = normalized.filter(s => !SYNTHETIC_BLOCK_IDS.includes(s.id))
        const pickActions = (blockId: string) => blocks.find(b => b.id === blockId)?.actions ?? []
        setStartActions(pickActions('__start__'))
        setSignupActions(pickActions('__signup__'))
        setEndActions(pickActions('__end__'))
        setSchedule(resolveScheduleAnchors(items, {
          startsAt: dateInputToMs(startsAt),
          endsAt: dateInputToMs(endsAt),
          signupStartsAt: dateInputToMs(signupStartsAt),
          signupEndsAt: dateInputToMs(signupEndsAt),
        }))
      }
      // Prefer a collection reference; fall back to legacy embedded pools (pre-collections templates).
      setEmbeddedAssignments(Array.isArray(parsed.assignments) ? parsed.assignments : [])
      if (typeof parsed.assignmentCollectionId === 'string' && parsed.assignmentCollectionId !== '') {
        setAssignmentCollectionId(parsed.assignmentCollectionId)
      } else if (Array.isArray(parsed.assignments) && parsed.assignments.length > 0) {
        setAssignmentCollectionId('__embedded')
      } else setAssignmentCollectionId('')
      setAssignmentStrategy(parsed.assignmentStrategy === 'same' ? 'same' : 'random')
      toast.info(t('events.template_applied', { name: tpl.name }))
    } catch {
      // ignore parse errors, still send templateId to server
    }
  }

  async function create(launch: boolean) {
    if (launch && formMode === 'custom' && Object.keys(questionErrors(customForm)).length > 0) {
      setCreateStep(3)
      requestAnimationFrame(() => validateQuestions(customForm))
      return
    }
    const starts = startsAt !== '' ? Date.parse(startsAt) || null : null
    const ends = endsAt !== '' ? Date.parse(endsAt) || null : null
    const signupStarts = signupStartsAt !== '' ? Date.parse(signupStartsAt) || null : null
    const signupEnds = signupEndsAt !== '' ? Date.parse(signupEndsAt) || null : null
    const parsed = createEventSchema.safeParse({
      name: name.trim(),
      ...(description.trim() !== '' ? { description: description.trim() } : {}),
      startsAt: starts,
      endsAt: ends,
      signupStartsAt: signupStarts,
      signupEndsAt: signupEnds,
    })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? t('events.invalid_input'))
      return
    }
    setBusy(true)
    try {
      // Block actions (announcements included) ride the synthetic schedule blocks
      // so the planner fires them at the block time. The old on_activate/on_start
      // announcement rows are gone — nothing ever sent those.
      const startTime = startsAt ? Date.parse(startsAt) : null
      const endTime = endsAt ? Date.parse(endsAt) : null
      const signupTime = signupStartsAt ? Date.parse(signupStartsAt) : null
      const mergedSchedule: typeof schedule = [
        ...schedule.filter(s => !SYNTHETIC_BLOCK_IDS.includes(s.id)),
        ...syntheticBlock('__signup__', signupTime, 'Signups open', signupActions),
        ...syntheticBlock('__start__', startTime, 'Event starts', startActions),
        ...syntheticBlock('__end__', endTime, 'Event ends', endActions),
      ]

      // Resolve the assignment pool from the picked collection (snapshot semantics —
      // later edits to the collection don't retroactively change this event).
      const pickedCollection = state.templates.find((tpl) => tpl.id === assignmentCollectionId && tpl.kind === 'assignments')
      let pool: Assignment[] = assignmentCollectionId === '__embedded' ? embeddedAssignments : []
      if (assignmentCollectionId && assignmentCollectionId !== '__embedded' && !pickedCollection) throw new Error(t('templates.assignment_collection_missing'))
      if (pickedCollection) {
        try { const p = JSON.parse(pickedCollection.json) as { assignments?: Assignment[] }; if (!Array.isArray(p.assignments) || p.assignments.length > 50 || p.assignments.some(item => !item || typeof item.title !== 'string' || !item.title.trim() || typeof item.instructions !== 'string' || !item.instructions.trim())) throw new Error(); pool = p.assignments } catch { throw new Error(t('templates.assignment_collection_invalid')) }
      }

      const createdEvent = await api.createEvent({
        ...parsed.data,
        ...(templateId ? { templateId } : {}),
        ...(formMode === 'custom' ? { formJson: JSON.stringify(customForm) } : formTemplateId ? { formTemplateId } : {}),
        cleanupDelayHours: cleanupDelayHours,
        ...(launch ? { launch: true } : {}),
        createDiscordEvent,
        panelChannelId: panelChannelId || null,
        announcementChannelId: announceChannelId || null,
        scheduleChannelId: scheduleChannelId || null,
        ...(mergedSchedule.length > 0 ? { schedule: mergedSchedule } : {}),
        assignments: pool,
        assignmentStrategy,
        ...(saveAsTemplate ? { saveAsTemplate: true, saveTemplateName: name.trim() } : {}),
      })
      const created = saveAsTemplate ? t('events.created_template', { name: name.trim() }) : t('events.created', { name: name.trim() })
      toast.success(launch ? t('events.launched', { name: name.trim() }) : created)
      const discordErrors = createdEvent.discordEvent?.errors ?? []
      if (createDiscordEvent && discordErrors.length > 0) {
        toast.warning(t('events.discord_event_failed', { message: discordErrors.join('; ') }), { duration: 8000 })
      }

      setOpen(false)
      setCreateStep(0)
      setChooserTemplateId('')
      setTemplateId('')
      setFormMode('default')
      setFormTemplateId('')
      setCustomForm(JSON.parse(JSON.stringify(DEFAULT_FORM)) as FormConfig)
      setName('')
      setDescription('')
      setStartsAt('')
      setEndsAt('')
      setSchedule([])
      setPanelChannelId('')
      setAnnounceChannelId('')
      setScheduleChannelId('')
      setSignupStartsAt('')
      setSignupEndsAt('')
      setStartActions([])
      setEndActions([])
      setSignupActions([])
      setCreateDiscordEvent(true)
      setSaveAsTemplate(false)
      setCleanupDelayHours(48)
      setAssignmentCollectionId('')
      setEmbeddedAssignments([])
      setAssignmentStrategy('random')
      await refresh()
    } catch (e) {
      const message = e instanceof ApiError && (e.code === 'assignment_collection_missing' || e.code === 'assignment_collection_invalid') ? t(`templates.${e.code}`) : e instanceof Error ? e.message : t('events.create_failed')
      toast.error(message)
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
                        <SelectValue placeholder={t('events.pick_event_template')} />
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
        <Dialog open onOpenChange={next => { if (!next && !busy) setOpen(false) }}>
          <DialogContent aria-modal="true" showCloseButton={false} className="sm:max-w-[min(48rem,95vw)] overflow-y-auto max-h-[85vh]">
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <DialogTitle>{t('events.create_title')}</DialogTitle>
                <DialogDescription>{t('events.create_desc')}</DialogDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setOpen(false); setChooserOpen(true) }}>
                {t('events.change_template')}
              </Button>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <ol className="flex flex-wrap items-center gap-1.5" aria-label={t('events.create_steps')}>
                {CREATE_STEPS.map((step, index) => {
                  const active = createStep === index
                  const done = createStep > index
                  return (
                    <li key={step.id}>
                      <button
                        type="button"
                        onClick={() => setCreateStep(index)}
                        aria-current={active ? 'step' : undefined}
                        className={cn(
                          'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                          active ? 'border-accent bg-accent-soft text-accent' : done ? 'border-accent/40 text-foreground' : 'border-border text-muted-foreground hover:border-accent/40',
                        )}
                      >
                        <span className={cn('grid size-5 place-items-center rounded-full text-[10px] font-bold', active ? 'bg-accent text-accent-foreground' : 'bg-surface-2')}>
                          {done ? '✓' : index + 1}
                        </span>
                        {t(step.labelKey)}
                      </button>
                    </li>
                  )
                })}
              </ol>
              <p className="text-xs text-muted-foreground">{t('events.step_of', { current: createStep + 1, total: CREATE_STEPS.length })}</p>

              {createStep === 0 && (
                <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('events.name')}</span>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('events.name_placeholder')} maxLength={100} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('events.description')}</span>
                <Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t('events.desc_placeholder')} maxLength={1000} />
              </label>
                </div>
              )}
              {createStep === 1 && (
                <ScheduleEditor
                  value={schedule}
                  onChange={setSchedule}
                  startValue={startsAt}
                  endValue={endsAt}
                  onStartChange={changeStart}
                  onEndChange={setEndsAt}
                  signupStartValue={signupStartsAt}
                  signupEndValue={signupEndsAt}
                  onSignupStartChange={setSignupStartsAt}
                  onSignupEndChange={setSignupEndsAt}
                  startActions={startActions}
                  endActions={endActions}
                  signupActions={signupActions}
                  onStartActionsChange={setStartActions}
                  onEndActionsChange={setEndActions}
                  onSignupActionsChange={setSignupActions}
                  disablePast
                />
              )}
              {createStep === 2 && (
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2/40 p-3">
                <span className="text-sm font-medium">{t('events.assignments_title')}</span>
                <span className="text-xs text-muted-foreground">{t('events.assignments_hint')}</span>
                {assignmentCollections.length > 0 || embeddedAssignments.length > 0 || !!assignmentCollectionId ? (
                  <Select value={assignmentCollectionId || '__none'} onValueChange={(v)=>setAssignmentCollectionId(v==='__none'?'':v)}>
                    <SelectTrigger className="w-72"><SelectValue placeholder={t('events.pick_collection')} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">{t('events.no_assignments')}</SelectItem>
                      {embeddedAssignments.length > 0 && <SelectItem value="__embedded">{t('templates.embedded_assignments', { count: embeddedAssignments.length })}</SelectItem>}
                      {assignmentCollectionId && assignmentCollectionId !== '__embedded' && !assignmentCollections.some(c => c.id === assignmentCollectionId) && <SelectItem value={assignmentCollectionId} disabled>{t('templates.assignment_collection_unavailable')}</SelectItem>}
                      {assignmentCollections.map(c => <SelectItem key={c.id} value={c.id}>{c.name} ({c.count})</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="rounded-lg border border-dashed border-border bg-background px-3 py-2 text-sm text-muted-foreground">{t('events.no_collections')}</p>
                )}
                {assignmentCollectionId !== '' && (
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium">{t('events.distribution_strategy')}</span>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {STRATEGY_OPTIONS.map(opt => {
                        const Icon = opt.icon
                        const selected = assignmentStrategy === opt.id
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => setAssignmentStrategy(opt.id)}
                            className={cn(
                              "flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                              selected ? "border-accent bg-background ring-1 ring-accent" : "border-border bg-surface-2 hover:border-accent/40"
                            )}
                          >
                            <Icon className={cn("mt-0.5 size-4 shrink-0", selected ? "text-accent" : "text-muted-foreground")} />
                            <span>
                              <span className="block text-sm font-medium">{t(opt.labelKey)}</span>
                              <span className="block text-xs text-muted-foreground">{t(opt.hintKey)}</span>
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
              )}

              {createStep === 3 && (
              <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2/40 p-3">
                <span className="text-sm font-medium">{t('events.form_section')}</span>
                <div className="grid gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => { setFormMode('default'); setFormTemplateId('') }}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      formMode === 'default' ? "border-accent bg-background ring-1 ring-accent" : "border-border bg-surface-2 hover:border-accent/40"
                    )}
                  >
                    <FileCheck className={cn("size-4", formMode === 'default' ? "text-accent" : "text-muted-foreground")} />
                    <span>
                      <span className="block text-sm font-medium">{t('events.form_default')}</span>
                      <span className="block text-xs text-muted-foreground">{t('events.form_default_desc')}</span>
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
                  <button
                    type="button"
                    onClick={() => setFormMode('custom')}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors",
                      formMode === 'custom' ? "border-accent bg-background ring-1 ring-accent" : "border-border bg-surface-2 hover:border-accent/40"
                    )}
                  >
                    <FilePlus className={cn("size-4", formMode === 'custom' ? "text-accent" : "text-muted-foreground")} />
                    <span>
                      <span className="block text-sm font-medium">{t('events.form_build')}</span>
                      <span className="block text-xs text-muted-foreground">{t('events.form_build_desc')}</span>
                    </span>
                  </button>
                </div>
                {formMode === 'template' && (
                  <div className="flex flex-col gap-1.5">
                    <Select value={formTemplateId} onValueChange={setFormTemplateId}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('events.pick_form_template')} />
                      </SelectTrigger>
                      <SelectContent>
                        {formTemplates.map((tpl) => (
                          <SelectItem key={tpl.id} value={tpl.id}>
                            {tpl.name}{tpl.id === defaults.defaultFormTemplateId ? ` ${t('events.form_default_suffix')}` : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {formTemplateId !== '' && (() => {
                      const tpl = formTemplates.find((x) => x.id === formTemplateId)
                      if (!tpl) return null
                      try {
                        const f = JSON.parse(tpl.json) as FormConfig
                        return (
                          <p className="text-xs text-muted-foreground">
                            {f.title || tpl.name} · {t('events.form_summary', { team: f.teamSize, exp: f.experiences.length, skills: f.skills.length })}
                          </p>
                        )
                      } catch { return null }
                    })()}
                  </div>
                )}
                {formMode === 'custom' && (
                  <div className="rounded-lg border border-border bg-background p-3">
                    <FormConfigEditor value={customForm} onChange={setCustomForm} />
                  </div>
                )}
                <span className="text-xs text-muted-foreground">
                  {formMode === 'default' ? t('events.form_default_hint') : formMode === 'template' ? t('events.form_template_hint') : t('events.form_build_hint')}
                </span>
              </div>
              )}

              {createStep === 1 && (guildChannels.length > 0 ? (
                <div className="grid items-start gap-4 lg:grid-cols-3">
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium">{t('events.panel_channel')}</span>
                    <Select value={panelChannelId || '__none'} onValueChange={(v)=>setPanelChannelId(v==='__none'?'':v)}>
                      <SelectTrigger><SelectValue placeholder={t('events.pick_channel')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">{t('events.channel_default')}</SelectItem>
                        {guildChannels.map(c=> <SelectItem key={c.id} value={c.id}>#{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium">{t('events.announce_channel')}</span>
                    <Select value={announceChannelId || '__none'} onValueChange={(v)=>setAnnounceChannelId(v==='__none'?'':v)}>
                      <SelectTrigger><SelectValue placeholder={t('events.channel_panel_default')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">{t('events.channel_default_panel')}</SelectItem>
                        {guildChannels.map(c=> <SelectItem key={c.id} value={c.id}>#{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </label>
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium">{t('events.channel_itinerary')}</span>
                    <Select value={scheduleChannelId || '__none'} onValueChange={(v)=>setScheduleChannelId(v==='__none'?'':v)}>
                      <SelectTrigger><SelectValue placeholder={t('events.channel_itinerary_placeholder')} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none">{t('events.channel_config_default')}</SelectItem>
                        {guildChannels.map(c=> <SelectItem key={c.id} value={c.id}>#{c.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </label>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-surface-2/40 px-3 py-2.5 text-sm text-muted-foreground">
                  {t('events.channel_unavailable')}
                </div>
              ))}

              {createStep === 0 && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-2/40 px-3 py-2.5">
                <span className="text-sm font-medium">{t('events.cleanup_delay')}</span>
                <Input
                  type="number"
                  min={0}
                  max={720}
                  value={String(cleanupDelayHours)}
                  onChange={(e) => setCleanupDelayHours(Math.min(720, Math.max(0, Number(e.target.value) || 0)))}
                  className="h-8 w-20"
                  aria-label={t('events.cleanup_delay_aria')}
                />
                <span className="text-xs text-muted-foreground">{t('events.cleanup_delay_hint')}</span>
              </div>
              )}

              {createStep === 1 && (
              <label className={cn('flex items-center gap-2 rounded-lg border border-border bg-surface-2/40 px-3 py-2.5 text-sm', startsAt === '' && 'opacity-60')}>
                <Checkbox checked={createDiscordEvent && startsAt !== ''} onCheckedChange={setCreateDiscordEvent} disabled={startsAt === ''} />
                <span className="flex flex-col">
                  <span className="font-medium">{t('events.create_discord_event')}</span>
                  <span className="text-xs text-muted-foreground">{startsAt === '' ? t('events.create_discord_event_needs_date') : t('events.create_discord_event_hint')}</span>
                </span>
              </label>
              )}

              {createStep === 4 && (
              <div className="flex flex-col gap-4">
                <div className="rounded-lg border border-border bg-surface-2/40 p-4">
                  <h3 className="font-display text-lg">{name.trim() || t('events.untitled')}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{description.trim() || t('events.no_description')}</p>
                  <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <div><dt className="text-xs text-muted-foreground">{t('events.starts')}</dt><dd>{startsAt ? dateTime(Date.parse(startsAt)) : t('events.not_set')}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t('events.ends')}</dt><dd>{endsAt ? dateTime(Date.parse(endsAt)) : t('events.not_set')}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t('events.signup_window')}</dt><dd>{signupStartsAt ? dateTime(Date.parse(signupStartsAt)) : t('events.not_set')} – {signupEndsAt ? dateTime(Date.parse(signupEndsAt)) : t('events.not_set')}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t('events.assignment_collection')}</dt><dd>{assignmentCollectionId === '__embedded' ? t('templates.embedded_assignments', { count: embeddedAssignments.length }) : assignmentCollectionId ? (state.templates.find(tpl => tpl.id === assignmentCollectionId)?.name ?? t('events.not_set')) : t('events.no_assignments')}</dd></div>
                  </dl>
                  <p className="mt-3 text-xs text-muted-foreground">{t('events.draft_hint')}</p>
                </div>
              <label className="flex items-center gap-2 rounded-lg border border-border bg-surface-2/40 px-3 py-2.5 text-sm">
                <Checkbox checked={saveAsTemplate} onCheckedChange={setSaveAsTemplate} />
                <span className="flex flex-col">
                  <span className="font-medium">{t('events.save_template')}</span>
                  <span className="text-xs text-muted-foreground">{t('events.save_template_hint')}</span>
                </span>
              </label>
              </div>
              )}

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
                <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
                {createStep > 0 && (
                  <Button variant="outline" onClick={() => setCreateStep(step => Math.max(0, step - 1))}>
                    <ChevronLeft />
                    {t('events.back')}
                  </Button>
                )}
                <Button variant="secondary" disabled={busy || name.trim().length < 3} onClick={() => void create(false)}>
                  <FilePlus />
                  {t('events.save_draft')}
                </Button>
                {createStep < CREATE_STEPS.length - 1 ? (
                  <Button disabled={name.trim().length < 3} onClick={() => setCreateStep(step => Math.min(CREATE_STEPS.length - 1, step + 1))}>
                    {t('events.next')}
                    <ArrowRight />
                  </Button>
                ) : (
                  <Button disabled={busy || name.trim().length < 3} onClick={() => void create(true)}>
                    <Send />
                    {t('events.create_launch')}
                  </Button>
                )}
              </div>
            </CardContent>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

/**
 * The per-event workspace: information + actions only. Configuration (cleanup
 * delay, dates, schedule, form, assignments) lives in the Edit dialog, which is
 * one click away from the sticky action bar instead of a scroll journey.
 */
function EventWorkspace({ event, refresh, onBack }: { event: HackathonEvent; refresh: () => Promise<void>; onBack: () => void }) {
  const { state } = useAppContext()
  const t = useT()
  const [editOpen, setEditOpen] = useState(false)
  const [showImports, setShowImports] = useState(false)
  const [showSubmissions, setShowSubmissions] = useState(false)
  const [busy, setBusy] = useState<'match' | 'lock' | null>(null)
  const [discordBusy, setDiscordBusy] = useState(false)
  const sorted = [...(event.schedule ?? [])]
    .filter((s) => !SYNTHETIC_BLOCK_IDS.includes(s.id))
    .sort((a, b) => a.time - b.time)
  const ended = event.status === 'ended'
  let importForm = state.config
  try { if (event.formJson) importForm = JSON.parse(event.formJson) as FormConfig } catch { /* keep the current guild form */ }

  async function matchNow() {
    setBusy('match')
    try {
      const preview = await api.matchPreview(event.id)
      const res = await api.matchCommit(event.id, preview.revision)
      toast.success(t('events.match_done', { count: res.teams.length }))
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('events.match_failed'))
    } finally {
      setBusy(null)
    }
  }

  async function toggleLock() {
    setBusy('lock')
    try {
      if (event.matchLocked) {
        await api.matchUnlock(event.id)
        toast.success(t('events.teams_unlocked'))
      } else {
        await api.matchLock(event.id)
        toast.success(t('events.teams_locked'))
      }
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('events.save_failed'))
    } finally {
      setBusy(null)
    }
  }

  async function syncDiscordEvent() {
    setDiscordBusy(true)
    try {
      const res = await api.syncDiscordEvent(event.id)
      if (res.created.length > 0) toast.success(t('events.discord_event_created'))
      else if (res.updated.length > 0) toast.success(t('events.discord_event_updated'))
      await refresh()
    } catch (e) {
      toast.error(t('events.discord_event_failed', { message: e instanceof Error ? e.message : t('events.save_failed') }), { duration: 8000 })
    } finally {
      setDiscordBusy(false)
    }
  }

  const statusBadge = event.status === 'active'
    ? <Badge variant="success">{t('events.live')}</Badge>
    : event.status === 'draft'
      ? <Badge variant="warning">{t('events.status_draft')}</Badge>
      : <Badge variant="secondary">{t('events.status_ended')}</Badge>

  return (
    <Card className={cn('border-border', event.status === 'active' && 'border-accent/40')}>
      <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {event.status === 'active' && (
              <span className="relative flex size-2.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok opacity-60" />
                <span className="relative inline-flex size-2.5 rounded-full bg-ok" />
              </span>
            )}
            <CardTitle className="font-display text-xl">{event.name}</CardTitle>
            {statusBadge}
          </div>
          {event.description !== '' && (
            <CardDescription className="mt-1 max-w-2xl">{event.description}</CardDescription>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ChevronLeft />
          {t('events.back_overview')}
        </Button>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {/* Actions first — they are the reason you opened the event. Offset below
            the mobile shell header so the two sticky bars don't overlap. */}
        <div className="sticky top-14 z-[5] flex flex-wrap items-center gap-2 rounded-xl border border-border bg-background/95 p-2.5 backdrop-blur [&_button]:h-11 [&_a]:h-11 sm:[&_button]:h-7 sm:[&_a]:h-7 lg:top-4">
          <Button variant="secondary" size="sm" className="!h-11 sm:!h-7" onClick={() => setEditOpen(true)}>
            <Pencil />
            {t('events.edit_event')}
          </Button>
          {event.status === 'active' && (
            <Button asChild variant="outline" size="sm">
              <a className="!h-11 sm:!h-7" href={`/events/${encodeURIComponent(event.id)}`} target="_blank" rel="noreferrer">
                <ExternalLink />
                {t('events.public_preview')}
              </a>
            </Button>
          )}
          {!ended && <NotificationButtons event={event} refresh={refresh} />}
          <Button variant={showImports ? 'secondary' : 'outline'} size="sm" className="!h-11 sm:!h-7" onClick={() => setShowImports(value => !value)}>
            <FileCheck />
            {showImports ? t('imports.back_to_event') : t('imports.action')}
          </Button>
          <Button variant={showSubmissions ? 'secondary' : 'outline'} size="sm" className="!h-11 sm:!h-7" onClick={() => setShowSubmissions(value => !value)}><ClipboardList />{t('submission.manage')}</Button>
          {!ended && (
            <>
              <Button variant="outline" size="sm" className="!h-11 sm:!h-7" disabled={busy !== null} onClick={() => void matchNow()}>
                <UsersRound />
                {t('events.match_now')}
              </Button>
              <Button variant="outline" size="sm" className="!h-11 sm:!h-7" disabled={busy !== null} onClick={() => void toggleLock()}>
                {event.matchLocked ? <Unlock /> : <Lock />}
                {event.matchLocked ? t('events.unlock_teams') : t('events.lock_teams')}
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="!h-11 sm:!h-7"
            onClick={() => { void copyText(event.id).then(copied => copied ? toast.info(t('events.id_copied')) : toast.error(t('events.id_copy_failed'))) }}
          >
            <Copy />
            {t('events.copy_id')}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            {!ended && <EndEventButton event={event} refresh={refresh} />}
            {ended && (
              <span className="text-xs text-muted-foreground">{t('events.ended_readonly')}</span>
            )}
          </div>
        </div>

        {showImports && <ImportedSignups eventId={event.id} eventName={event.name} form={importForm} />}
        {showSubmissions && <SubmissionManager key={event.id} eventId={event.id} baseForm={importForm} readOnly={ended} />}

        {sorted.length > 0 && (
          <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-2/40 p-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('events.schedule')}</span>
            <div className="flex flex-col gap-1.5">
              {sorted.map((it) => (
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
            <span className="text-xs text-muted-foreground">{t('events.schedule_edit_hint')}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
          {event.signupStartsAt !== null || event.signupEndsAt !== null ? (
            <div className="flex items-center gap-2">
              <ClipboardList className="size-4 text-primary" />
              <div>
                <div className="text-muted-foreground text-xs">{t('events.signup_window')}</div>
                <div>
                  {event.signupStartsAt !== null && event.signupEndsAt !== null
                    ? `${dateTime(event.signupStartsAt)} → ${dateTime(event.signupEndsAt)}`
                    : event.signupStartsAt !== null
                      ? `from ${dateTime(event.signupStartsAt)}`
                      : event.signupEndsAt !== null
                        ? `until ${dateTime(event.signupEndsAt)}`
                        : t('common.not_set')}
                </div>
              </div>
            </div>
          ) : null}
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-accent" />
            <div>
              <div className="text-muted-foreground text-xs">{t('events.hackathon_starts')}</div>
              <div>{event.startsAt !== null ? `${dateTime(event.startsAt)} (${timeAgo(event.startsAt)})` : t('common.not_set')}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CalendarDays className="size-4 text-danger" />
            <div>
              <div className="text-muted-foreground text-xs">{t('events.hackathon_ends')}</div>
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
            <CalendarPlus className="size-4 text-accent" />
            <div>
              <div className="text-muted-foreground text-xs">{t('events.discord_event')}</div>
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  {event.discordEventIds.length > 0
                    ? t('events.discord_event_linked', { count: event.discordEventIds.length })
                    : t('events.discord_event_missing')}
                </span>
                {!ended && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto px-1 py-0 text-xs"
                    disabled={discordBusy || event.startsAt === null}
                    title={event.startsAt === null ? t('events.discord_event_needs_date') : undefined}
                    onClick={() => void syncDiscordEvent()}
                  >
                    {event.discordEventIds.length > 0 ? t('events.discord_event_sync') : t('events.discord_event_create')}
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <CalendarClock className="size-4 text-accent" />
            <div>
              <div className="text-muted-foreground text-xs">Auto-match</div>
              <div className="flex items-center gap-1.5">
                <span>
                  {event.matchAt !== null
                    ? `Runs ${dateTime(event.matchAt)} (${timeAgo(event.matchAt)})`
                    : t('events.match_not_scheduled')}
                </span>
                {event.matchLocked && (
                  <span className="flex items-center gap-1 font-medium text-ok">
                    <Lock className="size-3" />
                    {t('events.match_locked')}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <InsightsSection participants={state.participants} config={state.config} />
      </CardContent>
      {editOpen && <EditableSchedule event={event} refresh={refresh} open onClose={() => setEditOpen(false)} />}
    </Card>
  )
}

const DISTRIBUTE_ACTION_ID = '__distribute_assignments__'

/**
 * Synthetic schedule blocks are the carriers of block actions: the planner
 * fires their actions at the block's time. Returns [] when the block has no
 * time or no actions, except an undated start block retains its actions as a
 * pending anchor until the event gets a start date.
 */
function syntheticBlock(
  id: string,
  time: number | null,
  title: string,
  actions: import('@/types').ScheduleAction[],
): import('@/types').ScheduleItem[] {
  // Synthetic blocks are anchored placeholders: a missing date keeps them pending
  // (time 0 + anchor) instead of dropping them, so a chosen action like "post
  // signup" survives until its anchor date is set instead of being silently lost.
  if (actions.length === 0) return []
  if (time === null && id !== '__start__' && id !== '__signup__' && id !== '__end__') return []
  const anchor =
    id === '__start__' ? 'hackathon_start' :
    id === '__signup__' ? 'signup_start' :
    id === '__end__' ? 'hackathon_end' :
    undefined
  return [{ id, time: time ?? 0, title, kind: 'custom', actions, ...(anchor ? { anchor: anchor as 'hackathon_start' | 'signup_start' | 'hackathon_end', offsetMinutes: 0 } : {}) }]
}

function dateInputToMs(v: string): number | null {
  if (v === '') return null
  const ms = Date.parse(v)
  return Number.isNaN(ms) ? null : ms
}

/**
 * Keep the Start block's distribute action in step with the event's assignment
 * pool — the same contract `createEvent` applies server-side via
 * `withAssignmentDistribution`: non-empty pool ⇒ a distribute action on Start,
 * empty pool ⇒ none. The create dialog picks the strategy in its Assignments
 * card; here the mode is edited on the Start block's distribute card itself.
 */
function syncDistribute(ops: import('@/types').ScheduleAction[], pool: Assignment[]): import('@/types').ScheduleAction[] {
  const hasDistribute = ops.some(a => a.type === 'distribute_assignments')
  if (pool.length > 0 && !hasDistribute) {
    return [...ops, { id: DISTRIBUTE_ACTION_ID, type: 'distribute_assignments', mode: 'random' }]
  }
  if (pool.length === 0) return ops.filter(a => a.type !== 'distribute_assignments')
  return ops
}

/**
 * The event edit dialog. Rendered on demand by its parent (which owns the
 * open/close state) so the trigger button can live anywhere on the card.
 */
function EditableSchedule({ event, refresh, open, onClose }: { event: HackathonEvent; refresh: () => Promise<void>; open: boolean; onClose: () => void }) {
  const { state } = useAppContext()
  const t = useT()
  const formTemplates = (state.templates ?? []).filter((tpl) => tpl.kind === 'form')
  const themeTemplates = (state.templates ?? []).filter((tpl) => tpl.kind === 'theme')
  // Legacy announcement records have no delivery receipts. Preserve them as
  // presets rather than silently turning them into potentially repeated sends.
  // Block actions live on the synthetic schedule items (__start__/__signup__/
  // __end__) — announcements included.
  const deriveStart = (ev: HackathonEvent) => {
    const actions = consolidateSignupBlock(ev.schedule ?? []).find(s=>s.id==='__start__')?.actions ?? []
    const alreadyScheduled = (ev.schedule ?? []).some(item => item.actions?.some(action => action.type === 'distribute_assignments'))
    return ev.startsAt === null && !alreadyScheduled ? syncDistribute(actions, ev.assignments ?? []) : actions
  }
  const deriveEnd = (ev: HackathonEvent) => consolidateSignupBlock(ev.schedule ?? []).find(s=>s.id==='__end__')?.actions ?? []
  const hasLegacyAnnouncements = (event.announcements ?? []).some(a => a.trigger === 'on_activate' || a.trigger === 'on_start')
  const deriveSignup = (ev: HackathonEvent) =>
    (consolidateSignupBlock(ev.schedule ?? []).find(s=>s.id==='__signup__')?.actions ?? []) as import('@/types').ScheduleAction[]
  const deriveItems = (ev: HackathonEvent) => consolidateSignupBlock(ev.schedule ?? []).filter(s=>!SYNTHETIC_BLOCK_IDS.includes(s.id))

  const [items, setItems] = useState(()=>deriveItems(event))
  const [start, setStart] = useState(event.startsAt ? toLocalIso(new Date(event.startsAt)) : "")
  const [end, setEnd] = useState(event.endsAt ? toLocalIso(new Date(event.endsAt)) : "")
  const [signupStart, setSignupStart] = useState(event.signupStartsAt ? toLocalIso(new Date(event.signupStartsAt)) : "")
  const [signupEnd, setSignupEnd] = useState(event.signupEndsAt ? toLocalIso(new Date(event.signupEndsAt)) : "")
  const [enforceSignupWindow, setEnforceSignupWindow] = useState(() => { try { return !!event.formJson && (JSON.parse(event.formJson) as FormConfig).enforceSignupWindow === true } catch { return false } })
  const [signupPolicyDirty, setSignupPolicyDirty] = useState(false)
  const [editAssignments, setEditAssignments] = useState<Assignment[]>(()=> (event.assignments ?? []))
  const [pendingAssignment, setPendingAssignment] = useState(false)
  const [editCleanup, setEditCleanup] = useState<number>(event.cleanupDelayHours)
  const [editTeamSize, setEditTeamSize] = useState<number>(() => {
    try { return (event.formJson ? JSON.parse(event.formJson) as FormConfig : state.config).teamSize ?? 4 } catch { return state.config.teamSize ?? 4 }
  })
  const [editName, setEditName] = useState(event.name)
  const [editDescription, setEditDescription] = useState(event.description)
  const [editFormTemplateId, setEditFormTemplateId] = useState<string>('')
  const [draftForm, setDraftForm] = useState<FormConfig>(() => { try { return event.formJson ? JSON.parse(event.formJson) as FormConfig : state.config } catch { return state.config } })
  const [draftFormDirty, setDraftFormDirty] = useState(false)
  const [appearance, setAppearance] = useState<FormAppearance>(() => {
    try { return resolveAppearance(event.formJson ? JSON.parse(event.formJson) as FormConfig : state.config) }
    catch { return resolveAppearance(state.config) }
  })
  const [appearanceDirty, setAppearanceDirty] = useState(false)
  const [startActions, setStartActions] = useState<import('@/types').ScheduleAction[]>(()=>deriveStart(event))
  const [endActions, setEndActions] = useState<import('@/types').ScheduleAction[]>(()=>deriveEnd(event))
  const [signupActions, setSignupActions] = useState<import('@/types').ScheduleAction[]>(()=>deriveSignup(event))
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [editTab, setEditTab] = useState<'basics' | 'schedule' | 'assignments' | 'form' | 'theme'>('basics')

  function changeStart(next: string) {
    const nextMs = dateInputToMs(next), oldMs = dateInputToMs(start)
    if (nextMs !== null) {
      const shift = (value: string, fallback: number) => { const ms = dateInputToMs(value); return toLocalIso(new Date(ms !== null && oldMs !== null ? ms + nextMs - oldMs : ms ?? fallback)) }
      setEnd(shift(end, nextMs + 48 * 3600000))
      setSignupStart(shift(signupStart, nextMs - 7 * 86400000))
      setSignupEnd(shift(signupEnd, nextMs))
      setItems(items => moveScheduleDates(items, oldMs, nextMs))
    }
    setStart(next)
  }

  // Anchored blocks follow the dates while the user edits them.
  useEffect(() => {
    const dates = {
      startsAt: dateInputToMs(start),
      endsAt: dateInputToMs(end),
      signupStartsAt: dateInputToMs(signupStart),
      signupEndsAt: dateInputToMs(signupEnd),
    }
    setItems(prev => {
      const next = resolveScheduleAnchors(prev, dates)
      return next.some((it, i) => it.time !== prev[i]!.time) ? next : prev
    })
  }, [start, end, signupStart, signupEnd])

  // No reset effect needed: the parent mounts this dialog only while it is open,
  // so the useState initializers above already take a fresh snapshot of the event
  // each time — and in-progress edits can't be clobbered by a background refresh.

  async function save() {
    if (busy || pendingAssignment) return
    setBusy(true)
    setSaveError('')
    try {
      // Keep legacy announcement records untouched: they do not carry receipts
      // that would tell us whether converting them is safe to send again.
      const elsewhere = [...signupActions, ...endActions, ...items.flatMap(item => item.actions ?? [])].some(action => action.type === 'distribute_assignments')
      if (editAssignments.length && !elsewhere && !startActions.some(action => action.type === 'distribute_assignments')) throw new Error(t('events.assignment_action_required'))
      const startOps = startActions
      const extra: typeof items = [
        ...syntheticBlock('__signup__', signupStart ? Date.parse(signupStart) : null, 'Signups open', signupActions),
        ...syntheticBlock('__start__', start ? Date.parse(start) : null, 'Event starts', startOps),
        ...syntheticBlock('__end__', end ? Date.parse(end) : null, 'Event ends', endActions),
      ]
      const merged = [...items.filter(s => !SYNTHETIC_BLOCK_IDS.includes(s.id)), ...extra]
      await api.updateEvent(event.id, {
        name: editName.trim(),
        description: editDescription,
        schedule: merged,
        startsAt: start ? Date.parse(start) : null,
        endsAt: end ? Date.parse(end) : null,
        signupStartsAt: signupStart ? Date.parse(signupStart) : null,
        signupEndsAt: signupEnd ? Date.parse(signupEnd) : null,
        assignments: editAssignments as never,
        cleanupDelayHours: editCleanup,
      })
      // Form change is a separate endpoint — only call it when the user picked one.
      if (editFormTemplateId || draftFormDirty || appearanceDirty || signupPolicyDirty || editTeamSize !== (() => { try { return (event.formJson ? JSON.parse(event.formJson) as FormConfig : state.config).teamSize ?? 4 } catch { return state.config.teamSize ?? 4 } })()) {
        if (draftFormDirty || appearanceDirty || signupPolicyDirty || editTeamSize !== (() => { try { return (event.formJson ? JSON.parse(event.formJson) as FormConfig : state.config).teamSize ?? 4 } catch { return state.config.teamSize ?? 4 } })()) {
          const template = formTemplates.find(item => item.id === editFormTemplateId)
          const base = template ? JSON.parse(template.json) as FormConfig : draftFormDirty ? draftForm : event.formJson ? JSON.parse(event.formJson) as FormConfig : state.config
          await api.setEventForm(event.id, { formJson: JSON.stringify({ ...base, ...(appearanceDirty ? { appearance } : {}), ...(signupPolicyDirty ? { enforceSignupWindow } : {}), ...(editTeamSize !== (() => { try { return (event.formJson ? JSON.parse(event.formJson) as FormConfig : state.config).teamSize ?? 4 } catch { return state.config.teamSize ?? 4 } })() ? { teamSize: editTeamSize } : {}) }) })
        } else await api.setEventForm(event.id, { formTemplateId: editFormTemplateId })
        setEditFormTemplateId('')
      }
      toast.success(t('events.schedule_saved'))
      onClose()
      await refresh()
    } catch (e) {
      const message = e instanceof Error && 'code' in e && e.code === 'form_version_conflict' ? t('events.form_conflict') : e instanceof Error ? e.message : t('events.schedule_save_failed')
      setSaveError(message)
      toast.error(message)
    } finally { setBusy(false) }
  }

  return (
    <>
      {open && (
        <Dialog open={open} onOpenChange={next => { if (!next && !busy) onClose() }}>
          <DialogContent aria-modal="true" showCloseButton={false} onPointerDownOutside={event => event.preventDefault()} onEscapeKeyDown={event => { if (pendingAssignment) event.preventDefault() }} className="grid-cols-[minmax(0,1fr)] sm:max-w-[min(56rem,95vw)] max-h-[85vh] overflow-x-hidden overflow-y-auto">
            <CardHeader className="min-w-0">
              <DialogTitle>{t('events.edit_schedule_title')}</DialogTitle>
              <DialogDescription>{t('events.edit_schedule_desc')}</DialogDescription>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-4">
              {saveError && <div role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger"><p>{saveError}</p><Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void save()} disabled={busy || pendingAssignment}>{t('events.retry_save')}</Button></div>}
              <Tabs value={editTab} onValueChange={(next) => setEditTab(next as typeof editTab)} className="min-w-0 gap-4">
                <TabsList variant="line" className="w-full justify-start overflow-x-auto">
                  <TabsTrigger value="basics"><ClipboardList className="size-3.5" />{t('events.tab_basics')}</TabsTrigger>
                  <TabsTrigger value="schedule"><CalendarClock className="size-3.5" />{t('events.tab_schedule')}</TabsTrigger>
                  <TabsTrigger value="assignments"><UsersRound className="size-3.5" />{t('events.tab_assignments')}</TabsTrigger>
                  <TabsTrigger value="form"><FileCheck className="size-3.5" />{t('events.tab_form')}</TabsTrigger>
                  <TabsTrigger value="theme"><LayoutTemplate className="size-3.5" />{t('events.tab_theme')}</TabsTrigger>
                </TabsList>

                <TabsContent value="basics" className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('events.name')}</span>
                <Input value={editName} onChange={(e)=>setEditName(e.target.value)} maxLength={100} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('events.description')}</span>
                <Textarea value={editDescription} onChange={(e)=>setEditDescription(e.target.value)} maxLength={1000} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('events.team_size')}</span>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={2}
                    max={25}
                    value={String(editTeamSize)}
                    onChange={(e) => setEditTeamSize(Math.min(25, Math.max(2, Number(e.target.value) || 2)))}
                    className="h-8 w-20"
                    aria-label={t('events.team_size_aria')}
                  />
                  <span className="text-xs text-muted-foreground">{t('events.team_size_hint')}</span>
                </div>
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('events.cleanup_delay')}</span>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    max={720}
                    value={String(editCleanup)}
                    onChange={(e) => setEditCleanup(Math.min(720, Math.max(0, Number(e.target.value) || 0)))}
                    className="h-8 w-20"
                    aria-label={t('events.cleanup_delay_aria')}
                  />
                  <span className="text-xs text-muted-foreground">{t('events.cleanup_delay_hint')}</span>
                </div>
              </label>
                </TabsContent>

                <TabsContent value="schedule" className="flex flex-col gap-4">
              {hasLegacyAnnouncements && <details className="rounded-lg border border-border bg-surface-2 p-3 text-sm">
                <summary className="cursor-pointer font-medium">{t('events.legacy_announcements_title')}</summary>
                <p className="mt-2 text-muted-foreground">{t('events.legacy_announcements_preserved')}</p>
                {(event.announcements ?? []).filter(a => a.trigger === 'on_activate' || a.trigger === 'on_start').map(a => <div key={a.id} className="mt-3 whitespace-pre-wrap break-words"><strong>{a.title}</strong><p className="text-muted-foreground">{a.message}</p></div>)}
              </details>}
              <ScheduleEditor
                value={items}
                onChange={setItems}
                startValue={start}
                endValue={end}
                onStartChange={changeStart}
                onEndChange={setEnd}
                signupStartValue={signupStart}
                signupEndValue={signupEnd}
                onSignupStartChange={setSignupStart}
                onSignupEndChange={setSignupEnd}
                startActions={startActions}
                endActions={endActions}
                signupActions={signupActions}
                onStartActionsChange={setStartActions}
                onEndActionsChange={setEndActions}
                onSignupActionsChange={setSignupActions}
                disablePast
              />
              <label className="flex items-start gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" checked={enforceSignupWindow} onChange={e => { setEnforceSignupWindow(e.target.checked); setSignupPolicyDirty(true) }} className="mt-1" /><span><strong>{t('events.enforce_signup_window')}</strong><span className="mt-1 block text-muted-foreground">{t('events.enforce_signup_help')}</span></span></label>
                </TabsContent>

                <TabsContent value="assignments" forceMount className="flex flex-col gap-4 data-[state=inactive]:hidden">
              <div className="space-y-2">
                <Label>{t('events.assignment_collection')}</Label>
                <Select value="" disabled={pendingAssignment} onValueChange={id => {
                  const template = state.templates?.find(template => template.id === id && template.kind === 'assignments')
                  if (!template) return
                  try { const pool = JSON.parse(template.json).assignments as Assignment[]; if (Array.isArray(pool)) { setEditAssignments(pool); if (![...signupActions, ...endActions, ...items.flatMap(item => item.actions ?? [])].some(action => action.type === 'distribute_assignments')) setStartActions(actions => syncDistribute(actions, pool)) } } catch { /* retain current pool */ }
                }}>
                  <SelectTrigger aria-label={t('events.assignment_collection')}><SelectValue placeholder={t('events.pick_assignment_collection')} /></SelectTrigger>
                  <SelectContent>{state.templates?.filter(template => template.kind === 'assignments').map(template => <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <AssignmentsEditor value={editAssignments} onPendingChange={setPendingAssignment} onChange={pool => {
                setEditAssignments(pool)
                if (![...signupActions, ...endActions, ...items.flatMap(item => item.actions ?? [])].some(action => action.type === 'distribute_assignments')) setStartActions(actions => syncDistribute(actions, pool))
              }} />
                </TabsContent>

                <TabsContent value="form" className="flex flex-col gap-4">
              {event.status === 'draft' && !editFormTemplateId && <FormConfigEditor
                value={{ ...draftForm, ...(appearanceDirty ? { appearance } : {}), ...(signupPolicyDirty ? { enforceSignupWindow } : {}), ...(editTeamSize !== (() => { try { return (event.formJson ? JSON.parse(event.formJson) as FormConfig : state.config).teamSize ?? 4 } catch { return state.config.teamSize ?? 4 } })() ? { teamSize: editTeamSize } : {}) }}
                onChange={next => {
                  setDraftForm(next)
                  setDraftFormDirty(true)
                  setAppearance(resolveAppearance(next))
                  setAppearanceDirty(false)
                  setEnforceSignupWindow(next.enforceSignupWindow === true)
                  setSignupPolicyDirty(false)
                  setEditTeamSize(next.teamSize)
                }}
              />}
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('events.change_form')}</span>
                <Select value={editFormTemplateId} onValueChange={setEditFormTemplateId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('events.pick_form_template')} />
                  </SelectTrigger>
                  <SelectContent>
                    {formTemplates.map((tpl) => (
                      <SelectItem key={tpl.id} value={tpl.id}>{tpl.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">{t('events.keep_form')}</span>
              </label>
                </TabsContent>

                <TabsContent value="theme" className="flex flex-col gap-4">
              <section className="space-y-3"><h3 className="font-semibold">{t('form.appearance')}</h3>
                {themeTemplates.length > 0 && <label className="flex flex-col gap-2 text-sm"><span>{t('form.saved_theme')}</span><Select value="" onValueChange={id => { const theme = themeTemplates.find(item => item.id === id); if (!theme) return; try { setAppearance(JSON.parse(theme.json) as FormAppearance); setAppearanceDirty(true) } catch { toast.error(t('form.theme_invalid')) } }}><SelectTrigger aria-label={t('form.saved_theme')}><SelectValue placeholder={t('form.apply_theme')} /></SelectTrigger><SelectContent>{themeTemplates.map(theme => <SelectItem key={theme.id} value={theme.id}>{theme.name === 'Default' ? t('form.default_theme') : theme.name === 'Halloween' ? t('form.halloween') : theme.name === 'Christmas' ? t('form.christmas') : theme.name}</SelectItem>)}</SelectContent></Select></label>}
                <AppearanceControls value={appearance} onChange={next => { setAppearance(next); setAppearanceDirty(true) }} previewTitle={editName} />
              </section>
                </TabsContent>
              </Tabs>

              {pendingAssignment && <p role="status" className="text-sm text-muted-foreground">{t('assignments.finish_edit')}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" disabled={busy} onClick={onClose}>{t('common.cancel')}</Button>
                <Button disabled={busy || pendingAssignment} onClick={() => void save()}>{t('common.save')}</Button>
              </div>
            </CardContent>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

function NotificationButtons({ event, refresh }: { event: HackathonEvent; refresh: () => Promise<void> }) {
  const { state } = useAppContext()
  const t = useT()
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [dm, setDm] = useState(false)
  const [teamChats, setTeamChats] = useState(false)
  const [channelId, setChannelId] = useState('')
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [sendError, setSendError] = useState('')
  const [guildChannels, setGuildChannels] = useState<{ id: string; name: string }[]>([])
  useEffect(() => { if (open) api.getGuildChannels().then(r=>setGuildChannels(r.channels ?? [])).catch(()=>undefined) }, [open])

  const announcementPresets = [
    ...(state.templates ?? []).filter(tp=>tp.kind==='announcement').map(tp=>{
      try { const p = JSON.parse(tp.json) as { title?: string; message?: string; trigger?: string; channelId?: string | null }; return { id: tp.id, title: p.title ?? tp.name, message: p.message ?? '', trigger: p.trigger ?? 'manual', channelId: p.channelId ?? null } } catch { return { id: tp.id, title: tp.name, message: '', trigger: 'manual', channelId: null } }
    }),
    ...(event.announcements ?? []).map(a=>({ id: a.id, title: a.title, message: a.message, trigger: a.trigger, channelId: a.channelId ?? null })),
  ]
  function applyPreset(id: string) {
    const tpl = announcementPresets.find(a=>a.id===id) ?? (event.announcements ?? []).find(a=>a.id===id)
    if (!tpl) {
      const g = (state.templates ?? []).find(tp=>tp.id===id)
      if (g) { try { const p = JSON.parse(g.json) as { title?: string; message?: string }; setTitle(p.title ?? ""); setMessage(p.message ?? "") } catch {} }
      return
    }
    setTitle(tpl.title)
    setMessage(tpl.message)
    if (tpl.channelId) setChannelId(tpl.channelId)
  }

  async function send() {
    const parsed = announceSchema.safeParse({ eventId: event.id, title: title.trim(), message: message.trim(), dm })
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? t('events.invalid_input'))
      return
    }
    setBusy(true)
    setSendError('')
    try {
      const targetChannel = channelId.trim() || undefined
      const res = await api.announce(event.id, title.trim(), message.trim(), dm, targetChannel, teamChats)
      if (res.posted) {
        toast.success(dm ? t('events.posted_with_dms', { count: res.dmSent }) : t('events.posted'))
      } else {
        const detail = [t(announcementFailureKey(res.reason)), ...(res.dmSent > 0 ? [t('events.announce_dms_sent_retry', { count: res.dmSent })] : []), ...(res.dmFailed > 0 ? [t('events.announce_dms_failed', { count: res.dmFailed })] : [])].join(' ')
        setSendError(detail)
        if (res.dmSent > 0) setDm(false)
        if (res.teamSent > 0) setTeamChats(false)
      }
      if (teamChats) toast.info(t('events.announce_teams_result', { sent: res.teamSent, failed: res.teamFailed }))
      if (res.posted && res.dmFailed > 0) toast.info(t('events.announce_dms_failed', { count: res.dmFailed }))
      if (res.posted) {
        setOpen(false)
        setTitle('')
        setMessage('')
        setChannelId('')
        setDm(false)
        setTeamChats(false)
      }
      await refresh()
    } catch (e) {
      setSendError(t('events.announce_request_unknown'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="secondary" size="sm" onClick={() => setSendError('')}>
            <Bell />
            {t('events.announce')}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto p-0 sm:max-w-md">
          <Card className="border-0 shadow-none">
            <CardHeader>
              <DialogTitle>{t('events.announce')}</DialogTitle>
              <DialogDescription>{t('events.announce_desc')}</DialogDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {sendError && <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-danger">{sendError}</p>}
              {announcementPresets.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium text-muted-foreground">{t('events.announce_quick_fill')}</span>
                  <Select onValueChange={applyPreset}>
                    <SelectTrigger aria-label={t('events.announce_quick_fill')}><SelectValue placeholder={t('events.announce_pick_preset')} /></SelectTrigger>
                    <SelectContent>
                      {announcementPresets.map(p=> <SelectItem key={p.id} value={p.id}>{p.trigger === 'schedule' ? `⏰ ${p.title}` : p.trigger === 'on_activate' ? `🚀 ${p.title}` : p.title} — {p.message.slice(0,40)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('events.channel_label')}</span>
                {guildChannels.length > 0 ? (
                  <Select value={channelId || '__none'} onValueChange={(v)=>setChannelId(v==='__none'?'':v)}>
                    <SelectTrigger aria-label={t('events.channel_label')}><SelectValue placeholder={t('events.announce_channel_override')} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">{t('events.announce_channel_default')}</SelectItem>
                      {guildChannels.map(c=> <SelectItem key={c.id} value={c.id}>#{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={channelId} onChange={(e) => setChannelId(e.target.value)} placeholder={t('events.announce_channel_id')} maxLength={30} />
                )}
              </label>
              <TagAutocompleteInput value={title} onChange={v=>setTitle(v)} placeholder={t('events.headline_placeholder')} maxLength={100} />
              <TagAutocompleteTextarea value={message} onChange={v=>setMessage(v)} placeholder={t('events.message_placeholder')} maxLength={2000} />
              <p className="text-xs text-muted-foreground">{t('tags.type_hint')}</p>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={dm} onCheckedChange={setDm} />
                {t('events.also_dm')}
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={teamChats} onCheckedChange={setTeamChats} />
                {t('events.also_team_chats')}
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
        </DialogContent>
      </Dialog>
    </>
  )
}

function EndEventButton({ event, refresh }: { event: HackathonEvent; refresh: () => Promise<void> }) {
  const t = useT()
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

function EventCard({ event, isSelected, onOpen, refresh }: { event: HackathonEvent; isSelected: boolean; onOpen: () => void; refresh: () => Promise<void> }) {
  const t = useT()

  async function activate() {
    try {
      await api.activateEvent(event.id)
      // Schedule now owns all Discord posts (signup, announcements, itinerary) — activate just flips to active.
      // Tell organizer how to make it actually post.
      toast.success(t('events.activated_schedule', { name: event.name }), { duration: 7000 })
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error && 'code' in e && e.code === 'invalid_questions' ? t('events.draft_form_incomplete') : e instanceof Error ? e.message : t('events.activate_failed'))
    }
  }

  const statusKey =
    event.status === 'active'
      ? 'events.status_active'
      : event.status === 'ended'
        ? 'events.status_ended'
        : 'events.status_draft'

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Card
          className={cn("card-interactive h-full cursor-pointer", isSelected && "border-accent/40", "group")}
          onClick={onOpen}
        >
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
          <CardContent className="flex flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {event.signupStartsAt !== null && event.signupEndsAt !== null && (
                <span className="flex items-center gap-1">
                  <ClipboardList className="size-3" />
                  {dateTime(event.signupStartsAt)} → {dateTime(event.signupEndsAt)}
                </span>
              )}
              {event.status === 'ended' && (
                <span className="flex items-center gap-1">
                  <Radio className="size-3" />
                  {event.cleanupDone ? t('events.cleanup_done') : t('events.cleanup_pending', { hours: event.cleanupDelayHours })}
                </span>
              )}
              {event.matchLocked && (
                <span className="flex items-center gap-1 text-ok">
                  <Lock className="size-3" />
                  {t('events.match_locked')}
                </span>
              )}
            </div>
            <div className="mt-auto flex items-center justify-between gap-2 pt-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 line-clamp-2 text-sm text-muted-foreground">{event.description}</span>
                <span className="hidden shrink-0 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 md:inline">
                  {t('events.hint_right_click')}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {event.status === 'draft' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={(e) => {
                      e.stopPropagation()
                      void activate()
                    }}
                  >
                    <Rocket />
                    {t('events.launch')}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={event.status === 'draft' ? 'outline' : 'secondary'}
                  onClick={(e) => {
                    e.stopPropagation()
                    onOpen()
                  }}
                >
                  <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
                  {t('events.open')}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={onOpen}>
          <ArrowRight />
          {t("events.menu_open")}
        </ContextMenuItem>
        {event.status === "draft" && (
          <ContextMenuItem onSelect={() => void activate()}>
            <Rocket />
            {t("events.launch")}
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => {
            void copyText(event.id).then(copied => copied ? toast.info(t("events.id_copied")) : toast.error(t("events.id_copy_failed")))
          }}
        >
          <Copy />
          {t("events.copy_id")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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
