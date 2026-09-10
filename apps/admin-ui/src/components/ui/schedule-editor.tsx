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
  disablePast,
}: {
  value: ScheduleItem[]
  onChange: (next: ScheduleItem[]) => void
  startValue?: string
  endValue?: string
  onStartChange?: (v: string) => void
  onEndChange?: (v: string) => void
  disablePast?: boolean
}) {
  const t = useT()
  const sorted = [...value].sort((a, b) => a.time - b.time)
  const hasRange = onStartChange !== undefined && onEndChange !== undefined && startValue !== undefined && endValue !== undefined

  const add = (preset?: Partial<ScheduleItem>) => {
    const base = new Date()
    base.setMinutes(0, 0, 0)
    const time = preset?.time ?? base.getTime()
    const title = preset?.title ?? ""
    const kind = preset?.kind ?? "custom"
    const id = `sch_${Math.random().toString(36).slice(2, 8)}`
    onChange([...value, { id, time, title, kind, actions: [] }])
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
        <div className="flex items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft px-3 py-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-accent text-accent-foreground">
            <Clock className="size-3.5" />
          </span>
          <span className="text-sm font-semibold">{t("events.starts" as never) ?? "Starts"}</span>
          <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">{t("events.schedule_start_hint" as never) ?? "first block"}</span>
          <DateTimePicker value={startValue!} onChange={(v) => onStartChange!(v)} disablePast={disablePast} className="ml-auto h-8 w-48" />
        </div>
      )}

      {sorted.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("events.schedule_empty" as never) ?? "No schedule yet — add dinner, breaks, voting etc."}</p>
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((item) => {
            const iso = toLocalIso(new Date(item.time))
            const KindIcon = KINDS.find((k) => k.id === item.kind)?.icon ?? Clock
            const dt = new Date(item.time)
            const timeBadge = format(dt, "MMM d, HH:mm")
            const dayBadge = format(dt, "EEE")
            return (
              <Card key={item.id} className="overflow-hidden border-border bg-background">
                <div className="flex items-start gap-2 p-3">
                  <KindIcon className="mt-1 size-4 shrink-0 text-accent" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    {/* Top row: visible time + kind + title */}
                    <div className="flex flex-wrap items-center gap-2">
                      {/* Visible time badge — always readable without clicking */}
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent">
                        <Clock className="size-3" />
                        <span className="hidden sm:inline">{timeBadge}</span>
                        <span className="sm:hidden">{format(dt, "HH:mm")}</span>
                        <span className="rounded bg-accent px-1 py-0 text-[10px] font-bold text-accent-foreground">{dayBadge}</span>
                      </span>
                      {/* Edit time popover trigger is still the picker, but compact */}
                      <DateTimePicker
                        value={iso}
                        onChange={(v) => update(item.id, { time: v ? Date.parse(v) : item.time })}
                        disablePast={disablePast}
                        minDate={disablePast && startValue ? (() => { const d = new Date(startValue); d.setHours(0,0,0,0); return d })() : undefined}
                        className="h-7 w-7 p-0 sm:h-7 sm:w-32"
                      />
                      <Select value={item.kind ?? "custom"} onValueChange={(v) => update(item.id, { kind: v as ScheduleItem["kind"] })}>
                        <SelectTrigger className="h-7 w-28 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {KINDS.map((k) => (
                            <SelectItem key={k.id} value={k.id!}>{k.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={item.title}
                        onChange={(e) => update(item.id, { title: e.target.value })}
                        placeholder="Dinner, Fika, Voting…"
                        className="h-7 min-w-[140px] flex-1 text-sm"
                        maxLength={80}
                      />
                      <Button variant="ghost" size="icon" className="size-7 shrink-0" onClick={() => remove(item.id)}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                    {/* Description */}
                    <Input
                      value={item.description ?? ""}
                      onChange={(e) => update(item.id, { description: e.target.value || undefined })}
                      placeholder="Details (optional) — e.g. Pizza in the kitchen"
                      className="h-7 text-xs"
                      maxLength={200}
                    />
                    {/* Actions — Zapier-like */}
                    <ScheduleItemActions item={item} onChange={(actions)=>update(item.id, { actions })} />
                  </div>
                </div>
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
        <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2">
          <span className="flex size-7 items-center justify-center rounded-md bg-danger text-danger-foreground">
            <Clock className="size-3.5" />
          </span>
          <span className="text-sm font-semibold">{t("events.ends" as never) ?? "Ends"}</span>
          <span className="ml-2 hidden text-xs text-muted-foreground sm:inline">{t("events.schedule_end_hint" as never) ?? "last block"}</span>
          <DateTimePicker value={endValue!} onChange={(v) => onEndChange!(v)} disablePast={disablePast} minDate={disablePast && startValue ? (() => { const d = new Date(startValue); return d })() : undefined} className="ml-auto h-8 w-48" />
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
