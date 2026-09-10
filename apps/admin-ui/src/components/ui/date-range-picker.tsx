"use client"

import * as React from "react"
import { format } from "date-fns"
import { CalendarIcon, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"
import type { DateRange } from "react-day-picker"

function toLocalIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function parseLocalIso(v: string): Date | undefined {
  if (!v) return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d
}

export function DateRangePicker({
  from,
  to,
  onChange,
  placeholder = "Pick date range",
  className,
}: {
  from: string
  to: string
  onChange: (next: { from: string; to: string }) => void
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = React.useState(false)
  const fromDate = parseLocalIso(from)
  const toDate = parseLocalIso(to)

  const range: DateRange | undefined =
    fromDate || toDate ? { from: fromDate, to: toDate } : undefined

  const fromHour = fromDate ? String(fromDate.getHours()).padStart(2, "0") : "12"
  const fromMin = fromDate ? String(fromDate.getMinutes()).padStart(2, "0") : "00"
  const toHour = toDate ? String(toDate.getHours()).padStart(2, "0") : "12"
  const toMin = toDate ? String(toDate.getMinutes()).padStart(2, "0") : "00"

  const handleRangeSelect = (r: DateRange | undefined) => {
    if (!r) {
      onChange({ from: "", to: "" })
      return
    }
    const f = r.from
    const t = r.to ?? r.from

    let nextFrom = from
    let nextTo = to

    if (f) {
      const d = new Date(f)
      const h = fromDate ? fromDate.getHours() : 12
      const m = fromDate ? fromDate.getMinutes() : 0
      d.setHours(h, m, 0, 0)
      nextFrom = toLocalIso(d)
    } else nextFrom = ""

    if (t) {
      const d = new Date(t)
      const h = toDate ? toDate.getHours() : 12
      const m = toDate ? toDate.getMinutes() : 0
      // if same day range and no to yet, ensure to >= from
      d.setHours(h, m, 0, 0)
      nextTo = toLocalIso(d)
    } else nextTo = ""

    // ensure ordering: if from > to, swap times geometrically? keep as-is but caller will validate end > start
    onChange({ from: nextFrom, to: nextTo })
  }

  const handleTimeChange = (which: "fromH" | "fromM" | "toH" | "toM", v: string) => {
    if (which === "fromH" || which === "fromM") {
      if (!fromDate) {
        const d = new Date()
        d.setHours(which === "fromH" ? Number(v) : Number(fromHour), which === "fromM" ? Number(v) : Number(fromMin), 0, 0)
        onChange({ from: toLocalIso(d), to })
        return
      }
      const d = new Date(fromDate)
      if (which === "fromH") d.setHours(Number(v))
      else d.setMinutes(Number(v))
      onChange({ from: toLocalIso(d), to })
    } else {
      if (!toDate) {
        const d = fromDate ? new Date(fromDate) : new Date()
        d.setHours(which === "toH" ? Number(v) : Number(toHour), which === "toM" ? Number(v) : Number(toMin), 0, 0)
        onChange({ from, to: toLocalIso(d) })
        return
      }
      const d = new Date(toDate)
      if (which === "toH") d.setHours(Number(v))
      else d.setMinutes(Number(v))
      onChange({ from, to: toLocalIso(d) })
    }
  }

  const label = fromDate && toDate
    ? `${format(fromDate, "MMM d, HH:mm")} – ${format(toDate, "MMM d, HH:mm")}`
    : fromDate
      ? `${format(fromDate, "PPP p")} – …`
      : placeholder

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          className={cn("h-9 w-full justify-start text-left font-normal", !fromDate && "text-muted-foreground", className)}
        >
          <CalendarIcon className="size-4 shrink-0" />
          <span className="truncate">{label}</span>
          {(from || to) && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onChange({ from: "", to: "" }) }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onChange({ from: "", to: "" }) } }}
              className="ml-auto flex size-6 items-center justify-center rounded-md hover:bg-muted"
              aria-label="Clear range"
            >
              <X className="size-3.5" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="range" selected={range} onSelect={handleRangeSelect} numberOfMonths={2} captionLayout="dropdown" className="p-3" />
        <div className="grid gap-3 border-t border-border p-3">
          <div className="flex items-center gap-2">
            <span className="w-10 text-xs font-medium text-muted-foreground">Start</span>
            <Select value={fromHour} onValueChange={(v) => handleTimeChange("fromH", v)}>
              <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
              <SelectContent>{Array.from({ length: 24 }, (_, i) => { const h = String(i).padStart(2,"0"); return <SelectItem key={h} value={h}>{h}</SelectItem> })}</SelectContent>
            </Select>
            <span className="text-muted-foreground">:</span>
            <Select value={fromMin} onValueChange={(v) => handleTimeChange("fromM", v)}>
              <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
              <SelectContent>{["00","05","10","15","20","25","30","35","40","45","50","55"].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-10 text-xs font-medium text-muted-foreground">End</span>
            <Select value={toHour} onValueChange={(v) => handleTimeChange("toH", v)}>
              <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
              <SelectContent>{Array.from({ length: 24 }, (_, i) => { const h = String(i).padStart(2,"0"); return <SelectItem key={h} value={h}>{h}</SelectItem> })}</SelectContent>
            </Select>
            <span className="text-muted-foreground">:</span>
            <Select value={toMin} onValueChange={(v) => handleTimeChange("toM", v)}>
              <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
              <SelectContent>{["00","05","10","15","20","25","30","35","40","45","50","55"].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setOpen(false)}>Done</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
