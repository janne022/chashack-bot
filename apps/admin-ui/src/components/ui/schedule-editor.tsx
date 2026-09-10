"use client"
import { useState } from "react"
import { Plus, Trash2, Utensils, Coffee, Vote, Trophy, Mic, Clock, Megaphone, ChevronDown, ChevronUp, Zap, HelpCircle } from "lucide-react"
import { format } from "date-fns"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea-label"
import { Label } from "@/components/ui/textarea-label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DateTimePicker } from "@/components/ui/datetime-picker"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { TagPill } from "@/components/TagHelp"
import type { ScheduleItem, ScheduleAction } from "@/types"
import { useT } from "@/lib/i18n"

const KINDS: { id: ScheduleItem["kind"]; label: string; icon: typeof Clock }[] = [
  { id: "food", label: "Food", icon: Utensils },
  { id: "break", label: "Fika / Break", icon: Coffee },
  { id: "voting", label: "Voting", icon: Vote },
  { id: "prize", label: "Prize", icon: Trophy },
  { id: "talk", label: "Talk", icon: Mic },
  { id: "custom", label: "Custom", icon: Clock },
]
function toLocalIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function ScheduleEditor({
  value,
  onChange,
  startValue,
  endValue,
  onStartChange,
  onEndChange,
  startActions,
  endActions,
  onStartActionsChange,
  onEndActionsChange,
  disablePast,
}: {
  value: ScheduleItem[]
  onChange: (next: ScheduleItem[]) => void
  startValue?: string
  endValue?: string
  onStartChange?: (v: string) => void
  onEndChange?: (v: string) => void
  startActions?: ScheduleAction[]
  endActions?: ScheduleAction[]
  onStartActionsChange?: (a: ScheduleAction[]) => void
  onEndActionsChange?: (a: ScheduleAction[]) => void
  disablePast?: boolean
}) {
  const t = useT()
  const sorted = [...value].sort((a, b) => a.time - b.time)
  const hasRange = onStartChange !== undefined && onEndChange !== undefined && startValue !== undefined && endValue !== undefined
  const [expanded, setExpanded] = useState<Set<string>>(()=>new Set())
  const toggle = (id: string) => setExpanded(prev=>{
    const n = new Set(prev)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  const add = (preset?: Partial<ScheduleItem>) => {
    const base = new Date()
    base.setMinutes(0, 0, 0)
    const time = preset?.time ?? base.getTime()
    const title = preset?.title ?? ""
    const kind = preset?.kind ?? "custom"
    const id = `sch_${Math.random().toString(36).slice(2, 8)}`
    onChange([...value, { id, time, title, kind, actions: [] }])
    setExpanded(prev=>new Set(prev).add(id))
  }

  const update = (id: string, patch: Partial<ScheduleItem>) => {
    onChange(value.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  const remove = (id: string) => onChange(value.filter((s) => s.id !== id))

  const quickAdds = [
    { title: "Dinner", kind: "food" as const, hour: 18 },
    { title: "Fika / Break", kind: "break" as const, hour: 12 },
    { title: "Voting", kind: "voting" as const, hour: 14 },
    { title: "Prize ceremony", kind: "prize" as const, hour: 16 },
  ]

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2/40 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{t("events.schedule") as string ?? "Schedule"}</span>
        <span className="text-xs text-muted-foreground">{value.length} {t("events.items" as never) ?? "items"}</span>
      </div>

      {hasRange && (
        <PinnedBlock
          label={t("events.starts" as never) ?? "Starts"}
          hint={t("events.schedule_start_hint" as never) ?? "first block"}
          value={startValue!}
          onChange={onStartChange!}
          actions={startActions ?? []}
          onActionsChange={onStartActionsChange}
          disablePast={disablePast}
          iconBg="bg-accent"
          border="border-accent/40"
          bg="bg-accent-soft"
          expanded={expanded.has("__start__")}
          onToggle={()=>toggle("__start__")}
          emptyHint="When the event starts — add an announcement to ping @everyone."
        />
      )}

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("events.schedule_empty" as never) ?? "No schedule yet — add dinner, breaks, voting etc."}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((item) => {
            const isExp = expanded.has(item.id)
            const KindIcon = KINDS.find((k) => k.id === item.kind)?.icon ?? Clock
            const dt = new Date(item.time)
            const timeBadge = format(dt, "MMM d, HH:mm")
            const dayBadge = format(dt, "EEE")
            const actions = item.actions ?? []
            return (
              <Card key={item.id} className="overflow-hidden border-border bg-background">
                <button
                  type="button"
                  onClick={()=>toggle(item.id)}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/40"
                >
                  <KindIcon className="size-4 shrink-0 text-accent" />
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent">
                    <Clock className="size-3" />
                    <span className="hidden sm:inline">{timeBadge}</span>
                    <span className="sm:hidden">{format(dt, "HH:mm")}</span>
                    <span className="rounded bg-accent px-1 py-0 text-[10px] font-bold text-accent-foreground">{dayBadge}</span>
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.title || <span className="text-muted-foreground italic">Untitled</span>}</span>
                  {actions.length > 0 && (
                    <Badge variant="secondary" className="shrink-0 gap-1 text-[10px]"><Zap className="size-3" />{actions.length}</Badge>
                  )}
                  <Badge variant="secondary" className="hidden shrink-0 text-[10px] sm:inline-flex">{item.kind ?? "custom"}</Badge>
                  {isExp ? <ChevronUp className="size-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="size-4 shrink-0 text-muted-foreground" />}
                </button>
                {isExp && (
                  <div className="flex flex-col gap-3 border-t border-border p-3">
                    <div className="grid gap-2 sm:grid-cols-[auto_1fr_auto]">
                      <DateTimePicker
                        value={toLocalIso(dt)}
                        onChange={(v) => update(item.id, { time: v ? Date.parse(v) : item.time })}
                        disablePast={disablePast}
                        minDate={disablePast && startValue ? (() => { const d = new Date(startValue); d.setHours(0,0,0,0); return d })() : undefined}
                        className="h-8 w-44"
                      />
                      <Input
                        value={item.title}
                        onChange={(e) => update(item.id, { title: e.target.value })}
                        placeholder="Dinner, Fika, Voting…"
                        className="h-8 text-sm"
                        maxLength={80}
                      />
                      <Select value={item.kind ?? "custom"} onValueChange={(v) => update(item.id, { kind: v as ScheduleItem["kind"] })}>
                        <SelectTrigger className="h-8 w-28 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {KINDS.map((k) => (
                            <SelectItem key={k.id} value={k.id!}>{k.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Input
                      value={item.description ?? ""}
                      onChange={(e) => update(item.id, { description: e.target.value || undefined })}
                      placeholder="Details (optional) — e.g. Pizza in the kitchen"
                      className="h-8 text-xs"
                      maxLength={200}
                    />
                    <ScheduleItemActions item={item} onChange={(actions)=>update(item.id, { actions })} />

                    <div className="flex justify-end">
                      <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => remove(item.id)}>
                        <Trash2 className="size-3.5" /> Remove block
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <Button variant="secondary" size="sm" onClick={() => add()}>
          <Plus /> {t("events.add_schedule" as never) ?? "Add item"}
        </Button>
        <span className="mx-1 self-center text-xs text-muted-foreground">· quick:</span>
        {quickAdds.map((q) => (
          <Button
            key={q.title}
            variant="outline"
            size="sm"
            onClick={() => {
              const d = new Date()
              d.setHours(q.hour, 0, 0, 0)
              add({ title: q.title, kind: q.kind, time: d.getTime() })
            }}
          >
            {q.hour}:00 {q.title}
          </Button>
        ))}
      </div>

      {hasRange && (
        <PinnedBlock
          label={t("events.ends" as never) ?? "Ends"}
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
          emptyHint="When the event ends — add a wrap-up announcement if you want."
        />
      )}
    </div>
  )
}

function PinnedBlock({
  label, hint, value, onChange, actions, onActionsChange, disablePast, minDate, iconBg, border, bg, expanded, onToggle, emptyHint,
}: {
  label: string; hint: string; value: string; onChange: (v: string)=>void; actions: ScheduleAction[]; onActionsChange?: (a: ScheduleAction[])=>void; disablePast?: boolean; minDate?: Date; iconBg: string; border: string; bg: string; expanded: boolean; onToggle: ()=>void; emptyHint: string;
}) {
  const hasActions = actions.length > 0
  return (
    <div className={`rounded-lg border ${border} ${bg}`}>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 px-3 py-2.5 text-left">
        <span className={`flex size-7 items-center justify-center rounded-md ${iconBg} text-white`}>
          <Clock className="size-3.5" />
        </span>
        <span className="text-sm font-semibold">{label}</span>
        {value ? (
          <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">{(() => { try { return format(new Date(value), "MMM d, HH:mm EEE") } catch { return hint } })()}</span>
        ) : (
          <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">{hint}</span>
        )}
        {hasActions && <Badge variant="secondary" className="ml-2 gap-1 text-[10px]"><Zap className="size-3" />{actions.length}</Badge>}
        <span className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">{expanded ? "Hide" : hasActions ? `${actions.length} actions` : "Add actions"}</span>
          {expanded ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
        </span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-3 border-t border-border bg-background px-3 py-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-medium text-muted-foreground">Time</span>
            <DateTimePicker value={value} onChange={onChange} disablePast={disablePast} minDate={minDate} className="h-8 w-48" />
            <span className="text-xs text-muted-foreground">This is the event {label.toLowerCase()} time.</span>
          </div>
          {onActionsChange ? (
            <InlineActions
              timeLabel={label}
              timeValue={value}
              actions={actions}
              onChange={onActionsChange}
              emptyHint={emptyHint}
            />
          ) : (
            <p className="text-xs text-muted-foreground">{emptyHint}</p>
          )}
        </div>
      )}
    </div>
  )
}

function InlineActions({ timeLabel, timeValue, actions, onChange, emptyHint }: { timeLabel: string; timeValue: string; actions: ScheduleAction[]; onChange: (a: ScheduleAction[])=>void; emptyHint: string }) {
  const hasActions = actions.length > 0
  function addAction() {
    const id = `sact_${Math.random().toString(36).slice(2, 6)}`
    const dt = (()=>{ try { return format(new Date(timeValue), "HH:mm") } catch { return "" }})()
    const next: ScheduleAction = { id, type: "announce", title: `${timeLabel} — ${dt}`, message: `🚀 **{event}** ${timeLabel.toLowerCase()}s ${timeLabel==="Starts" ? "{everyone} {panel}" : "{everyone}"}`, channelId: null }
    onChange([...actions, next])
  }
  function updateAction(id: string, patch: Partial<ScheduleAction>) {
    onChange(actions.map(a=>a.id===id ? { ...a, ...patch } : a))
  }
  function removeAction(id: string) { onChange(actions.filter(a=>a.id!==id)) }

  return (
    <div className="rounded-lg border border-dashed border-border bg-surface-2/20">
      <div className="flex items-center justify-between px-2.5 py-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Zap className="size-3 text-accent" /> {hasActions ? `${actions.length} action${actions.length>1?'s':''} — will run at ${(() => { try { return format(new Date(timeValue), "HH:mm") } catch { return "event time"} })()}` : `No actions yet — ${emptyHint}`}</span>
        <Button variant="secondary" size="sm" className="h-6 text-xs" onClick={addAction}><Plus className="size-3" /> Add announcement</Button>
      </div>
      {hasActions && (
        <div className="flex flex-col gap-2 border-t border-border p-2">
          {actions.map(a=>(
            <Card key={a.id} className="border-border bg-background">
              <CardContent className="flex flex-col gap-2 p-2.5">
                <div className="flex items-center gap-2">
                  <Megaphone className="size-3.5 text-accent" />
                  <span className="text-xs font-semibold">Announce when {timeLabel.toLowerCase()}s</span>
                  <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground"><HelpTag /> tags: {"{everyone}"} {"{event}"} {"{panel}"}</span>
                  <Button variant="ghost" size="icon" className="size-6" onClick={()=>removeAction(a.id)}><Trash2 className="size-3" /></Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px]">Title</Label>
                    <Input value={a.title} onChange={e=>updateAction(a.id, { title: e.target.value })} placeholder={`${timeLabel} — live!`} className="h-7 text-xs" maxLength={100} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px]">Channel override (optional)</Label>
                    <Input value={a.channelId ?? ""} onChange={e=>updateAction(a.id, { channelId: e.target.value.trim() || null })} placeholder="defaults to announcement channel" className="h-7 text-xs font-mono" />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px]">Message</Label>
                  <Textarea value={a.message} onChange={e=>updateAction(a.id, { message: e.target.value })} placeholder={`🚀 {event} is live! {everyone} → {panel}`} className="min-h-[56px] text-xs" maxLength={2000} />
                </div>
                <div className="flex flex-wrap gap-1">
                  {["{everyone}","{here}","{event}","{panel}","{timer}","{schedule_title}"].map(tag=>(
                    <button key={tag} type="button" onClick={()=>updateAction(a.id, { message: a.message ? `${a.message} ${tag}` : tag })}><TagPill tag={tag} /></button>
                  ))}
                  <span className="self-center text-[11px] text-muted-foreground">hover for meaning — click to insert</span>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function ScheduleItemActions({ item, onChange }: { item: ScheduleItem; onChange: (actions: ScheduleAction[])=>void }) {
  const [open, setOpen] = useState(false)
  const actions = item.actions ?? []
  const hasActions = actions.length > 0

  function addAction() {
    const id = `sact_${Math.random().toString(36).slice(2, 6)}`
    const next: ScheduleAction = { id, type: "announce", title: item.title, message: `⏰ **{schedule_title}** — {schedule_desc} {everyone}`, channelId: null }
    onChange([...actions, next])
    setOpen(true)
  }
  function updateAction(id: string, patch: Partial<ScheduleAction>) {
    onChange(actions.map(a=>a.id===id ? { ...a, ...patch } : a))
  }
  function removeAction(id: string) { onChange(actions.filter(a=>a.id!==id)) }

  return (
    <div className="rounded-lg border border-dashed border-border bg-surface-2/20">
      <button
        type="button"
        onClick={()=>setOpen(v=>!v)}
        className="flex w-full items-center justify-between px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <span className="flex items-center gap-1.5"><Zap className="size-3 text-accent" /> {hasActions ? `${actions.length} action${actions.length>1?'s':''} — will run at ${format(new Date(item.time), "HH:mm")}` : "No actions — click to add (Zapier-style)"} </span>
        {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
        {!hasActions && <Badge variant="secondary" className="ml-auto mr-2 text-[10px]">optional</Badge>}
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-border p-2">
          {actions.length===0 && <p className="px-1 text-xs text-muted-foreground">When this block hits, do nothing by default. Add an announcement (or multiple) — they auto-fire with tags like {"{everyone}"} {"{schedule_title}"} {"{timer_schedule}"}. See Templates → Announcements for presets.</p>}
          {actions.map(a=>(
            <Card key={a.id} className="border-border bg-background">
              <CardContent className="flex flex-col gap-2 p-2.5">
                <div className="flex items-center gap-2">
                  <Megaphone className="size-3.5 text-accent" />
                  <span className="text-xs font-semibold">Announce</span>
                  <span className="ml-auto flex items-center gap-1 text-[11px] text-muted-foreground"><HelpTag /> tags: {"{everyone}"} {"{schedule_title}"} {"{panel}"}</span>
                  <Button variant="ghost" size="icon" className="size-6" onClick={()=>removeAction(a.id)}><Trash2 className="size-3" /></Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px]">Title</Label>
                    <Input value={a.title} onChange={e=>updateAction(a.id, { title: e.target.value })} placeholder="{schedule_title}" className="h-7 text-xs" maxLength={100} />
                  </div>
                  <div className="flex flex-col gap-1">
                    <Label className="text-[11px]">Channel override (optional)</Label>
                    <Input value={a.channelId ?? ""} onChange={e=>updateAction(a.id, { channelId: e.target.value.trim() || null })} placeholder="defaults to announcement channel" className="h-7 text-xs font-mono" />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px]">Message</Label>
                  <Textarea value={a.message} onChange={e=>updateAction(a.id, { message: e.target.value })} placeholder="⏰ {schedule_title} — {schedule_desc} {everyone}" className="min-h-[56px] text-xs" maxLength={2000} />
                </div>
                <div className="flex flex-wrap gap-1">
                  {["{everyone}","{here}","{schedule_title}","{schedule_desc}","{panel}","{timer_schedule}"].map(tag=>(
                    <button key={tag} type="button" onClick={()=>updateAction(a.id, { message: a.message ? `${a.message} ${tag}` : tag })}><TagPill tag={tag} /></button>
                  ))}
                  <span className="self-center text-[11px] text-muted-foreground">hover for meaning — click to insert</span>
                </div>
              </CardContent>
            </Card>
          ))}
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={addAction}><Plus className="size-3" /> Add announcement</Button>
            <span className="self-center text-xs text-muted-foreground">multiple allowed — all fire at this time</span>
          </div>
        </div>
      )}
    </div>
  )
}

function HelpTag() {
  return (
    <Popover>
      <PopoverTrigger asChild><button className="inline-flex size-4 items-center justify-center rounded-full bg-muted text-muted-foreground"><HelpCircle className="size-3" /></button></PopoverTrigger>
      <PopoverContent className="w-64 text-xs leading-relaxed" align="end">
        <div className="font-semibold mb-1">Tags</div>
        <div className="grid gap-1 font-mono text-[11px]">
          <span>{"{event}"} — event name</span>
          <span>{"{panel}"} — &lt;#panel&gt;</span>
          <span>{"{everyone}"} — @everyone ping</span>
          <span>{"{schedule_title}"} — this block's title</span>
          <span>{"{timer_schedule}"} — relative time</span>
        </div>
      </PopoverContent>
    </Popover>
  )
}
