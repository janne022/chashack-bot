"use client"
import { useEffect, useState } from "react"
import { Plus, Trash2, Copy, Utensils, Coffee, Vote, Trophy, Mic, Clock, Megaphone, ChevronDown, ChevronUp, Zap, HelpCircle, UsersRound, ClipboardList, Lock, Shuffle, CalendarRange, CalendarPlus } from "lucide-react"
import { format } from "date-fns"
import { enUS, sv } from "date-fns/locale"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/textarea-label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DateTimePicker } from "@/components/ui/datetime-picker"
import { DateRangePicker } from "@/components/ui/date-range-picker"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { TagAutocompleteInput, TagAutocompleteTextarea } from "@/components/TagAutocomplete"
import { useTagDefinitions } from "@/components/TagHelp"
import type { ScheduleItem, ScheduleAction, ScheduleAnchor } from "@/types"
import { STRATEGY_OPTIONS } from "@/lib/assignment-strategy"
import { ANCHOR_OPTIONS, TIME_MINUTES, anchorDate, offsetDay, offsetFromDayTime, offsetHourMinute } from "@/lib/schedule-anchor"
import { useLocale, useT } from "@/lib/i18n"
import { api } from "@/api"

const KINDS: { id: ScheduleItem["kind"]; labelKey: string; icon: typeof Clock }[] = [
  { id: "food", labelKey: "schedule.kind_food", icon: Utensils },
  { id: "break", labelKey: "schedule.kind_break", icon: Coffee },
  { id: "voting", labelKey: "schedule.kind_voting", icon: Vote },
  { id: "prize", labelKey: "schedule.kind_prize", icon: Trophy },
  { id: "talk", labelKey: "schedule.kind_talk", icon: Mic },
  { id: "custom", labelKey: "schedule.kind_custom", icon: Clock },
]
function toLocalIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// ---------------------------------------------------------------------------
// Shared schedule-action editing pieces. The pinned blocks (Start/End/Signup)
// and middle schedule blocks keep their own layouts but render the exact same
// action cards, add buttons and type options through the components below.
// ---------------------------------------------------------------------------

type ActionChannel = { id: string; name: string }
type AnnounceTemplate = { id: string; name: string; title: string; message: string; channelId?: string }

/** Fetch the Discord channels + announcement templates an action editor needs. */
function useActionResources(enabled: boolean) {
  const [channels, setChannels] = useState<ActionChannel[]>([])
  const [templates, setTemplates] = useState<AnnounceTemplate[]>([])
  useEffect(() => {
    if (!enabled) return
    api.getGuildChannels().then(r => setChannels(r.channels ?? [])).catch(() => undefined)
    api.listTemplates('announcement').then(r => {
      const list = (r.templates ?? []).map((tp) => {
        try {
          const p = JSON.parse((tp as unknown as { json: string }).json ?? '{}') as { title?: string; message?: string; channelId?: string | null }
          return { id: tp.id, name: tp.name, title: p.title ?? tp.name, message: p.message ?? '', ...(p.channelId ? { channelId: p.channelId } : {}) }
        } catch {
          return { id: tp.id, name: tp.name, title: tp.name, message: '' }
        }
      })
      setTemplates(list)
    }).catch(() => undefined)
  }, [enabled])
  return { channels, templates }
}

/**
 * `assign_random` is a legacy alias of `auto_match` (the bot treats both the
 * same). Old rows still carrying it render — and, on an explicit re-pick,
 * migrate — as `auto_match`; the type Select never offers it.
 */
function displayType(a: ScheduleAction): ScheduleAction["type"] {
  return a.type === "assign_random" ? "auto_match" : a.type
}

