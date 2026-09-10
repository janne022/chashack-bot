import { useState } from "react"
import { LayoutTemplate, BookCopy, Plus, Trash2, Pencil, Copy } from "lucide-react"
import { toast } from "sonner"
import { useAppContext } from "@/lib/app-context"
import { useT } from "@/lib/i18n"
import { api } from "@/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FormConfigEditor } from "@/components/FormConfigEditor"
import { EventTemplateEditor, type EventTemplateDraft } from "@/components/EventTemplateEditor"
import type { FormConfig } from "@/types"
import { dateTime } from "@/lib/format"
import { DEFAULT_FORM } from "@/lib/default-form"

export function TemplatesPage() {
  const { state, refresh } = useAppContext()
  const t = useT()
  const eventTemplates = (state.templates ?? []).filter(tpl => tpl.kind === "event")
  const formTemplates = (state.templates ?? []).filter(tpl => tpl.kind === "form")

  const [tab, setTab] = useState<"event" | "form">("event")
  const [editingFormId, setEditingFormId] = useState<string | null>(null)
  const [editingEventId, setEditingEventId] = useState<string | null>(null)
  const [creatingForm, setCreatingForm] = useState(false)
  const [creatingEvent, setCreatingEvent] = useState(false)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">{t("templates.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("templates.subtitle")}</p>
        </div>
      </header>

      <Tabs value={tab} onValueChange={v=>setTab(v as never)} className="w-full">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="event" className="gap-2"><LayoutTemplate className="size-4" /> Event templates ({eventTemplates.length})</TabsTrigger>
          <TabsTrigger value="form" className="gap-2"><BookCopy className="size-4" /> Form templates ({formTemplates.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="event" className="flex flex-col gap-4 mt-4">
          <div className="flex justify-end"><Button onClick={()=>setCreatingEvent(true)}><Plus className="size-4" /> New event template</Button></div>
          {eventTemplates.length===0 ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">{t("templates.no_event_templates")}</CardContent></Card> : (
            <div className="grid gap-3 md:grid-cols-2">
              {eventTemplates.map(tpl=>(
                <Card key={tpl.id} className="flex flex-col">
                  <CardHeader className="pb-3">
                    <CardTitle className="truncate text-base">{tpl.name}</CardTitle>
                    <CardDescription className="flex items-center gap-2 font-mono text-xs"><span>{tpl.id}</span><span>·</span><span>{dateTime(tpl.createdAt)}</span></CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto flex gap-2">
                    <Button size="sm" variant="secondary" onClick={()=>setEditingEventId(tpl.id)}><Pencil className="size-3.5" /> Edit</Button>
                    <Button size="sm" variant="ghost" onClick={()=>void navigator.clipboard.writeText(tpl.id)}><Copy className="size-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={async()=>{ try{ await api.deleteTemplate(tpl.id); toast.success(t("templates.deleted")); await refresh() } catch(e){ toast.error(e instanceof Error ? e.message : "Delete failed") } }}><Trash2 className="size-3.5" /></Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {(creatingEvent || editingEventId) && (
            <EventTemplateDialog
              template={editingEventId ? eventTemplates.find(t=>t.id===editingEventId) ?? null : null}
              formTemplates={formTemplates}
              onClose={()=>{ setCreatingEvent(false); setEditingEventId(null) }}
              onSaved={refresh}
            />
          )}
        </TabsContent>

        <TabsContent value="form" className="flex flex-col gap-4 mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Forms define the /hackathon join modal. Set the default in <span className="font-medium text-foreground">Config → Default form</span>.</p>
            <Button onClick={()=>setCreatingForm(true)}><Plus className="size-4" /> New form template</Button>
          </div>
          {formTemplates.length===0 ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">{t("templates.no_form_templates")}</CardContent></Card> : (
            <div className="grid gap-3 md:grid-cols-2">
              {formTemplates.map(tpl=>(
                <Card key={tpl.id} className="flex flex-col">
                  <CardHeader className="pb-3">
                    <CardTitle className="truncate text-base">{tpl.name}</CardTitle>
                    <CardDescription className="flex items-center gap-2 font-mono text-xs"><span>{tpl.id}</span><span>·</span><span>{dateTime(tpl.createdAt)}</span></CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto flex gap-2">
                    <Button size="sm" variant="secondary" onClick={()=>setEditingFormId(tpl.id)}><Pencil className="size-3.5" /> Edit</Button>
                    <Button size="sm" variant="ghost" onClick={()=>void navigator.clipboard.writeText(tpl.id)}><Copy className="size-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={async()=>{ try{ await api.deleteTemplate(tpl.id); toast.success(t("templates.deleted")); await refresh() } catch(e){ toast.error(e instanceof Error ? e.message : "Delete failed") } }}><Trash2 className="size-3.5" /></Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {(creatingForm || editingFormId) && (
            <FormTemplateDialog
              template={editingFormId ? formTemplates.find(t=>t.id===editingFormId) ?? null : null}
              onClose={()=>{ setCreatingForm(false); setEditingFormId(null) }}
              onSaved={refresh}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function FormTemplateDialog({ template, onClose, onSaved }: { template: { id: string; name: string; json: string } | null; onClose: ()=>void; onSaved: ()=>Promise<void> }) {
  const t = useT()
  const [name, setName] = useState(template?.name ?? "")
  const [config, setConfig] = useState<FormConfig>(()=>{
    if (template) { try { return JSON.parse(template.json) as FormConfig } catch { return DEFAULT_FORM } }
    return DEFAULT_FORM
  })
  const [busy, setBusy] = useState(false)
  const isEdit = template !== null

  async function save() {
    if (name.trim().length < 2) { toast.error("Name must be at least 2 characters"); return }
    setBusy(true)
    try {
      const json = JSON.stringify(config)
      if (isEdit) await api.updateTemplate(template.id, { name: name.trim(), json })
      else await api.createTemplateRaw(name.trim(), "form", json)
      toast.success(isEdit ? "Form template updated" : t("templates.created", { name: name.trim() }))
      onClose(); await onSaved()
    } catch (e) { toast.error(e instanceof Error ? e.message : "Save failed") }
    finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <Card className="w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col animate-pop-in" onClick={e=>e.stopPropagation()}>
        <CardHeader className="shrink-0">
          <CardTitle>{isEdit ? "Edit form template" : "New form template"}</CardTitle>
          <CardDescription>Design the signup modal — title, roles, skills, team preferences. This becomes reusable.</CardDescription>
        </CardHeader>
        <div className="flex-1 overflow-y-auto px-6 pb-4 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Template name</label>
            <Input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Standard hackathon form" maxLength={80} />
          </div>
          <FormConfigEditor value={config} onChange={setConfig} />
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-4 shrink-0 bg-card">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || name.trim().length<2} onClick={()=>void save()}>{isEdit ? "Save changes" : "Create template"}</Button>
        </div>
      </Card>
    </div>
  )
}

function EventTemplateDialog({ template, formTemplates, onClose, onSaved }: { template: { id: string; name: string; json: string } | null; formTemplates: { id: string; name: string; json: string }[]; onClose: ()=>void; onSaved: ()=>Promise<void> }) {
  const t = useT()
  const [draft, setDraft] = useState<EventTemplateDraft>(()=>{
    if (template) {
      try {
        const p = JSON.parse(template.json) as Partial<EventTemplateDraft & { name: string } & { announcements?: import("@/types").AnnouncementTemplate[] }>
        return { name: template.name, description: (p as Record<string,string>).description ?? "", cleanupDelayHours: (p as Record<string,number>).cleanupDelayHours ?? 48, form: (p.form as FormConfig) ?? DEFAULT_FORM, schedule: (p.schedule as EventTemplateDraft["schedule"]) ?? [], announcements: (p.announcements as EventTemplateDraft["announcements"]) ?? [{ id: "ann1", title: `${template.name} — signups open!`, message: "Listen up {everyone} **{event}** is live! Sign up in {panel} — starts {timer}", trigger: "on_activate" as const }, { id: "ann2", title: "{schedule_title}", message: "⏰ **{schedule_title}** — {schedule_desc} {timer_schedule} {everyone}", trigger: "schedule" as const }] }
      } catch { return { name: template.name, description: "", cleanupDelayHours: 48, form: DEFAULT_FORM, schedule: [], announcements: [] } }
    }
    return { name: "", description: "", cleanupDelayHours: 48, form: DEFAULT_FORM, schedule: [], announcements: [{ id: "ann1", title: "Signups open!", message: "Listen up {everyone} **{event}** is live! Sign up in {panel} — starts {timer}", trigger: "on_activate" as const }, { id: "ann2", title: "{schedule_title}", message: "⏰ **{schedule_title}** — {schedule_desc} {timer_schedule} {everyone}", trigger: "schedule" as const }] }
  })
  const [busy, setBusy] = useState(false)
  const isEdit = template !== null

  async function save() {
    if (draft.name.trim().length < 2) { toast.error("Name must be at least 2 characters"); return }
    setBusy(true)
    try {
      const payload = { name: draft.name.trim(), description: draft.description, cleanupDelayHours: draft.cleanupDelayHours, form: draft.form, schedule: draft.schedule, announcements: draft.announcements }
      const json = JSON.stringify(payload)
      if (isEdit) await api.updateTemplate(template.id, { name: draft.name.trim(), json })
      else await api.createTemplateRaw(draft.name.trim(), "event", json)
      toast.success(isEdit ? "Event template updated" : t("templates.created", { name: draft.name.trim() }))
      onClose(); await onSaved()
    } catch(e){ toast.error(e instanceof Error ? e.message : "Save failed") }
    finally{ setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <Card className="w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col animate-pop-in" onClick={e=>e.stopPropagation()}>
        <CardHeader className="shrink-0">
          <CardTitle>{isEdit ? "Edit event template" : "New event template"}</CardTitle>
          <CardDescription>Reusable event — name, schedule, cleanup and embedded signup form.</CardDescription>
        </CardHeader>
        <div className="flex-1 overflow-y-auto px-6 pb-4">
          <EventTemplateEditor value={draft} onChange={setDraft} formTemplates={formTemplates} />
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-4 shrink-0 bg-card">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || draft.name.trim().length<2} onClick={()=>void save()}>{isEdit ? "Save changes" : "Create template"}</Button>
        </div>
      </Card>
    </div>
  )
}
