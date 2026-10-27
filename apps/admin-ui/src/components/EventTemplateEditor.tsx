"use client"
import { useEffect, useId, useState } from "react"
import type { FormConfig, ScheduleItem, Assignment, AssignmentStrategy } from "@/types"
import { useT } from "@/lib/i18n"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label, Textarea } from "@/components/ui/textarea-label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ScheduleEditor } from "@/components/ui/schedule-editor"
import { FormConfigEditor } from "@/components/FormConfigEditor"
import { STRATEGY_OPTIONS } from "@/lib/assignment-strategy"
import { questionErrors } from "@/lib/question-validation"
import { ChevronDown, ChevronUp } from "lucide-react"

export interface EventTemplateDraft {
  name: string
  description: string
  cleanupDelayHours: number
  form: FormConfig
  schedule: ScheduleItem[]
  /** Default assignment collection for events created from this template. */
  assignmentCollectionId: string
  assignments?: Assignment[]
  assignmentStrategy: AssignmentStrategy
}

export function EventTemplateEditor({
  value,
  onChange,
  formTemplates,
  assignmentCollections,
}: {
  value: EventTemplateDraft
  onChange: (next: EventTemplateDraft) => void
  formTemplates: { id: string; name: string; json: string }[]
  assignmentCollections: { id: string; name: string }[]
}) {
  const t = useT()
  const fieldId = useId()
  const [formMode, setFormMode] = useState<"inline" | "template">("inline")
  const [selectedFormId, setSelectedFormId] = useState<string>("")
  const [showForm, setShowForm] = useState(false)
  const formVisible = showForm || Object.keys(questionErrors(value.form)).length > 0
  useEffect(() => { if (formVisible) setShowForm(true) }, [formVisible])

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
        <CardHeader><CardTitle>{t('event_template.details')}</CardTitle><CardDescription>{t('event_template.details_desc')}</CardDescription></CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-name`}>{t('event_template.name')}</Label>
            <Input id={`${fieldId}-name`} value={value.name} onChange={e=>onChange({ ...value, name: e.target.value })} placeholder={t('event_template.name_placeholder')} maxLength={80} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-description`}>{t('event_template.description')}</Label>
            <Textarea id={`${fieldId}-description`} value={value.description} onChange={e=>onChange({ ...value, description: e.target.value })} placeholder={t('event_template.description_placeholder')} maxLength={1000} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`${fieldId}-cleanup`}>{t('event_template.cleanup')}</Label>
            <Input id={`${fieldId}-cleanup`} type="number" min={0} max={720} value={String(value.cleanupDelayHours)} onChange={e=>onChange({ ...value, cleanupDelayHours: Math.min(720, Math.max(0, Number(e.target.value)||0)) })} className="w-32" />
            <span className="text-xs text-muted-foreground">{t('event_template.cleanup_desc')}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div><CardTitle>{t('events.schedule')}</CardTitle><CardDescription>{t('event_template.schedule_desc')}</CardDescription></div>
          </div>
        </CardHeader>
        <CardContent>
          <ScheduleEditor value={value.schedule} onChange={sched=>onChange({ ...value, schedule: sched })} timeMode="relative" />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <div><CardTitle>{t('event_template.signup_form')}</CardTitle><CardDescription>{t('event_template.signup_desc')}</CardDescription></div>
            <Button variant="outline" size="sm" aria-expanded={formVisible} onClick={()=>setShowForm(v=>!v)}>{formVisible ? <><ChevronUp className="size-4" />{t('schedule.hide')}</> : <><ChevronDown className="size-4" />{t('event_template.edit')}</>}</Button>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{t('event_template.use')}</span>
            <Button aria-pressed={formMode === 'inline'} variant={formMode==="inline" ? "secondary" : "outline"} size="sm" onClick={()=>setFormMode("inline")}>{t('event_template.embedded')}</Button>
            <Button aria-pressed={formMode === 'template'} variant={formMode==="template" ? "secondary" : "outline"} size="sm" onClick={()=>setFormMode("template")}>{t('event_template.from_form')}</Button>
            {formMode==="template" && (
              <Select value={selectedFormId} onValueChange={pickFormTemplate}>
                <SelectTrigger aria-label={t('event_template.pick_form')} className="w-56"><SelectValue placeholder={t('event_template.pick_form')} /></SelectTrigger>
                <SelectContent>{formTemplates.map(f=><SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>
          {formVisible && <FormConfigEditor value={value.form} onChange={form=>onChange({ ...value, form })} />}
          {!formVisible && <div className="rounded-lg border border-dashed border-border bg-surface-2/40 px-3 py-2 text-sm text-muted-foreground">{t('event_template.form_summary', { title: value.form.title, size: value.form.teamSize, roles: value.form.roleTracks.length, skills: value.form.skills.length })}</div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('event_template.assignments')}</CardTitle>
          <CardDescription>{t('event_template.assignments_desc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>{t('event_template.collection')}</Label>
            {assignmentCollections.length > 0 || (value.assignments?.length ?? 0) > 0 || !!value.assignmentCollectionId ? (
              <Select value={value.assignmentCollectionId || ((value.assignments?.length ?? 0) > 0 ? "__embedded" : "__none")} onValueChange={v => onChange({ ...value, assignmentCollectionId: v === "__none" || v === "__embedded" ? "" : v, ...(v === "__embedded" ? {} : { assignments: [] }) })}>
                <SelectTrigger aria-label={t('event_template.collection')} className="w-72"><SelectValue placeholder={t('event_template.pick_collection')} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">{t('event_template.no_assignments')}</SelectItem>
                  {(value.assignments?.length ?? 0) > 0 && <SelectItem value="__embedded">{t('templates.embedded_assignments', { count: value.assignments!.length })}</SelectItem>}
                  {value.assignmentCollectionId && !assignmentCollections.some(c => c.id === value.assignmentCollectionId) && <SelectItem value={value.assignmentCollectionId} disabled>{t('templates.assignment_collection_unavailable')}</SelectItem>}
                  {assignmentCollections.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <p className="rounded-lg border border-dashed border-border bg-surface-2/40 px-3 py-2 text-sm text-muted-foreground">{t('event_template.no_collections')}</p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t('event_template.strategy')}</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              {STRATEGY_OPTIONS.map(opt => {
                const Icon = opt.icon
                const selected = value.assignmentStrategy === opt.id
                return (
                  <button
                    key={opt.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onChange({ ...value, assignmentStrategy: opt.id })}
                    className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${selected ? "border-accent bg-background ring-1 ring-accent" : "border-border bg-surface-2 hover:border-accent/40"}`}
                  >
                    <Icon className={`mt-0.5 size-4 shrink-0 ${selected ? "text-accent" : "text-muted-foreground"}`} />
                    <span>
                      <span className="block text-sm font-medium">{t(opt.labelKey)}</span>
                      <span className="block text-xs text-muted-foreground">{t(opt.hintKey)}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  )
}