/** One editor card per action, shared by every block kind. */
function ActionCard({ action, channels, templates, announceTitlePlaceholder, announceMessagePlaceholder, onUpdate, onRemove }: {
  action: ScheduleAction
  channels: ActionChannel[]
  templates: AnnounceTemplate[]
  announceTitlePlaceholder: string
  announceMessagePlaceholder: string
  onUpdate: (id: string, patch: Partial<ScheduleAction>) => void
  onRemove: (id: string) => void
}) {
  const t = useT()
  const type = displayType(action)
  const isAnnounce = type === "announce"
  const isSignup = type === "post_signup"
  const isSchedule = type === "publish_schedule"
  const isDistribute = type === "distribute_assignments"
  const Icon = type === "announce" ? Megaphone : type === "post_signup" ? ClipboardList : isSchedule ? CalendarRange : type === "lock_teams" ? Lock : type === "auto_match" ? UsersRound : Shuffle
  const accent = type === "announce" ? "text-accent" : type === "post_signup" ? "text-blue-600" : type === "lock_teams" ? "text-amber-600" : "text-emerald-600"
  const label = type === "announce" ? t('events.schedule_action_announcement')
    : type === "post_signup" ? t('events.schedule_action_signup')
    : isSchedule ? t('events.schedule_action_publish')
    : type === "lock_teams" ? t('events.schedule_action_lock')
    : type === "auto_match" ? t('events.schedule_action_auto')
    : t('events.schedule_action_distribute')
  return (
    <Card className="border-border bg-background">
      <CardContent className="flex flex-col gap-2 p-2.5">
        <div className="flex items-center gap-2">
          <Icon className={`size-3.5 shrink-0 ${accent}`} />
          <span className="text-xs font-semibold">{label}</span>
          {isAnnounce && <span className="ml-auto hidden items-center gap-1 text-[11px] text-muted-foreground sm:flex"><HelpTag /> {t('tags.type_hint')}</span>}
          {!isDistribute && (
            <Select value={type} onValueChange={v => onUpdate(action.id, { type: v as ScheduleAction["type"], ...(v !== "announce" && v !== "post_signup" && v !== "publish_schedule" ? { title: undefined, message: undefined, channelId: undefined } as never : {}) })}>
              <SelectTrigger className="ml-auto h-6 w-32 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="announce">{t('events.schedule_action_announcement')}</SelectItem>
                {isSignup && <SelectItem value="post_signup">{t('events.schedule_action_signup')}</SelectItem>}
                <SelectItem value="publish_schedule">{t('events.schedule_action_publish')}</SelectItem>
                <SelectItem value="lock_teams">{t('events.schedule_action_lock')}</SelectItem>
                <SelectItem value="auto_match">{t('events.schedule_action_auto')}</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button variant="ghost" size="icon" className="size-6" aria-label={t('schedule.remove_action', { action: label })} onClick={() => onRemove(action.id)}><Trash2 className="size-3" /></Button>
        </div>
        {isAnnounce ? (
          <>
            {templates.length > 0 && (
              <div className="flex items-center gap-2 rounded-md bg-surface-2 px-2 py-1.5">
                <span className="shrink-0 text-[11px] text-muted-foreground">{t('events.from_template')}</span>
                <Select onValueChange={v => { const tpl = templates.find(x => x.id === v); if (tpl) onUpdate(action.id, { title: tpl.title, message: tpl.message, ...(tpl.channelId ? { channelId: tpl.channelId } : {}) }) }}>
                  <SelectTrigger className="h-7 min-w-0 flex-1 text-xs [&>span]:truncate"><SelectValue placeholder={t('events.pick_announcement_template')} /></SelectTrigger>
                  <SelectContent position="popper" align="start" className="max-h-72 w-[22rem] max-w-[90vw]">
                    {templates.map(tp => (
                      <SelectItem key={tp.id} value={tp.id}>
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-xs font-medium">{tp.name}</span>
                          <span className="truncate text-[11px] text-muted-foreground">{tp.title}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label className="text-[11px]">{t('events.title_label')}</Label>
                <TagAutocompleteInput value={action.title ?? ""} onChange={v => onUpdate(action.id, { title: v })} placeholder={announceTitlePlaceholder} maxLength={100} />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[11px]">{t('events.channel_label')}</Label>
                {channels.length > 0 ? (
                  <Select value={action.channelId ?? "__none"} onValueChange={v => onUpdate(action.id, { channelId: v === "__none" ? null : v })}>
                    <SelectTrigger className="h-7 text-xs"><SelectValue placeholder={t('events.channel_default_announcement')} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">{t('events.channel_default_announcement')}</SelectItem>
                      {channels.map(c => <SelectItem key={c.id} value={c.id}>#{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input value={action.channelId ?? ""} onChange={e => onUpdate(action.id, { channelId: e.target.value.trim() || null })} placeholder={t('events.channel_default_announcement')} aria-label={t('events.channel_label')} className="h-7 text-xs font-mono" />
                )}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-[11px]">{t('events.message_label')}</Label>
              <TagAutocompleteTextarea value={action.message ?? ""} onChange={v => onUpdate(action.id, { message: v })} placeholder={announceMessagePlaceholder} maxLength={2000} />
            </div>
          </>
        ) : isSignup || isSchedule ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">{t(isSchedule ? 'events.schedule_publish_desc' : 'events.schedule_signup_desc')}</p>
            <div className="flex flex-col gap-1">
              <Label className="text-[11px]">{t(isSchedule ? 'events.schedule_channel_action' : 'events.panel_channel_label')}</Label>
              {channels.length > 0 ? (
                <Select value={action.channelId ?? "__none"} onValueChange={v => onUpdate(action.id, { channelId: v === "__none" ? null : v })}>
                  <SelectTrigger className="h-7 text-xs"><SelectValue placeholder={t(isSchedule ? 'events.schedule_channel_action' : 'events.panel_channel_label')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">{t(isSchedule ? 'events.channel_default_schedule' : 'events.channel_default_panel')}</SelectItem>
                    {channels.map(c => <SelectItem key={c.id} value={c.id}>#{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={action.channelId ?? ""} onChange={e => onUpdate(action.id, { channelId: e.target.value.trim() || null })} placeholder={t(isSchedule ? 'events.schedule_channel_action' : 'events.panel_channel_label')} className="h-7 text-xs font-mono" />
              )}
            </div>
          </div>
        ) : isDistribute ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">{t('events.schedule_distribute_desc')}</p>
            <Select value={action.mode ?? 'random'} onValueChange={v => onUpdate(action.id, { mode: v as 'random' | 'same' })}>
              <SelectTrigger className="h-7 w-40 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STRATEGY_OPTIONS.map(opt => <SelectItem key={opt.id} value={opt.id}>{t(opt.labelKey)}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">{type === "lock_teams" ? t('events.schedule_lock_desc') : t('events.schedule_auto_desc')}</p>
        )}
      </CardContent>
    </Card>
  )
}

/** The list of action cards for one block. */
function ActionList({ actions, channels, templates, announceTitlePlaceholder, announceMessagePlaceholder, onUpdate, onRemove }: {
  actions: ScheduleAction[]
  channels: ActionChannel[]
  templates: AnnounceTemplate[]
  announceTitlePlaceholder: string
  announceMessagePlaceholder: string
  onUpdate: (id: string, patch: Partial<ScheduleAction>) => void
  onRemove: (id: string) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      {actions.map(a => (
        <ActionCard
          key={a.id}
          action={a}
          channels={channels}
          templates={templates}
          announceTitlePlaceholder={announceTitlePlaceholder}
          announceMessagePlaceholder={announceMessagePlaceholder}
          onUpdate={onUpdate}
          onRemove={onRemove}
        />
      ))}
    </div>
  )
}

/** Add-buttons shared by both editors. Assignment distribution is a first-class schedule action backed by the event’s assignment pool. */
function AddActionButtons({ onAdd }: { onAdd: (type: ScheduleAction["type"]) => void }) {
  const t = useT()
  return (
    <div className="flex flex-wrap gap-1">
      <Button variant="secondary" size="sm" className="h-6 text-xs" onClick={() => onAdd("announce")}><Megaphone className="size-3" /> {t('events.schedule_action_announcement')}</Button>
      <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => onAdd("publish_schedule")}><CalendarRange className="size-3" /> {t('events.schedule_action_publish')}</Button>
      <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => onAdd("distribute_assignments")}><Shuffle className="size-3" /> {t("events.schedule_action_assignments")}</Button>
      <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => onAdd("lock_teams")}><Lock className="size-3" /> {t('events.schedule_action_lock')}</Button>
      <Button variant="outline" size="sm" className="h-6 text-xs" onClick={() => onAdd("auto_match")}><UsersRound className="size-3" /> {t('events.schedule_action_auto')}</Button>
    </div>
  )
}

/** "Day 2, 18:00" for an anchor offset. */
function offsetLabel(offsetMinutes: number, t: ReturnType<typeof useT>): string {
  const { hour, minute } = offsetHourMinute(offsetMinutes)
  return t('schedule.day_time', { day: offsetDay(offsetMinutes), time: `${hour}:${minute}` })
}

function ElapsedOffsetInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const t = useT()
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])
  return <Input type="text" inputMode="numeric" value={draft} onChange={e => {
    const next = e.target.value
    if (!/^-?\d*$/.test(next)) return
    setDraft(next)
    if (next !== '' && next !== '-' && Number.isSafeInteger(Number(next))) onChange(Number(next))
  }} onBlur={() => setDraft(String(value))} className="h-8 w-28 text-xs" aria-label={t('events.schedule_elapsed_minutes')} />
}

/** Relative (anchor-based) placement of one block — the template editor's time control. */
function RelativeTimeEditor({ item, onChange }: { item: ScheduleItem; onChange: (patch: Partial<ScheduleItem>) => void }) {
  const t = useT()
  const anchor: ScheduleAnchor = item.anchor ?? 'hackathon_start'
  const offset = item.offsetMinutes ?? 0
  const day = offsetDay(offset)
  const { hour, minute } = offsetHourMinute(offset)

  function set(dayN: number, hourS: string, minuteS: string) {
    onChange({ anchor, offsetMinutes: offsetFromDayTime(dayN, Number(hourS), Number(minuteS)) })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Select value={item.offsetMode === 'elapsed' ? 'elapsed' : 'clock'} onValueChange={mode => onChange({ offsetMode: mode === 'elapsed' ? 'elapsed' : undefined, withinEvent: undefined, offsetMinutes: 0 })}>
        <SelectTrigger aria-label={t('events.schedule_offset_mode')} className="h-8 w-56 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="clock">{t('events.schedule_offset_clock')}</SelectItem><SelectItem value="elapsed">{t('events.schedule_offset_elapsed')}</SelectItem></SelectContent>
      </Select>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">{t('events.schedule_anchor_label')}</span>
        <Select value={anchor} onValueChange={(v) => onChange({ anchor: v as ScheduleAnchor })}>
          <SelectTrigger className="h-8 w-44 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ANCHOR_OPTIONS.map(opt => <SelectItem key={opt.id} value={opt.id}>{t(opt.labelKey)}</SelectItem>)}
          </SelectContent>
        </Select>
        {item.offsetMode === 'elapsed' ? <ElapsedOffsetInput value={offset} onChange={offsetMinutes => onChange({ offsetMinutes })} /> : <>
        <Input
          type="number"
          value={String(day)}
          onChange={(e) => set(Number(e.target.value) || 0, hour, minute)}
          className="h-8 w-20 text-xs"
          aria-label={t('events.schedule_day_label')}
        />
        <Select value={hour} onValueChange={(v) => set(day, v, minute)}>
          <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{Array.from({ length: 24 }, (_, i) => { const h = String(i).padStart(2, "0"); return <SelectItem key={h} value={h}>{h}</SelectItem> })}</SelectContent>
        </Select>
        <span className="text-muted-foreground">:</span>
        <Select value={TIME_MINUTES.includes(minute) ? minute : '00'} onValueChange={(v) => set(day, hour, v)}>
          <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>{TIME_MINUTES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
        </Select></>}
      </div>
      {item.offsetMode === 'elapsed' && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={item.withinEvent === true} onChange={e => onChange({ withinEvent: e.target.checked })} />{t('events.schedule_within_event')}</label>}
      <span className="text-xs text-muted-foreground">{t(item.offsetMode === 'elapsed' ? 'events.schedule_elapsed_hint' : 'events.schedule_offset_hint')}</span>
    </div>
  )
}

export function ScheduleEditor({
  value,
  onChange,
  startValue,
  endValue,
  onStartChange,
  onEndChange,
  signupStartValue,
  signupEndValue,
  onSignupStartChange,
  onSignupEndChange,
  startActions,
  endActions,
  signupActions,
  onStartActionsChange,
  onEndActionsChange,
  onSignupActionsChange,
  disablePast,
  timeMode = 'absolute',
}: {
  value: ScheduleItem[]
  onChange: (next: ScheduleItem[]) => void
  startValue?: string
  endValue?: string
  onStartChange?: (v: string) => void
  onEndChange?: (v: string) => void
  signupStartValue?: string
  signupEndValue?: string
  onSignupStartChange?: (v: string) => void
  onSignupEndChange?: (v: string) => void
  startActions?: ScheduleAction[]
  endActions?: ScheduleAction[]
  signupActions?: ScheduleAction[]
  onStartActionsChange?: (a: ScheduleAction[]) => void
  onEndActionsChange?: (a: ScheduleAction[]) => void
  onSignupActionsChange?: (a: ScheduleAction[]) => void
  disablePast?: boolean
  /** `relative` = template editing: anchors instead of dates, no date blocks. */
  timeMode?: 'absolute' | 'relative'
}) {
  const t = useT()
  const dateLocale = useLocale() === 'sv' ? sv : enUS
  const relative = timeMode === 'relative'
  const sorted = [...value].sort((a, b) => a.time - b.time)
  const hasRange = !relative && onStartChange !== undefined && onEndChange !== undefined && startValue !== undefined && endValue !== undefined
  const hasSignup = !relative && onSignupStartChange !== undefined && onSignupEndChange !== undefined && signupStartValue !== undefined && signupEndValue !== undefined
  const [expanded, setExpanded] = useState<Set<string>>(()=>new Set())
  const toggle = (id: string) => setExpanded(prev=>{
    const n = new Set(prev)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  const add = (preset?: Partial<ScheduleItem>) => {
    const base = (()=>{ if (startValue) { const d = new Date(startValue); if (!isNaN(d.getTime())) { d.setMinutes(0,0,0); return d } } const b = new Date(); b.setMinutes(0,0,0); return b })()
    const time = preset?.time ?? (relative ? 0 : base.getTime())
    const title = preset?.title ?? ""
    const kind = preset?.kind ?? "custom"
    const id = `sch_${Math.random().toString(36).slice(2, 8)}`
    const placement = relative ? { anchor: 'hackathon_start' as ScheduleAnchor, offsetMinutes: 0 } : {}
    onChange([...value, { ...placement, ...preset, id, time, title, kind, actions: [] }])
    setExpanded(prev=>new Set(prev).add(id))
  }

  const update = (id: string, patch: Partial<ScheduleItem>) => {
    onChange(value.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  const remove = (id: string) => onChange(value.filter((s) => s.id !== id))

  /** Copy a block in place — a real copy with fresh ids, opened for editing. */
  const duplicate = (id: string) => {
    const src = value.find((s) => s.id === id)
    if (!src) return
    const copy: ScheduleItem = {
      ...src,
      id: `sch_${Math.random().toString(36).slice(2, 8)}`,
      actions: (src.actions ?? []).map((a) => ({ ...a, id: `sact_${Math.random().toString(36).slice(2, 6)}` })),
    }
    onChange([...value, copy])
    setExpanded((prev) => new Set(prev).add(copy.id))
  }

  const quickAdds = [
    { title: t('schedule.quick_dinner'), kind: "food" as const, hour: 18 },
    { title: t('schedule.quick_break'), kind: "break" as const, hour: 12 },
    { title: t('schedule.quick_voting'), kind: "voting" as const, hour: 14 },
    { title: t('schedule.quick_prize'), kind: "prize" as const, hour: 16 },
  ]

  /** Quick-adds land on the hackathon start day at a fixed hour. */
  function addQuick(q: (typeof quickAdds)[number]) {
    if (relative) {
      add({ title: q.title, kind: q.kind, anchor: 'hackathon_start', offsetMinutes: q.hour * 60 })
      return
    }
    const base = (()=>{ if (startValue) { const d = new Date(startValue); if (!isNaN(d.getTime())) return d; } return new Date() })()
    const d = new Date(base)
    d.setHours(q.hour, 0, 0, 0)
    add({ title: q.title, kind: q.kind, time: d.getTime() })
  }

  const quickLabel = (q: (typeof quickAdds)[number]) => `${relative ? t('schedule.day_time', { day: 1, time: `${q.hour}:00` }) : `${q.hour}:00`} · ${q.title}`

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{t("events.schedule") as string ?? "Schedule"}</span>
        <Badge variant="secondary" className="text-[10px]">{sorted.length}</Badge>
        <span className="hidden text-xs text-muted-foreground sm:inline">{t('events.schedule_hint')}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" onClick={() => add()}>
            <Plus /> {t("events.add_schedule" as never) ?? "Add item"}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-label={t('events.quick_add')}>
                <ChevronDown /> {t('events.quick_add')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {quickAdds.map((q) => {
                const QIcon = KINDS.find((k) => k.id === q.kind)?.icon ?? Clock
                return (
                  <DropdownMenuItem key={q.title} onClick={() => addQuick(q)}>
                    <QIcon /> {quickLabel(q)}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {relative && <p className="text-xs text-muted-foreground">{t('events.schedule_relative_hint')}</p>}

      {hasSignup && (
        <PinnedBlock
          label={t('events.signup_window')}
          hint={t('events.signup_hint')}
          value={signupStartValue}
          displayValue={
            signupStartValue && signupEndValue
              ? `${(() => { try { return format(new Date(signupStartValue), "MMM d, HH:mm", { locale: dateLocale }) } catch { return "" } })()} → ${(() => { try { return format(new Date(signupEndValue), "MMM d, HH:mm", { locale: dateLocale }) } catch { return "" } })()}`
              : t('events.signup_before_hackathon')
          }
          actions={signupActions ?? []}
          onActionsChange={onSignupActionsChange}
          signupBlock
          includePanelTag
          iconBg="bg-primary"
          border="border-primary/30"
          bg="bg-primary/5"
          expanded={expanded.has("__signup__")}
          onToggle={()=>toggle("__signup__")}
          emptyHint={t('events.schedule_signup_hack_hint')}
          renderTime={() => (
            <div className="flex flex-col gap-1.5">
              <DateRangePicker
                from={signupStartValue ?? ''}
                to={signupEndValue ?? ''}
                onChange={(next) => { onSignupStartChange!(next.from); onSignupEndChange!(next.to) }}
                disablePast={disablePast}
                className="max-w-md"
              />
              <span className="text-xs text-muted-foreground">{t('events.signup_after_hint')}</span>
            </div>
          )}
        />
      )}

      {hasRange && (
        <PinnedBlock
          label={t('events.hackathon_starts')}
          hint={t("events.schedule_start_hint" as never) ?? "first block"}
          value={startValue!}
          onChange={onStartChange!}
          actions={startActions ?? []}
          onActionsChange={onStartActionsChange}
          includePanelTag
          disablePast={disablePast}
          iconBg="bg-accent"
          border="border-accent/40"
          bg="bg-accent-soft"
          expanded={expanded.has("__start__")}
          onToggle={()=>toggle("__start__")}
          emptyHint={t('events.schedule_start_hack_hint')}
        />
      )}

      {sorted.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border bg-background px-4 py-6 text-center">
          <CalendarPlus className="size-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">{t('events.schedule_empty_title')}</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
              {relative ? t('events.schedule_relative_empty') : t('events.schedule_empty_desc')}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">
            {quickAdds.map((q) => (
              <Button key={q.title} variant="outline" size="sm" onClick={() => addQuick(q)}>
                <Plus className="size-3" /> {q.title}
              </Button>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((item) => {
            const isExp = expanded.has(item.id)
            const KindIcon = KINDS.find((k) => k.id === item.kind)?.icon ?? Clock
            const dt = new Date(item.time)
            const anchored = item.anchor !== undefined && item.offsetMinutes !== undefined
            const dateValue = (value?: string) => { const parsed = value ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : null }
            const awaitingAnchor = !relative && anchored && item.time === 0 && anchorDate(item.anchor!, { startsAt: dateValue(startValue), endsAt: dateValue(endValue), signupStartsAt: dateValue(signupStartValue), signupEndsAt: dateValue(signupEndValue) }) === null
            const isSynthetic = item.id.startsWith('__')
            const timeBadge = format(dt, "MMM d, HH:mm", { locale: dateLocale })
            const dayBadge = format(dt, "EEE", { locale: dateLocale })
            return (
              <ContextMenu key={item.id}>
                <ContextMenuTrigger asChild>
                  <Card className="overflow-hidden border-border bg-background">
                  <button
                    type="button"
                    onClick={()=>toggle(item.id)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/40"
                  >
                    <KindIcon className="size-4 shrink-0 text-accent" />
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                      <Clock className="size-3" />
                      {relative ? (
                        <span className="hidden sm:inline">{item.offsetMode === 'elapsed' ? t('events.schedule_elapsed_badge', { minutes: item.offsetMinutes ?? 0 }) : offsetLabel(item.offsetMinutes ?? 0, t)}</span>
                      ) : (
                        <span className="hidden sm:inline">{awaitingAnchor ? t('events.schedule_awaiting_date') : timeBadge}</span>
                      )}
                      {!relative && !anchored && !isSynthetic && <span className="rounded bg-accent px-1 py-0 text-[10px] font-bold text-accent-foreground">{dayBadge}</span>}
                    </span>
                    {anchored && (
                      <Badge variant="outline" className="hidden shrink-0 gap-1 text-[10px] sm:inline-flex">
                        <CalendarRange className="size-3" />{t(ANCHOR_OPTIONS.find(o => o.id === item.anchor)?.labelKey ?? 'anchor.hackathon_start')}
                      </Badge>
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title || <span className="text-muted-foreground italic">{t('schedule.untitled')}</span>}</span>
                    {item.actions && item.actions.length > 0 && (
                      <Badge variant="secondary" className="shrink-0 gap-1 text-[10px]"><Zap className="size-3" />{item.actions.length}</Badge>
                    )}
                    <Badge variant="secondary" className="hidden shrink-0 text-[10px] sm:inline-flex">{t(KINDS.find(k => k.id === (item.kind ?? 'custom'))?.labelKey ?? 'schedule.kind_custom')}</Badge>
                    {isExp ? <ChevronUp className="size-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="size-4 shrink-0 text-muted-foreground" />}
                  </button>
                  {isExp && (
                    <div className="flex flex-col gap-3 border-t border-border p-3">
                      {relative ? (
                        <RelativeTimeEditor item={item} onChange={(patch) => update(item.id, patch)} />
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-[auto_1fr_auto]">
                          <DateTimePicker
                            value={awaitingAnchor ? '' : toLocalIso(dt)}
                            onChange={(v) => update(item.id, { time: v ? Date.parse(v) : item.time, anchor: undefined, offsetMinutes: undefined, offsetMode: undefined, withinEvent: undefined })}
                            disablePast={disablePast}
                            minDate={disablePast && startValue ? (() => { const d = new Date(startValue); d.setHours(0,0,0,0); return d })() : undefined}
                            className="h-8 w-44"
                          />
                          <Input
                            value={item.title}
                            onChange={(e) => update(item.id, { title: e.target.value })}
                            placeholder={t('schedule.title_placeholder')}
                            aria-label={t('events.title_label')}
                            className="h-8 text-sm"
                            maxLength={80}
                          />
                          <Select value={item.kind ?? "custom"} onValueChange={(v) => update(item.id, { kind: v as ScheduleItem["kind"] })}>
                            <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {KINDS.map((k) => (
                                <SelectItem key={k.id} value={k.id!}>{t(k.labelKey)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      {relative && (
                        <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                          <Input
                            value={item.title}
                            onChange={(e) => update(item.id, { title: e.target.value })}
                            placeholder={t('schedule.title_placeholder')}
                            aria-label={t('events.title_label')}
                            className="h-8 text-sm"
                            maxLength={80}
                          />
                          <Select value={item.kind ?? "custom"} onValueChange={(v) => update(item.id, { kind: v as ScheduleItem["kind"] })}>
                            <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {KINDS.map((k) => (
                                <SelectItem key={k.id} value={k.id!}>{t(k.labelKey)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <label className="space-y-2 text-sm">
                        <span>{t("schedule.description_label")}</span>
                      <Input
                        value={item.description ?? ""}
                        onChange={(e) => update(item.id, { description: e.target.value || undefined })}
                        placeholder={t("schedule.description_label")}
                        className="h-8 text-xs"
                        maxLength={200}
                      />
                        <span className="block text-xs text-muted-foreground">{t("schedule.description_help")}</span>
                      </label>
                      <ScheduleItemActions item={item} onChange={(actions)=>update(item.id, { actions })} />

                      <div className="flex justify-end">
                        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => remove(item.id)}>
                          <Trash2 className="size-3.5" /> {t('events.remove_block')}
                        </Button>
                      </div>
                    </div>
                  )}
                  </Card>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-52">
                  <ContextMenuItem onSelect={() => toggle(item.id)}>
                    {isExp ? <ChevronUp /> : <ChevronDown />}
                    {isExp ? t("events.collapse_block") : t("events.expand_block")}
                  </ContextMenuItem>
                  {!isSynthetic && (
                    <>
                      <ContextMenuItem onSelect={() => duplicate(item.id)}>
                        <Copy />
                        {t("events.duplicate_block")}
                      </ContextMenuItem>
                      <ContextMenuSeparator />
                      <ContextMenuItem variant="destructive" onSelect={() => remove(item.id)}>
                        <Trash2 />
                        {t("events.remove_block")}
                      </ContextMenuItem>
                    </>
                  )}
                </ContextMenuContent>
              </ContextMenu>
            )
          })}
        </div>
      )}

      {hasRange && (
        <PinnedBlock
          label={t('events.hackathon_ends')}
          hint={t("events.schedule_end_hint" as never) ?? "last block"}
          value={endValue!}
          onChange={onEndChange!}
          actions={endActions ?? []}
          onActionsChange={onEndActionsChange}
          disablePast={disablePast}
          minDate={disablePast && startValue ? new Date(startValue) : undefined}
          iconBg="bg-danger"
          border="border-danger/30"
          bg="bg-danger/5"
          expanded={expanded.has("__end__")}
          onToggle={()=>toggle("__end__")}
          emptyHint={t('events.schedule_end_hack_hint')}
        />
      )}
    </div>
  )
}

function PinnedBlock({
  label, hint, value, displayValue, onChange, renderTime, actions, onActionsChange, includePanelTag, signupBlock, disablePast, minDate, iconBg, border, bg, expanded, onToggle, emptyHint,
}: {
  label: string
  hint: string
  /** Single-time blocks pass their local iso value; window blocks leave it undefined. */
  value?: string
  displayValue?: string | undefined
  onChange?: (v: string)=>void
  /** Replaces the single DateTimePicker (e.g. a range picker). */
  renderTime?: () => React.ReactNode
  actions: ScheduleAction[]
  onActionsChange?: (a: ScheduleAction[])=>void
  /** Announce defaults mention {panel} when the block is about opening/posting signups. */
  includePanelTag?: boolean
  signupBlock?: boolean
  disablePast?: boolean
  minDate?: Date
  iconBg: string
  border: string
  bg: string
  expanded: boolean
  onToggle: ()=>void
  emptyHint: string
}) {
  const t = useT()
  const dateLocale = useLocale() === 'sv' ? sv : enUS
  const hasActions = actions.length > 0
  const headerValue = displayValue ?? (value ? (() => { try { return format(new Date(value), "MMM d, HH:mm EEE", { locale: dateLocale }) } catch { return hint } })() : hint)
  return (
    <div className={`rounded-lg border ${border} ${bg}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <span className={`flex size-7 items-center justify-center rounded-md ${iconBg} text-white`}>
          <Clock className="size-3.5" />
        </span>
        <span className="text-sm font-semibold">{label}</span>
        <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">{headerValue}</span>
        {hasActions && <Badge variant="secondary" className="ml-2 gap-1 text-[10px]"><Zap className="size-3" />{actions.length}</Badge>}
        <span className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">{expanded ? t('schedule.hide') : hasActions ? t(actions.length === 1 ? 'schedule.action_one' : 'schedule.action_count', { count: actions.length }) : t('schedule.add_actions')}</span>
          {expanded ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
        </span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-3 border-t border-border bg-background px-3 py-3">
          {renderTime ? (
            renderTime()
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs font-medium text-muted-foreground">{t('schedule.time')}</span>
              <DateTimePicker value={value ?? ''} onChange={(v) => onChange?.(v)} disablePast={disablePast} minDate={minDate} className="h-8 w-48" />
            </div>
          )}
          {onActionsChange ? (
            <InlineActions
              timeLabel={label}
              timeValue={value ?? ''}
              actions={actions}
              onChange={onActionsChange}
              emptyHint={emptyHint}
              includePanelTag={includePanelTag}
              signupBlock={signupBlock}
            />
          ) : (
            <p className="text-xs text-muted-foreground">{emptyHint}</p>
          )}
        </div>
      )}
    </div>
  )
}

/** Action editor for the pinned blocks — add buttons always visible in the header. */
function InlineActions({ timeLabel, timeValue, actions, onChange, emptyHint, includePanelTag, signupBlock }: { timeLabel: string; timeValue: string; actions: ScheduleAction[]; onChange: (a: ScheduleAction[])=>void; emptyHint: string; includePanelTag?: boolean; signupBlock?: boolean }) {
  const t = useT()
  const hasActions = actions.length > 0
  const { channels, templates } = useActionResources(true)

  function addAction(type: ScheduleAction["type"] = "announce") {
    const id = `sact_${Math.random().toString(36).slice(2, 6)}`
    if (type === "announce") {
      const dt = (()=>{ try { return format(new Date(timeValue), "HH:mm") } catch { return "" }})()
      onChange([...actions, { id, type: "announce", title: `${timeLabel} — ${dt}`, message: `🚀 **{event}** ${timeLabel} ${includePanelTag ? "{everyone} {panel}" : "{everyone}"}`, channelId: null }])
    } else if (type === "post_signup") {
      onChange([...actions, { id, type: "post_signup", channelId: null }])
    } else {
      onChange([...actions, { id, type }])
    }
  }
  const updateAction = (id: string, patch: Partial<ScheduleAction>) => onChange(actions.map(a=>a.id===id ? { ...a, ...patch } : a))
  const removeAction = (id: string) => onChange(actions.filter(a=>a.id!==id))

  return (
    <div className="rounded-lg border border-dashed border-border bg-surface-2/20">
      {signupBlock && <SignupPanelOption actions={actions} onChange={onChange} />}
      <div className="flex items-center justify-between gap-2 px-2.5 py-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Zap className="size-3 text-accent" /> {hasActions ? t(actions.length === 1 ? 'schedule.action_one' : 'schedule.action_count', { count: actions.length }) : emptyHint}</span>
        <AddActionButtons onAdd={addAction} />
      </div>
      {hasActions && (
        <div className="border-t border-border p-2">
          <ActionList
            actions={actions}
            channels={channels}
            templates={templates}
            announceTitlePlaceholder={t('events.headline_placeholder')}
            announceMessagePlaceholder={t('events.message_placeholder')}
            onUpdate={updateAction}
            onRemove={removeAction}
          />
        </div>
      )}
    </div>
  )
}

/** Collapsible action editor for middle schedule blocks. */
function ScheduleItemActions({ item, onChange }: { item: ScheduleItem; onChange: (actions: ScheduleAction[])=>void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const actions = item.actions ?? []
  const hasActions = actions.length > 0
  const { channels, templates } = useActionResources(open)

  function addAction(type: ScheduleAction["type"] = "announce") {
    const id = `sact_${Math.random().toString(36).slice(2, 6)}`
    if (type === "announce") {
      onChange([...actions, { id, type: "announce", title: item.title, message: "⏰ **{schedule_title}** — {schedule_desc} {everyone}", channelId: null }])
    } else if (type === "post_signup") {
      onChange([...actions, { id, type: "post_signup", channelId: null }])
    } else {
      onChange([...actions, { id, type }])
    }
    setOpen(true)
  }
  const updateAction = (id: string, patch: Partial<ScheduleAction>) => onChange(actions.map(a=>a.id===id ? { ...a, ...patch } : a))
  const removeAction = (id: string) => onChange(actions.filter(a=>a.id!==id))

  return (
    <div className="rounded-lg border border-dashed border-border bg-surface-2/20">
      <button
        type="button"
        onClick={()=>setOpen(v=>!v)}
        className="flex w-full items-center justify-between px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <span className="flex items-center gap-1.5"><Zap className="size-3 text-accent" /> {hasActions ? t(actions.length === 1 ? 'schedule.action_one' : 'schedule.action_count', { count: actions.length }) : t('events.schedule_actions_add_hint')}</span>
        {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        {!hasActions && <Badge variant="secondary" className="ml-auto mr-2 text-[10px]">{t('schedule.optional')}</Badge>}
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-border p-2">
          {(item.id === '__signup__' || item.id === 'sch_signup') && <SignupPanelOption actions={actions} onChange={onChange} />}
          {actions.length === 0 && <p className="px-1 text-xs text-muted-foreground">{t('events.schedule_actions_empty')}</p>}
          <ActionList
            actions={actions}
            channels={channels}
            templates={templates}
            announceTitlePlaceholder="{schedule_title}"
            announceMessagePlaceholder="⏰ {schedule_title} — {schedule_desc} {everyone}"
            onUpdate={updateAction}
            onRemove={removeAction}
          />
          <AddActionButtons onAdd={addAction} />
        </div>
      )}
    </div>
  )
}

function SignupPanelOption({ actions, onChange }: { actions: ScheduleAction[]; onChange: (actions: ScheduleAction[]) => void }) {
  const t = useT()
  const enabled = actions.some(action => action.type === 'post_signup')
  return <label className="flex min-h-10 items-center gap-2 px-3 text-sm">
    <input type="checkbox" checked={enabled} onChange={event => onChange(event.target.checked
      ? [...actions, { id: `sact_${Math.random().toString(36).slice(2, 8)}`, type: 'post_signup', channelId: null }]
      : actions.filter(action => action.type !== 'post_signup'))} />
    {t('events.signup_post_panel')}
  </label>
}

function HelpTag() {
  const t = useT()
  const definitions = useTagDefinitions()
  const shown = new Set(['{event}', '{panel}', '{everyone}', '{schedule_title}', '{timer_schedule}', '{start_date}', '{end_date}', '{schedule}'])
  return (
    <Popover>
      <PopoverTrigger asChild><button type="button" aria-label={t('tags.help_title')} className="inline-flex size-4 items-center justify-center rounded-full bg-muted text-muted-foreground"><HelpCircle className="size-3" /></button></PopoverTrigger>
      <PopoverContent className="w-64 text-xs leading-relaxed" align="end">
        <div className="font-semibold mb-1">{t('tags.title')}</div>
        <div className="grid gap-1 font-mono text-[11px]">
          {definitions.filter(def => shown.has(def.tag)).map(def => <span key={def.tag}>{def.tag} — {def.label}</span>)}
        </div>
      </PopoverContent>
    </Popover>
  )
}
