"use client"

import * as React from "react"
import { format } from "date-fns"
import { CalendarIcon, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

function toLocalIso(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function parseLocalIso(v: string): Date | undefined {
  if (!v) return undefined
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? undefined : d
}

export function DateTimePicker({
  value,
  onChange,
  placeholder = "Pick date & time",
  className,
  disabled,
  disablePast,
  minDate,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  disablePast?: boolean
  minDate?: Date
}) {
  const date = parseLocalIso(value)
  const [open, setOpen] = React.useState(false)

  const hours = date ? String(date.getHours()).padStart(2, "0") : "12"
  const minutes = date ? String(date.getMinutes()).padStart(2, "0") : "00"

  const todayStart = React.useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  }, [])
  const disabledMatcher = disablePast
    ? minDate
      ? { before: minDate }
      : { before: todayStart }
    : undefined

  const handleDateSelect = (d: Date | undefined) => {
    if (!d) return
    const h = date ? date.getHours() : 12
    const m = date ? date.getMinutes() : 0
    d.setHours(h, m, 0, 0)
    onChange(toLocalIso(d))
  }

  const handleTimeChange = (which: "h" | "m", v: string) => {
    if (!date) {
      const d = new Date()
      d.setHours(which === "h" ? Number(v) : Number(hours), which === "m" ? Number(v) : Number(minutes), 0, 0)
      onChange(toLocalIso(d))
      return
    }
    const d = new Date(date)
    if (which === "h") d.setHours(Number(v))
    else d.setMinutes(Number(v))
    onChange(toLocalIso(d))
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={disabled}
          className={cn(
            "h-9 w-full justify-start text-left font-normal",
            !date && "text-muted-foreground",
            className
          )}
        >
          <CalendarIcon className="size-4 shrink-0" />
          <span className="truncate">{date ? format(date, "PPP p") : placeholder}</span>
          {value && !disabled && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation()
                onChange("")
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  e.stopPropagation()
                  onChange("")
                }
              }}
              className="ml-auto flex size-6 items-center justify-center rounded-md hover:bg-muted"
              aria-label="Clear date"
            >
              <X className="size-3.5" />
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" selected={date} onSelect={handleDateSelect} disabled={disabledMatcher} captionLayout="dropdown" className="p-3" />
        <div className="flex items-center gap-2 border-t border-border p-3">
          <Select value={hours} onValueChange={(v) => handleTimeChange("h", v)}>
            <SelectTrigger className="h-8 w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 24 }, (_, i) => {
                const h = String(i).padStart(2, "0")
                return <SelectItem key={h} value={h}>{h}</SelectItem>
              })}
            </SelectContent>
          </Select>
          <span className="text-muted-foreground">:</span>
          <Select value={minutes} onValueChange={(v) => handleTimeChange("m", v)}>
            <SelectTrigger className="h-8 w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"].map((m) => (
                <SelectItem key={m} value={m}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
