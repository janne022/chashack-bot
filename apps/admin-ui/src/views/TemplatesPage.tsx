import { useEffect, useState } from "react"
import { LayoutTemplate, BookCopy, Megaphone, Plus, Trash2, Pencil, Copy, ListChecks } from "lucide-react"
import { toast } from "sonner"
import { useAppContext } from "@/lib/app-context"
import { useT } from "@/lib/i18n"
import { api } from "@/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FormConfigEditor } from "@/components/FormConfigEditor"
import { EventTemplateEditor, type EventTemplateDraft } from "@/components/EventTemplateEditor"
import { AssignmentsEditor } from "@/components/AssignmentsEditor"
import { TagAutocompleteInput, TagAutocompleteTextarea } from "@/components/TagAutocomplete"
import type { Assignment, FormConfig } from "@/types"
import { dateTime } from "@/lib/format"
import { DEFAULT_FORM } from "@/lib/default-form"

export function TemplatesPage() {
  const { state, refresh } = useAppContext()
  const t = useT()
  const eventTemplates = (state.templates ?? []).filter(tpl => tpl.kind === "event")
  const formTemplates = (state.templates ?? []).filter(tpl => tpl.kind === "form")
  const announcementTemplates = (state.templates ?? []).filter(tpl => tpl.kind === "announcement")
  const assignmentCollections = (state.templates ?? []).filter(tpl => tpl.kind === "assignments")

  const [tab, setTab] = useState<"event" | "form" | "announcement" | "assignments">("event")
  const [editingFormId, setEditingFormId] = useState<string | null>(null)
  const [editingEventId, setEditingEventId] = useState<string | null>(null)
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<string | null>(null)
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null)
  const [creatingForm, setCreatingForm] = useState(false)
  const [creatingEvent, setCreatingEvent] = useState(false)
  const [creatingAnnouncement, setCreatingAnnouncement] = useState(false)
  const [creatingCollection, setCreatingCollection] = useState(false)

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
          <TabsTrigger value="announcement" className="gap-2"><Megaphone className="size-4" /> Announcements ({announcementTemplates.length})</TabsTrigger>
          <TabsTrigger value="assignments" className="gap-2"><ListChecks className="size-4" /> Assignment collections ({assignmentCollections.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="event" className="flex flex-col gap-4 mt-4">
          <div className="flex justify-end"><Button onClick={()=>setCreatingEvent(true)}><Plus className="size-4" /> New event template</Button></div>
          {eventTemplates.length===0 ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">{t("templates.no_event_templates")}</CardContent></Card> : (
            <div className="grid gap-3 md:grid-cols-2">
              {eventTemplates.map(tpl=>(
                <Card
                  key={tpl.id}
                  className="card-interactive cursor-pointer flex flex-col"
                  onClick={() => setEditingEventId(tpl.id)}
                >
                  <CardHeader className="pb-3">
                    <CardTitle className="truncate text-base">{tpl.name}</CardTitle>
                    <CardDescription className="flex items-center gap-2 font-mono text-xs"><span>{tpl.id}</span><span>·</span><span>{dateTime(tpl.createdAt)}</span></CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto flex gap-2">
                    <Button size="sm" variant="secondary" onClick={()=>setEditingEventId(tpl.id)}><Pencil className="size-3.5" /> Edit</Button>
                    <Button size="sm" variant="ghost" onClick={(e)=>{ e.stopPropagation(); void navigator.clipboard.writeText(tpl.id) }}><Copy className="size-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={async(e)=>{ e.stopPropagation(); try{ await api.deleteTemplate(tpl.id); toast.success(t("templates.deleted")); await refresh() } catch(e){ toast.error(e instanceof Error ? e.message : "Delete failed") } }}><Trash2 className="size-3.5" /></Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          {(creatingEvent || editingEventId) && (
            <EventTemplateDialog
              template={editingEventId ? eventTemplates.find(t=>t.id===editingEventId) ?? null : null}
              formTemplates={formTemplates}
              assignmentCollections={assignmentCollections.map(c => ({ id: c.id, name: c.name }))}
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
                <Card
                  key={tpl.id}
                  className="card-interactive cursor-pointer flex flex-col"
                  onClick={() => setEditingFormId(tpl.id)}
                >
                  <CardHeader className="pb-3">
                    <CardTitle className="truncate text-base">{tpl.name}</CardTitle>
                    <CardDescription className="flex items-center gap-2 font-mono text-xs"><span>{tpl.id}</span><span>·</span><span>{dateTime(tpl.createdAt)}</span></CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto flex gap-2">
                    <Button size="sm" variant="secondary" onClick={()=>setEditingFormId(tpl.id)}><Pencil className="size-3.5" /> Edit</Button>
                    <Button size="sm" variant="ghost" onClick={(e)=>{ e.stopPropagation(); void navigator.clipboard.writeText(tpl.id) }}><Copy className="size-3.5" /></Button>
                    <Button size="sm" variant="ghost" onClick={async(e)=>{ e.stopPropagation(); try{ await api.deleteTemplate(tpl.id); toast.success(t("templates.deleted")); await refresh() } catch(e){ toast.error(e instanceof Error ? e.message : "Delete failed") } }}><Trash2 className="size-3.5" /></Button>
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

        <TabsContent value="announcement" className="flex flex-col gap-4 mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Reusable Discord messages — type <code className="rounded bg-muted px-1 font-mono text-xs">{"{"}</code> in the message to see tag suggestions.</p>
            <Button onClick={()=>setCreatingAnnouncement(true)}><Plus className="size-4" /> New announcement</Button>
          </div>
          {announcementTemplates.length===0 ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No announcement templates yet — create one.</CardContent></Card> : (
            <div className="grid gap-3 md:grid-cols-2">
              {announcementTemplates.map(tpl=>{
                let parsed: { title?: string; message?: string; trigger?: string } = {}
                try { parsed = JSON.parse(tpl.json) as never } catch {}
                return (
                  <Card
                    key={tpl.id}
                    className="card-interactive cursor-pointer flex flex-col"
                    onClick={() => setEditingAnnouncementId(tpl.id)}
                  >
                    <CardHeader className="pb-2">
                      <CardTitle className="truncate text-base">{tpl.name}</CardTitle>
                      <CardDescription className="line-clamp-2 whitespace-pre-wrap break-words text-xs">{parsed.title ?? ""} — {(parsed.message ?? "").slice(0,120)}</CardDescription>
                      <span className="mt-1 w-fit rounded-full border px-2 py-0.5 text-[11px] font-medium">{parsed.trigger ?? "manual"}</span>
                    </CardHeader>
                    <CardContent className="mt-auto flex gap-2">
                      <Button size="sm" variant="secondary" onClick={()=>setEditingAnnouncementId(tpl.id)}><Pencil className="size-3.5" /> Edit</Button>
                      <Button size="sm" variant="ghost" onClick={(e)=>{ e.stopPropagation(); void navigator.clipboard.writeText(tpl.id) }}><Copy className="size-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={async(e)=>{ e.stopPropagation(); try{ await api.deleteTemplate(tpl.id); toast.success(t("templates.deleted")); await refresh() } catch(e){ toast.error(e instanceof Error ? e.message : "Delete failed") } }}><Trash2 className="size-3.5" /></Button>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
          {(creatingAnnouncement || editingAnnouncementId) && (
            <AnnouncementTemplateDialog
              template={editingAnnouncementId ? announcementTemplates.find(t=>t.id===editingAnnouncementId) ?? null : null}
              onClose={()=>{ setCreatingAnnouncement(false); setEditingAnnouncementId(null) }}
              onSaved={refresh}
            />
          )}
        </TabsContent>

        <TabsContent value="assignments" className="flex flex-col gap-4 mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Reusable pools of team assignments — name, instructions and an optional image each. Pick a collection when creating an event and choose how it’s dealt out.</p>
            <Button onClick={()=>setCreatingCollection(true)}><Plus className="size-4" /> New collection</Button>
          </div>
          {assignmentCollections.length===0 ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No collections yet — create one to use assignments at your events.</CardContent></Card> : (
            <div className="grid gap-3 md:grid-cols-2">
              {assignmentCollections.map(tpl=>{
                let parsed: { assignments?: { title: string; imageUrl?: string }[] } = {}
                try { parsed = JSON.parse(tpl.json) as never } catch {}
                const items = parsed.assignments ?? []
                return (
                  <Card
                    key={tpl.id}
                    className="card-interactive cursor-pointer flex flex-col"
                    onClick={() => setEditingCollectionId(tpl.id)}
                  >
                    <CardHeader className="pb-2">
                      <CardTitle className="truncate text-base">{tpl.name}</CardTitle>
                      <CardDescription className="flex items-center gap-2 font-mono text-xs"><span>{tpl.id}</span><span>·</span><span>{dateTime(tpl.createdAt)}</span></CardDescription>
                      <span className="mt-1 w-fit rounded-full border px-2 py-0.5 text-[11px] font-medium">{items.length} assignment{items.length===1?"":"s"}</span>
                    </CardHeader>
                    <CardContent className="mt-auto">
                      {items.length > 0 && (
                        <ul className="mb-3 flex flex-col gap-1.5">
                          {items.slice(0, 4).map((a, i) => (
                            <li key={i} className="flex items-center gap-2 text-sm">
                              {a.imageUrl && <img src={a.imageUrl} alt="" className="size-8 shrink-0 rounded border border-border object-cover" onError={(e)=>{ (e.target as HTMLImageElement).style.display='none' }} />}
                              <span className="truncate">{a.title}</span>
                            </li>
                          ))}
                          {items.length > 4 && <li className="text-xs text-muted-foreground">+ {items.length - 4} more</li>}
                        </ul>
                      )}
                      <div className="flex gap-2">
                        <Button size="sm" variant="secondary" onClick={()=>setEditingCollectionId(tpl.id)}><Pencil className="size-3.5" /> Edit</Button>
                        <Button size="sm" variant="ghost" onClick={(e)=>{ e.stopPropagation(); void navigator.clipboard.writeText(tpl.id) }}><Copy className="size-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={async(e)=>{ e.stopPropagation(); try{ await api.deleteTemplate(tpl.id); toast.success(t("templates.deleted")); await refresh() } catch(e){ toast.error(e instanceof Error ? e.message : "Delete failed") } }}><Trash2 className="size-3.5" /></Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}
          {(creatingCollection || editingCollectionId) && (
            <CollectionDialog
              template={editingCollectionId ? assignmentCollections.find(t=>t.id===editingCollectionId) ?? null : null}
              onClose={()=>{ setCreatingCollection(false); setEditingCollectionId(null) }}
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

function EventTemplateDialog({ template, formTemplates, assignmentCollections, onClose, onSaved }: { template: { id: string; name: string; json: string } | null; formTemplates: { id: string; name: string; json: string }[]; assignmentCollections: { id: string; name: string }[]; onClose: ()=>void; onSaved: ()=>Promise<void> }) {
  const t = useT()
  const [draft, setDraft] = useState<EventTemplateDraft>(()=>{
    if (template) {
      try {
        const p = JSON.parse(template.json) as Partial<EventTemplateDraft & { name: string }>
        return {
          name: template.name,
          description: (p as Record<string,string>).description ?? "",
          cleanupDelayHours: (p as Record<string,number>).cleanupDelayHours ?? 48,
          form: (p.form as FormConfig) ?? DEFAULT_FORM,
          schedule: (p.schedule as EventTemplateDraft["schedule"]) ?? [],
          assignmentCollectionId: (p.assignmentCollectionId as string) ?? "",
          assignmentStrategy: (p.assignmentStrategy as EventTemplateDraft["assignmentStrategy"]) ?? "random",
        }
      } catch {
        return { name: template.name, description: "", cleanupDelayHours: 48, form: DEFAULT_FORM, schedule: [], assignmentCollectionId: "", assignmentStrategy: "random" }
      }
    }
    return { name: "", description: "", cleanupDelayHours: 48, form: DEFAULT_FORM, schedule: [], assignmentCollectionId: "", assignmentStrategy: "random" }
  })
  const [busy, setBusy] = useState(false)
  const isEdit = template !== null

  async function save() {
    if (draft.name.trim().length < 2) { toast.error("Name must be at least 2 characters"); return }
    setBusy(true)
    try {
      const payload = { name: draft.name.trim(), description: draft.description, cleanupDelayHours: draft.cleanupDelayHours, form: draft.form, schedule: draft.schedule, assignmentCollectionId: draft.assignmentCollectionId || undefined, assignmentStrategy: draft.assignmentStrategy }
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
          <EventTemplateEditor value={draft} onChange={setDraft} formTemplates={formTemplates} assignmentCollections={assignmentCollections.map(c => ({ id: c.id, name: c.name }))} />
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-4 shrink-0 bg-card">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || draft.name.trim().length<2} onClick={()=>void save()}>{isEdit ? "Save changes" : "Create template"}</Button>
        </div>
      </Card>
    </div>
  )
}

function AnnouncementTemplateDialog({ template, onClose, onSaved }: { template: { id: string; name: string; json: string } | null; onClose: ()=>void; onSaved: ()=>Promise<void> }) {
  const t = useT()
  const [name, setName] = useState(template?.name ?? "")
  const [data, setData] = useState<{ title: string; message: string; trigger: "manual"|"on_activate"|"on_start"|"schedule"; channelId: string | null }>(()=>{
    if (template) { try { const p = JSON.parse(template.json) as { title?: string; message?: string; trigger?: string; channelId?: string | null }; return { title: p.title ?? "", message: p.message ?? "", trigger: (p.trigger as never) ?? "manual", channelId: p.channelId ?? null } } catch { return { title: "", message: "", trigger: "manual", channelId: null } } }
    return { title: "Heads up!", message: "Hey {everyone}, quick update for **{event}** — {panel}", trigger: "manual", channelId: null }
  })
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([])
  useEffect(()=>{ api.getGuildChannels().then(r=>setChannels(r.channels ?? [])).catch(()=>undefined) }, [])
  const [busy, setBusy] = useState(false)
  const isEdit = template !== null
  async function save() {
    if (name.trim().length < 2 || data.title.trim().length < 2 || data.message.trim().length < 2) { toast.error("Name, title and message required"); return }
    setBusy(true)
    try {
      const json = JSON.stringify({ title: data.title.trim(), message: data.message.trim(), trigger: data.trigger, channelId: data.channelId ?? null })
      if (isEdit) await api.updateTemplate(template.id, { name: name.trim(), json })
      else await api.createTemplateRaw(name.trim(), "announcement", json)
      toast.success(isEdit ? "Announcement updated" : t("templates.created", { name: name.trim() }))
      onClose(); await onSaved()
    } catch(e){ toast.error(e instanceof Error ? e.message : "Save failed") } finally{ setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <Card className="w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col animate-pop-in" onClick={e=>e.stopPropagation()}>
        <CardHeader className="shrink-0">
          <CardTitle>{isEdit ? "Edit announcement" : "New announcement template"}</CardTitle>
          <CardDescription>Reusable Discord message — type <code className="rounded bg-muted px-1 font-mono text-xs">{"{"}</code> in title or message for tag suggestions like {"{event}"} {"{everyone}"} {"{timer}"}.</CardDescription>
        </CardHeader>
        <div className="flex-1 overflow-y-auto px-6 pb-4 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Template name (for picker)</label>
            <Input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Dinner reminder" maxLength={80} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Trigger hint</label>
              <Select value={data.trigger} onValueChange={v=>setData({ ...data, trigger: v as never })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual only</SelectItem>
                  <SelectItem value="on_activate">On activate</SelectItem>
                  <SelectItem value="schedule">For each schedule item</SelectItem>
                  <SelectItem value="on_start">At event start</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">Channel</label>
              {channels.length > 0 ? (
                <Select value={data.channelId ?? "__none"} onValueChange={v=>setData({ ...data, channelId: v==="__none" ? null : v })}>
                  <SelectTrigger><SelectValue placeholder="Default announcement channel" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Default (announcement/panel)</SelectItem>
                    {channels.map(c=> <SelectItem key={c.id} value={c.id}>#{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={data.channelId ?? ""} onChange={e=>setData({ ...data, channelId: e.target.value.trim() || null })} placeholder="channel id (optional)" />
              )}
              <span className="text-[11px] text-muted-foreground">Where this announcement is sent by default. Actions can override per-block.</span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Title</label>
            <TagAutocompleteInput value={data.title} onChange={v=>setData({ ...data, title: v })} placeholder="e.g. {schedule_title} — update" maxLength={100} />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Message</label>
            <TagAutocompleteTextarea value={data.message} onChange={v=>setData({ ...data, message: v })} placeholder="⏰ {schedule_title} — {schedule_desc} {everyone}" maxLength={2000} />
            <span className="text-[11px] text-muted-foreground">Tip: type <code className="rounded bg-muted px-1 font-mono text-[11px]">{"{"}</code> to autocomplete — e.g. <code className="font-mono">{"{eve"}</code> → <code className="font-mono">{"{event}"}</code> · <code className="font-mono">{"{timer"}</code> etc.</span>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-4 shrink-0 bg-card">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || name.trim().length<2 || data.title.trim().length<2} onClick={()=>void save()}>{isEdit ? "Save changes" : "Create"}</Button>
        </div>
      </Card>
    </div>
  )
}

/**
 * Editor for an assignment collection (template kind `assignments`). The
 * collection is a named pool of assignments; each assignment carries title,
 * instructions, optional description and an optional image URL.
 */
function CollectionDialog({ template, onClose, onSaved }: { template: { id: string; name: string; json: string } | null; onClose: ()=>void; onSaved: ()=>Promise<void> }) {
  const t = useT()
  const [name, setName] = useState(template?.name ?? "")
  const [assignments, setAssignments] = useState<Assignment[]>(()=>{
    if (template) {
      try { const p = JSON.parse(template.json) as { assignments?: Assignment[] }; return Array.isArray(p.assignments) ? p.assignments : [] } catch { return [] }
    }
    return []
  })
  const [busy, setBusy] = useState(false)
  const isEdit = template !== null

  async function save() {
    if (name.trim().length < 2) { toast.error("Name must be at least 2 characters"); return }
    setBusy(true)
    try {
      const json = JSON.stringify({ assignments })
      if (isEdit) await api.updateTemplate(template.id, { name: name.trim(), json })
      else await api.createTemplateRaw(name.trim(), "assignments", json)
      toast.success(isEdit ? "Collection updated" : t("templates.created", { name: name.trim() }))
      onClose(); await onSaved()
    } catch(e){ toast.error(e instanceof Error ? e.message : "Save failed") }
    finally{ setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={onClose}>
      <Card className="w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col animate-pop-in" onClick={e=>e.stopPropagation()}>
        <CardHeader className="shrink-0">
          <CardTitle>{isEdit ? "Edit assignment collection" : "New assignment collection"}</CardTitle>
          <CardDescription>A reusable pool of assignments. Each has a title, instructions and an optional image — the image is attached when the assignment is dealt to a team channel.</CardDescription>
        </CardHeader>
        <div className="flex-1 overflow-y-auto px-6 pb-4">
          <div className="flex flex-col gap-2 py-4">
            <label className="text-sm font-medium">Collection name</label>
            <Input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Hackathon challenges" maxLength={80} />
          </div>
          <AssignmentsEditor value={assignments} onChange={setAssignments} />
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-4 shrink-0 bg-card">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || name.trim().length<2} onClick={()=>void save()}>{isEdit ? "Save changes" : "Create collection"}</Button>
        </div>
      </Card>
    </div>
  )
}
