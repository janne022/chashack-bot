"use client"
import { useState } from "react"
import { Plus, Trash2, Megaphone, Clock, Rocket, Hand, Eye, Lock, UsersRound } from "lucide-react"
import type { AnnouncementTemplate, ScheduleItem } from "@/types"
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/textarea-label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { TagAutocompleteInput, TagAutocompleteTextarea } from "@/components/TagAutocomplete"

const TRIGGER_META: Record<AnnouncementTemplate["trigger"], { label: string; icon: typeof Megaphone; desc: string; color: string }> = {
  on_activate: { label: "On activate", icon: Rocket, desc: "Sent once when you hit Activate — e.g. 'signups open!'", color: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30" },
  on_start: { label: "At event start", icon: Clock, desc: "Not yet auto — use as manual template for start. (Schedule items cover timed announces)", color: "bg-blue-500/10 text-blue-700 border-blue-500/30" },
  schedule: { label: "For each schedule item", icon: Clock, desc: "Auto-sent when a schedule block's time hits (within ~60 min). Uses {schedule_title} etc.", color: "bg-amber-500/10 text-amber-700 border-amber-500/30" },
  manual: { label: "Manual only", icon: Hand, desc: "Only via the Announce button — pick this template as a preset.", color: "bg-muted text-muted-foreground" },
  teams_locked: { label: "Teams locked", icon: Lock, desc: "When teams are locked (auto-match or manual lock). Good for 'teams are final!'", color: "bg-purple-500/10 text-purple-700 border-purple-500/30" },
  teams_assigned: { label: "Teams assigned", icon: UsersRound, desc: "When teams are created/assigned via matching. Announce new teams.", color: "bg-cyan-500/10 text-cyan-700 border-cyan-500/30" },
}

function renderPreview(template: string, eventName: string, scheduleItem?: ScheduleItem): string {
  let s = template
  s = s.replaceAll("{event}", eventName || "My Event")
  s = s.replaceAll("{event_description}", "A cool hackathon")
  s = s.replaceAll("{panel}", "#signup-panel")
  s = s.replaceAll("{announce}", "#announcements")
  s = s.replaceAll("{everyone}", "@everyone")
  s = s.replaceAll("{here}", "@here")
  s = s.replaceAll("{timer}", "in 2 hours")
  s = s.replaceAll("{startsAt}", "Saturday, June 14, 2026 09:00")
  s = s.replaceAll("{endsAt}", "Sunday, June 15, 2026 18:00")
  if (scheduleItem) {
    s = s.replaceAll("{schedule_title}", scheduleItem.title)
    s = s.replaceAll("{schedule_desc}", scheduleItem.description ?? "")
    s = s.replaceAll("{schedule_time}", "18:00")
    s = s.replaceAll("{timer_schedule}", "in 10 minutes")
    s = s.replaceAll("{schedule_kind}", scheduleItem.kind ?? "custom")
    s = s.replaceAll("{schedule}", `• 18:00 ${scheduleItem.title}`)
  } else {
    s = s.replaceAll("{schedule}", "• 18:00 Dinner\n• 12:00 Fika")
    s = s.replaceAll("{schedule_title}", "Dinner")
    s = s.replaceAll("{schedule_desc}", "Pizza")
    s = s.replaceAll("{schedule_time}", "18:00")
    s = s.replaceAll("{timer_schedule}", "in 10 minutes")
    s = s.replaceAll("{schedule_kind}", "food")
  }
  return s
}

export function AnnouncementEditor({
  value,
  onChange,
  eventName,
  schedule,
}: {
  value: AnnouncementTemplate[]
  onChange: (next: AnnouncementTemplate[]) => void
  eventName: string
  schedule: ScheduleItem[]
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const sampleItem = schedule[0] ?? { id: "sample", time: Date.now(), title: "Dinner", description: "Pizza", kind: "food" as const }

  function add(trigger: AnnouncementTemplate["trigger"] = "manual") {
    const id = `ann_${Math.random().toString(36).slice(2, 8)}`
    const defaults: Record<AnnouncementTemplate["trigger"], { title: string; message: string }> = {
      on_activate: { title: `${eventName || "Event"} — signups open!`, message: "Listen up {everyone} **{event}** is live! Sign up in {panel} — starts {timer}" },
      on_start: { title: "{event} starting now!", message: "{everyone} **{event}** starts {timer} — head to {panel}!" },
      schedule: { title: "{schedule_title}", message: "⏰ **{schedule_title}** — {schedule_desc} {timer_schedule} {everyone}" },
      manual: { title: "Heads up!", message: "Hey {everyone}, quick update for **{event}** — {panel}" },
      teams_locked: { title: "Teams locked!", message: "🔒 Teams for **{event}** are locked — {everyone} check your channels!" },
      teams_assigned: { title: "Teams assigned", message: "✅ **{event}** teams have been assigned — good luck {everyone}!" },
    }
    const d = defaults[trigger]
    onChange([...value, { id, title: d.title, message: d.message, trigger }])
    setEditingId(id)
  }
  function update(id: string, patch: Partial<AnnouncementTemplate>) {
    onChange(value.map(a=>a.id===id ? { ...a, ...patch } : a))
  }
  function remove(id: string) { onChange(value.filter(a=>a.id!==id)) }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Announcements</span>
        <span className="text-xs text-muted-foreground">Tag-based Discord messages — tied to schedule &amp; triggers. Type <code className="rounded bg-muted px-1 font-mono text-xs">{"{"}</code> for suggestions.</span>
      </div>

      {value.length===0 && <p className="rounded-lg border border-dashed border-border bg-surface-2/30 px-3 py-3 text-sm text-muted-foreground">No announcements yet — add one. Schedule items auto-announce with the <Badge variant="outline" className="mx-1">For each schedule item</Badge> template. At least add an “On activate” one.</p>}

      <div className="flex flex-col gap-3">
        {value.map(ann=>{
          const meta = TRIGGER_META[ann.trigger]
          const Icon = meta.icon
          const isEditing = editingId===ann.id
          return (
            <Card key={ann.id} className={isEditing ? "border-accent/50" : undefined}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${meta.color}`}><Icon className="size-3.5" />{meta.label}</span>
                    {!isEditing && <span className="truncate text-sm font-semibold">{ann.title}</span>}
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="sm" onClick={()=>setEditingId(isEditing ? null : ann.id)}>{isEditing ? "Done" : "Edit"}</Button>
                    <Button variant="ghost" size="icon" className="size-8" onClick={()=>remove(ann.id)}><Trash2 className="size-4" /></Button>
                  </div>
                </div>
                {!isEditing && <CardDescription className="line-clamp-2 whitespace-pre-wrap break-words">{ann.message}</CardDescription>}
                {!isEditing && <div className="flex items-center gap-1 text-xs text-muted-foreground"><Eye className="size-3" /> Preview: <span className="truncate italic">“{renderPreview(ann.message, eventName, sampleItem).slice(0,120)}”</span></div>}
              </CardHeader>
              {isEditing && (
                <CardContent className="flex flex-col gap-3">
                  <div className="flex flex-col gap-2">
                    <Label>Trigger</Label>
                    <Select value={ann.trigger} onValueChange={v=>update(ann.id, { trigger: v as AnnouncementTemplate["trigger"] })}>
                      <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="on_activate">On activate (once)</SelectItem>
                        <SelectItem value="on_start">At event start</SelectItem>
                        <SelectItem value="schedule">For each schedule item (auto)</SelectItem>
                        <SelectItem value="teams_locked">Teams locked</SelectItem>
                        <SelectItem value="teams_assigned">Teams assigned</SelectItem>
                        <SelectItem value="manual">Manual only</SelectItem>
                      </SelectContent>
                    </Select>
                    <span className="text-xs text-muted-foreground">{meta.desc}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Title (embed header)</Label>
                    <TagAutocompleteInput value={ann.title} onChange={v=>update(ann.id, { title: v })} placeholder="e.g. {schedule_title}" maxLength={100} />
                    <span className="text-[11px] text-muted-foreground">Preview: {renderPreview(ann.title, eventName, sampleItem)}</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label>Message (type {"{"} for tag suggestions)</Label>
                    <TagAutocompleteTextarea value={ann.message} onChange={v=>update(ann.id, { message: v })} placeholder="Listen up {everyone} {event} starts {timer} — {panel}" maxLength={2000} />
                    <div className="rounded-md bg-surface-2/60 px-2.5 py-2 text-xs leading-relaxed">
                      <span className="font-medium">Preview:</span> <span className="whitespace-pre-wrap break-words">{renderPreview(ann.message, eventName, sampleItem)}</span>
                    </div>
                  </div>
                </CardContent>
              )}
            </Card>
          )
        })}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={()=>add("on_activate")}><Rocket className="size-4" /> On activate</Button>
        <Button variant="secondary" size="sm" onClick={()=>add("schedule")}><Clock className="size-4" /> For schedule</Button>
        <Button variant="secondary" size="sm" onClick={()=>add("teams_locked")}><Lock className="size-4" /> Teams locked</Button>
        <Button variant="outline" size="sm" onClick={()=>add("manual")}><Megaphone className="size-4" /> Manual</Button>
        <Button variant="ghost" size="sm" onClick={()=>add("on_start")}><Plus className="size-4" /> At start</Button>
        <Button variant="ghost" size="sm" onClick={()=>add("teams_assigned")}><UsersRound className="size-4" /> Teams assigned</Button>
      </div>
    </div>
  )
}
