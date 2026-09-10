"use client"
import { useState } from "react"
import type { FormConfig, ScheduleItem } from "@/types"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label, Textarea } from "@/components/ui/textarea-label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ScheduleEditor } from "@/components/ui/schedule-editor"
import { FormConfigEditor } from "@/components/FormConfigEditor"
import { ChevronDown, ChevronUp } from "lucide-react"

export interface EventTemplateDraft {
  name: string
  description: string
  cleanupDelayHours: number
  form: FormConfig
  schedule: ScheduleItem[]
}

export function EventTemplateEditor({
  value,
  onChange,
  formTemplates,
}: {
  value: EventTemplateDraft
  onChange: (next: EventTemplateDraft) => void
  formTemplates: { id: string; name: string; json: string }[]
}) {
  const [formMode, setFormMode] = useState<"inline" | "template">("inline")
  const [selectedFormId, setSelectedFormId] = useState<string>("")
  const [showForm, setShowForm] = useState(false)

  function pickFormTemplate(id: string) {
    setSelectedFormId(id)
    const tpl = formTemplates.find(f => f.id === id)
    if (!tpl) return
    try {
      const parsed = JSON.parse(tpl.json) as FormConfig
      onChange({ ...value, form: parsed })
    } catch { /* ignore */ }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader><CardTitle>Event details</CardTitle><CardDescription>Name, description and when the event runs. Dates are set when you create the event from this template.</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>Template name (shown in picker)</Label>
            <Input value={value.name} onChange={e=>onChange({ ...value, name: e.target.value })} placeholder="e.g. ChasHack Spring 2026" maxLength={80} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Description</Label>
            <Textarea value={value.description} onChange={e=>onChange({ ...value, description: e.target.value })} placeholder="48-hour hackathon…" maxLength={1000} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Cleanup delay (hours after end)</Label>
            <Input type="number" min={0} max={720} value={String(value.cleanupDelayHours)} onChange={e=>onChange({ ...value, cleanupDelayHours: Math.min(720, Math.max(0, Number(e.target.value)||0)) })} className="w-32" />
            <span className="text-xs text-muted-foreground">Team channels/roles are removed after this delay. People get warnings at 72h and 24h.</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div><CardTitle>Schedule</CardTitle><CardDescription>Reusable itinerary (12:00 Fika, 18:00 Dinner, Voting…). Times are relative — actual dates set on creation.</CardDescription></div>
          </div>
        </CardHeader>
        <CardContent>
          <ScheduleEditor value={value.schedule} onChange={sched=>onChange({ ...value, schedule: sched })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div><CardTitle>Signup form</CardTitle><CardDescription>This form is used when someone does /hackathon join for events from this template. Pick a saved form or customize below.</CardDescription></div>
            <Button variant="outline" size="sm" onClick={()=>setShowForm(v=>!v)}>{showForm ? <><ChevronUp className="size-4" />Hide</> : <><ChevronDown className="size-4" />Edit</>}</Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Use:</span>
            <Button variant={formMode==="inline" ? "secondary" : "outline"} size="sm" onClick={()=>setFormMode("inline")}>Custom (embedded)</Button>
            <Button variant={formMode==="template" ? "secondary" : "outline"} size="sm" onClick={()=>setFormMode("template")}>From form template</Button>
            {formMode==="template" && (
              <Select value={selectedFormId} onValueChange={pickFormTemplate}>
                <SelectTrigger className="w-56"><SelectValue placeholder="Pick a form template" /></SelectTrigger>
                <SelectContent>{formTemplates.map(f=><SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
          {showForm && <FormConfigEditor value={value.form} onChange={form=>onChange({ ...value, form })} />}
          {!showForm && <div className="rounded-lg border border-dashed border-border bg-surface-2/40 px-3 py-2 text-sm text-muted-foreground">{value.form.title} · team size {value.form.teamSize} · {value.form.roleTracks.length} roles · {value.form.skills.length} skills</div>}
        </CardContent>
      </Card>
    </div>
  )
}
