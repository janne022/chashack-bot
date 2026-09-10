"use client"

import { Plus, Trash2, Utensils, Coffee, Vote, Trophy, Mic, Clock } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DateTimePicker } from "@/components/ui/datetime-picker"
import type { ScheduleItem } from "@/types"
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
    // if preset has hour hint like 18, set that hour
    const time = preset?.time ?? base.getTime()
    const title = preset?.title ?? ""
    const kind = preset?.kind ?? "custom"
    const id = `sch_${Math.random().toString(36).slice(2, 8)}`
    onChange([...value, { id, time, title, kind }])
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
            return (
              <div key={item.id} className="flex items-center gap-2 rounded-lg border border-border bg-background p-2">
                <KindIcon className="size-4 shrink-0 text-accent" />
                <DateTimePicker
                  value={iso}
                  onChange={(v) => update(item.id, { time: v ? Date.parse(v) : item.time })}
                  disablePast={disablePast}
                  minDate={disablePast && startValue ? (() => { const d = new Date(startValue); d.setHours(0,0,0,0); return d })() : undefined}
                  className="h-8 w-44"
                />
                <Select value={item.kind ?? "custom"} onValueChange={(v) => update(item.id, { kind: v as ScheduleItem["kind"] })}>
                  <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
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
                  className="h-8 flex-1"
                  maxLength={80}
                />
                <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={() => remove(item.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
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
