import { useEffect, useState } from "react"
import { LayoutTemplate, BookCopy, Megaphone, Plus, Trash2, Pencil, Copy, ListChecks, Palette } from "lucide-react"
import { toast } from "sonner"
import { useAppContext } from "@/lib/app-context"
import { useT } from "@/lib/i18n"
import { api } from "@/api"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { OtterIllustration } from "@/components/OtterIllustration"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { FormConfigEditor } from "@/components/FormConfigEditor"
import { AppearanceControls } from "@/components/appearance-controls"
import { EventTemplateEditor, type EventTemplateDraft } from "@/components/EventTemplateEditor"
import { AssignmentsEditor } from "@/components/AssignmentsEditor"
import { TagAutocompleteInput, TagAutocompleteTextarea } from "@/components/TagAutocomplete"
import { TagHelpButton } from "@/components/TagHelp"
import type { Assignment, FormConfig, FormAppearance } from "@/types"
import { dateTime } from "@/lib/format"
import { DEFAULT_FORM } from "@/lib/default-form"
import { validateQuestions } from "@/lib/question-validation"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"

export function TemplatesPage() {
  const { state, refresh } = useAppContext()
  const t = useT()
  const eventTemplates = (state.templates ?? []).filter(tpl => tpl.kind === "event")
  const formTemplates = (state.templates ?? []).filter(tpl => tpl.kind === "form")
  const announcementTemplates = (state.templates ?? []).filter(tpl => tpl.kind === "announcement")
  const assignmentCollections = (state.templates ?? []).filter(tpl => tpl.kind === "assignments")
  const themes = (state.templates ?? []).filter(tpl => tpl.kind === "theme")

  const [tab, setTab] = useState<"event" | "form" | "announcement" | "assignments" | "theme">("event")
  const [editingFormId, setEditingFormId] = useState<string | null>(null)
  const [editingEventId, setEditingEventId] = useState<string | null>(null)
  const [editingAnnouncementId, setEditingAnnouncementId] = useState<string | null>(null)
  const [editingCollectionId, setEditingCollectionId] = useState<string | null>(null)
  const [creatingForm, setCreatingForm] = useState(false)
  const [creatingEvent, setCreatingEvent] = useState(false)
  const [creatingAnnouncement, setCreatingAnnouncement] = useState(false)
  const [creatingCollection, setCreatingCollection] = useState(false)
  const [editingThemeId, setEditingThemeId] = useState<string | null>(null)
  const [creatingTheme, setCreatingTheme] = useState(false)
  const [deletingTemplate, setDeletingTemplate] = useState<{ id: string; name: string } | null>(null)
  const [deletingThemeId, setDeletingThemeId] = useState<string | null>(null)

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl">{t("templates.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("templates.subtitle")}</p>
        </div>
      </header>

      <AlertDialog open={!!deletingTemplate} onOpenChange={open => { if (!open) setDeletingTemplate(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('templates.delete_title', { name: deletingTemplate?.name ?? '' })}</AlertDialogTitle><AlertDialogDescription>{t('templates.delete_desc')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel><AlertDialogAction onClick={async () => { const item = deletingTemplate; setDeletingTemplate(null); if (!item) return; try { await api.deleteTemplate(item.id); await refresh() } catch (error) { toast.error(error instanceof Error ? error.message : t('common.load_failed')) } }}>{t('common.delete')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      <Tabs value={tab} onValueChange={v=>setTab(v as never)} className="w-full">
        <TabsList className="w-full max-w-full justify-start overflow-x-auto">
          <TabsTrigger value="event" className="gap-2"><LayoutTemplate className="size-4" /> {t("templates.library_events")} ({eventTemplates.length})</TabsTrigger>
          <TabsTrigger value="form" className="gap-2"><BookCopy className="size-4" /> {t("templates.library_forms")} ({formTemplates.length})</TabsTrigger>
          <TabsTrigger value="announcement" className="gap-2"><Megaphone className="size-4" /> {t("templates.library_announcements")} ({announcementTemplates.length})</TabsTrigger>
          <TabsTrigger value="assignments" className="gap-2"><ListChecks className="size-4" /> {t("templates.library_assignments")} ({assignmentCollections.length})</TabsTrigger>
          <TabsTrigger value="theme" className="gap-2"><Palette className="size-4" /> {t("templates.library_themes")} ({themes.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="event" className="flex flex-col gap-4 mt-4">
          <div className="flex justify-end"><Button onClick={()=>setCreatingEvent(true)}><Plus className="size-4" /> {t("templates.new_event")}</Button></div>
          {eventTemplates.length===0 ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground"><OtterIllustration panel="A2" className="mb-2" />{t("templates.no_event_templates")}</CardContent></Card> : (
            <div className="grid gap-3 md:grid-cols-2">
              {eventTemplates.map(tpl=>(
                <Card
                  key={tpl.id}
                  className="card-interactive cursor-pointer flex flex-col"
                  tabIndex={0}
                  onClick={e => { e.currentTarget.focus(); setEditingEventId(tpl.id) }}
                  onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setEditingEventId(tpl.id) } }}
                >
                  <CardHeader className="pb-3">
                    <CardTitle className="truncate text-base">{tpl.name}</CardTitle>
                    <CardDescription className="flex items-center gap-2 text-xs"><span>{dateTime(tpl.createdAt)}</span></CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto flex gap-2">
                    <Button size="sm" variant="secondary" onClick={()=>setEditingEventId(tpl.id)}><Pencil className="size-3.5" /> {t("common.edit")}</Button>
                    <Button size="sm" variant="ghost" aria-label={t("templates.copy_reference")} onClick={(e)=>{ e.stopPropagation(); void navigator.clipboard.writeText(tpl.id) }}><Copy className="size-3.5" /></Button>
                    <Button size="sm" variant="ghost" aria-label={t("common.delete") + ": " + tpl.name} onClick={e=>{ e.stopPropagation(); setDeletingTemplate({id:tpl.id,name:tpl.name}) }}><Trash2 className="size-3.5" /></Button>
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
            <Button onClick={()=>setCreatingForm(true)}><Plus className="size-4" /> {t("templates.new_form")}</Button>
          </div>
          {formTemplates.length===0 ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground"><OtterIllustration panel="B2" className="mb-2" />{t("templates.no_form_templates")}</CardContent></Card> : (
            <div className="grid gap-3 md:grid-cols-2">
              {formTemplates.map(tpl=>(
                <Card
                  key={tpl.id}
                  className="card-interactive cursor-pointer flex flex-col"
                  tabIndex={0}
                  onClick={e => { e.currentTarget.focus(); setEditingFormId(tpl.id) }}
                  onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setEditingFormId(tpl.id) } }}
                >
                  <CardHeader className="pb-3">
                    <CardTitle className="truncate text-base">{tpl.name}</CardTitle>
                    <CardDescription className="flex items-center gap-2 text-xs"><span>{dateTime(tpl.createdAt)}</span></CardDescription>
                  </CardHeader>
                  <CardContent className="mt-auto flex gap-2">
                    <Button size="sm" variant="secondary" onClick={()=>setEditingFormId(tpl.id)}><Pencil className="size-3.5" /> {t("common.edit")}</Button>
                    <Button size="sm" variant="ghost" aria-label={t("templates.copy_reference")} onClick={(e)=>{ e.stopPropagation(); void navigator.clipboard.writeText(tpl.id) }}><Copy className="size-3.5" /></Button>
                    <Button size="sm" variant="ghost" aria-label={t("common.delete") + ": " + tpl.name} onClick={e=>{ e.stopPropagation(); setDeletingTemplate({id:tpl.id,name:tpl.name}) }}><Trash2 className="size-3.5" /></Button>
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
            <p className="text-sm text-muted-foreground">{t('templates.message_list_help')}</p>
            <Button onClick={()=>setCreatingAnnouncement(true)}><Plus className="size-4" /> {t('templates.new_announcement')}</Button>
          </div>
          {announcementTemplates.length===0 ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground"><OtterIllustration panel="C1" className="mb-2" />{t('templates.message_empty')}</CardContent></Card> : (
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
                      <span className="mt-1 w-fit rounded-full border px-2 py-0.5 text-[11px] font-medium">{t(({ manual: 'templates.trigger_manual', on_activate: 'templates.trigger_activate', on_start: 'templates.trigger_start', schedule: 'templates.trigger_schedule', teams_locked: 'templates.trigger_locked', teams_assigned: 'templates.trigger_assigned' } as Record<string, string>)[parsed.trigger ?? 'manual'] ?? 'templates.trigger_manual')}</span>
                    </CardHeader>
                    <CardContent className="mt-auto flex gap-2">
                      <Button size="sm" variant="secondary" onClick={()=>setEditingAnnouncementId(tpl.id)}><Pencil className="size-3.5" /> {t("common.edit")}</Button>
                      <Button size="sm" variant="ghost" aria-label={t("templates.copy_reference")} onClick={(e)=>{ e.stopPropagation(); void navigator.clipboard.writeText(tpl.id) }}><Copy className="size-3.5" /></Button>
                      <Button size="sm" variant="ghost" aria-label={t("common.delete") + ": " + tpl.name} onClick={e=>{ e.stopPropagation(); setDeletingTemplate({id:tpl.id,name:tpl.name}) }}><Trash2 className="size-3.5" /></Button>
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
            <Button onClick={()=>setCreatingCollection(true)}><Plus className="size-4" /> {t("templates.new_collection")}</Button>
          </div>
          {assignmentCollections.length===0 ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground"><OtterIllustration panel="C2" className="mb-2" />No collections yet — create one to use assignments at your events.</CardContent></Card> : (
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
                      <CardDescription className="flex items-center gap-2 text-xs"><span>{dateTime(tpl.createdAt)}</span></CardDescription>
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
                        <Button size="sm" variant="secondary" onClick={()=>setEditingCollectionId(tpl.id)}><Pencil className="size-3.5" /> {t("common.edit")}</Button>
                        <Button size="sm" variant="ghost" aria-label={t("templates.copy_reference")} onClick={(e)=>{ e.stopPropagation(); void navigator.clipboard.writeText(tpl.id) }}><Copy className="size-3.5" /></Button>
                        <Button size="sm" variant="ghost" aria-label={t("common.delete") + ": " + tpl.name} onClick={e=>{ e.stopPropagation(); setDeletingTemplate({id:tpl.id,name:tpl.name}) }}><Trash2 className="size-3.5" /></Button>
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
        <TabsContent value="theme" className="flex flex-col gap-4 mt-4">
          <div className="flex justify-end"><Button onClick={()=>setCreatingTheme(true)}><Plus className="size-4" /> {t('templates.new_theme')}</Button></div>
          {themes.length===0 ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">{t('templates.no_themes')}</CardContent></Card> : <div className="grid gap-3 md:grid-cols-2">{themes.map(theme=><Card key={theme.id}><CardHeader><CardTitle>{theme.name === 'Default' ? t('form.default_theme') : theme.name === 'Halloween' ? t('form.halloween') : theme.name === 'Christmas' ? t('form.christmas') : theme.name}</CardTitle><CardDescription>{t('templates.theme_desc')}</CardDescription></CardHeader><CardContent className="flex gap-2"><Button size="sm" variant="secondary" onClick={()=>setEditingThemeId(theme.id)}><Pencil className="size-3.5" /> {t('templates.edit_theme')}</Button><Button size="sm" variant="ghost" onClick={()=>setDeletingThemeId(theme.id)}><Trash2 className="size-3.5" /> {t('templates.theme_delete')}</Button></CardContent></Card>)}</div>}
          {(creatingTheme||editingThemeId)&&<ThemeDialog template={editingThemeId?themes.find(x=>x.id===editingThemeId)??null:null} onClose={()=>{setCreatingTheme(false);setEditingThemeId(null)}} onSaved={refresh}/>}
          <AlertDialog open={!!deletingThemeId} onOpenChange={open=>{if(!open)setDeletingThemeId(null)}}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('templates.theme_delete_title',{name:themes.find(x=>x.id===deletingThemeId)?.name??''})}</AlertDialogTitle><AlertDialogDescription>{t('templates.theme_delete_desc')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel><AlertDialogAction onClick={async()=>{const id=deletingThemeId;if(!id)return;setDeletingThemeId(null);try{await api.deleteTemplate(id);await refresh()}catch(e){toast.error(e instanceof Error?e.message:'Delete failed')}}}>{t('templates.theme_delete')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ThemeDialog({ template, onClose, onSaved }: { template: { id: string; name: string; json: string } | null; onClose: ()=>void; onSaved: ()=>Promise<void> }) {
  const t=useT()
  const [name, setName] = useState(template?.name ?? '')
  const [appearance, setAppearance] = useState<FormAppearance>(() => {
    try { const saved = JSON.parse(template?.json ?? '{}') as Partial<FormAppearance>; return { themePreset: saved.themePreset ?? 'default', accentColor: saved.accentColor ?? '#55bbda', bannerUrl: saved.bannerUrl ?? null, ...saved } } catch { return { themePreset: 'default', accentColor: '#55bbda', bannerUrl: null } }
  })
  const [busy, setBusy] = useState(false)
  async function save() {
    if (name.trim().length < 2) { toast.error(t('templates.theme_name_required')); return }
    if (appearance.bannerUrl && !/^https:\/\//i.test(appearance.bannerUrl)) { toast.error(t('templates.theme_invalid_url')); return }
    setBusy(true)
    try {
      const json = JSON.stringify(appearance)
      if (template) await api.updateTemplate(template.id, {name: name.trim(), json})
      else await api.createTemplateRaw(name.trim(), 'theme', json)
      await onSaved(); toast.success(t('templates.theme_saved')); onClose()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Save failed') }
    finally { setBusy(false) }
  }
  return <Dialog open onOpenChange={open=>{if(!open&&!busy)onClose()}}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
    <DialogTitle>{template ? t('templates.edit_theme') : t('templates.new_theme')}</DialogTitle>
    <DialogDescription>{t('templates.theme_desc')}</DialogDescription>
    <label className="text-sm">{t('templates.theme_name')}<Input value={name} maxLength={80} onChange={e=>setName(e.target.value)} /></label>
    <AppearanceControls value={appearance} onChange={setAppearance} previewTitle={name} />
    <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button><Button disabled={busy} onClick={()=>void save()}>{t('templates.theme_save')}</Button></div>
  </DialogContent></Dialog>
}

function FormTemplateDialog({ template, onClose, onSaved }: { template: { id: string; name: string; json: string } | null; onClose: ()=>void; onSaved: ()=>Promise<void> }) {
  const t = useT()
  const [returnFocus] = useState(() => document.activeElement as HTMLElement | null)
  const [name, setName] = useState(template?.name ?? "")
  const [config, setConfig] = useState<FormConfig>(()=>{
    if (template) { try { return JSON.parse(template.json) as FormConfig } catch { return DEFAULT_FORM } }
    return DEFAULT_FORM
  })
  const [busy, setBusy] = useState(false)
  const isEdit = template !== null

  async function save() {
    if (name.trim().length < 2) { toast.error("Name must be at least 2 characters"); return }
    if (!validateQuestions(config)) return
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
    <Dialog open onOpenChange={next => { if (!next && !busy) onClose() }}>
      <DialogContent aria-modal="true" showCloseButton={false} className="sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onCloseAutoFocus={e => { e.preventDefault(); returnFocus?.focus() }}>
        <CardHeader className="shrink-0">
          <DialogTitle>{isEdit ? "Edit form template" : "New form template"}</DialogTitle>
          <DialogDescription>Design the signup modal — title, roles, skills, team preferences. This becomes reusable.</DialogDescription>
        </CardHeader>
        <div className="flex-1 overflow-y-auto px-6 pb-4 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="form-template-name" className="text-sm font-medium">Template name</label>
            <Input id="form-template-name" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Standard hackathon form" maxLength={80} />
          </div>
          <FormConfigEditor value={config} onChange={setConfig} />
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-4 shrink-0 bg-card">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || name.trim().length<2} onClick={()=>void save()}>{isEdit ? "Save changes" : "Create template"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EventTemplateDialog({ template, formTemplates, assignmentCollections, onClose, onSaved }: { template: { id: string; name: string; json: string } | null; formTemplates: { id: string; name: string; json: string }[]; assignmentCollections: { id: string; name: string }[]; onClose: ()=>void; onSaved: ()=>Promise<void> }) {
  const t = useT()
  const [returnFocus] = useState(() => document.activeElement as HTMLElement | null)
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
          assignments: Array.isArray(p.assignments) ? p.assignments : [],
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
    if (!validateQuestions(draft.form)) return
    setBusy(true)
    try {
      const payload = { name: draft.name.trim(), description: draft.description, cleanupDelayHours: draft.cleanupDelayHours, form: draft.form, schedule: draft.schedule, ...(draft.assignments?.length ? { assignments: draft.assignments } : {}), assignmentCollectionId: draft.assignmentCollectionId || undefined, assignmentStrategy: draft.assignmentStrategy }
      const json = JSON.stringify(payload)
      if (isEdit) await api.updateTemplate(template.id, { name: draft.name.trim(), json })
      else await api.createTemplateRaw(draft.name.trim(), "event", json)
      toast.success(isEdit ? "Event template updated" : t("templates.created", { name: draft.name.trim() }))
      onClose(); await onSaved()
    } catch(e){ toast.error(e instanceof Error ? e.message : "Save failed") }
    finally{ setBusy(false) }
  }

  return (
    <Dialog open onOpenChange={next => { if (!next && !busy) onClose() }}>
      <DialogContent aria-modal="true" showCloseButton={false} className="sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col" onCloseAutoFocus={e => { e.preventDefault(); returnFocus?.focus() }}>
        <CardHeader className="shrink-0">
          <DialogTitle>{isEdit ? "Edit event template" : "New event template"}</DialogTitle>
          <DialogDescription>Reusable event — name, schedule, cleanup and embedded signup form.</DialogDescription>
        </CardHeader>
        <div className="flex-1 overflow-y-auto px-6 pb-4">
          <EventTemplateEditor value={draft} onChange={setDraft} formTemplates={formTemplates} assignmentCollections={assignmentCollections.map(c => ({ id: c.id, name: c.name }))} />
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-4 shrink-0 bg-card">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || draft.name.trim().length<2} onClick={()=>void save()}>{isEdit ? "Save changes" : "Create template"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function AnnouncementTemplateDialog({ template, onClose, onSaved }: { template: { id: string; name: string; json: string } | null; onClose: ()=>void; onSaved: ()=>Promise<void> }) {
  const t = useT()
  const [name, setName] = useState(template?.name ?? "")
  const [data, setData] = useState<{ title: string; message: string; trigger: "manual"|"on_activate"|"on_start"|"schedule"|"teams_locked"|"teams_assigned"; channelId: string | null }>(()=>{
    if (template) { try { const p = JSON.parse(template.json) as { title?: string; message?: string; trigger?: string; channelId?: string | null }; return { title: p.title ?? "", message: p.message ?? "", trigger: (p.trigger as never) ?? "manual", channelId: p.channelId ?? null } } catch { return { title: "", message: "", trigger: "manual", channelId: null } } }
    return { title: t('templates.message_default_title'), message: t('templates.message_default_body'), trigger: "manual", channelId: null }
  })
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([])
  const [channelsFailed, setChannelsFailed] = useState(false)
  useEffect(()=>{ api.getGuildChannels().then(r=>setChannels(r.channels ?? [])).catch(()=>setChannelsFailed(true)) }, [])
  const [busy, setBusy] = useState(false)
  const isEdit = template !== null
  async function save() {
    if (name.trim().length < 2 || data.title.trim().length < 2 || data.message.trim().length < 2) { toast.error(t('templates.message_validation')); return }
    setBusy(true)
    try {
      const json = JSON.stringify({ title: data.title.trim(), message: data.message.trim(), trigger: data.trigger, channelId: data.channelId ?? null })
      if (isEdit) await api.updateTemplate(template.id, { name: name.trim(), json })
      else await api.createTemplateRaw(name.trim(), "announcement", json)
      toast.success(isEdit ? t('templates.message_updated') : t("templates.created", { name: name.trim() }))
      onClose(); await onSaved()
    } catch(e){ toast.error(e instanceof Error ? e.message : t('templates.message_save_failed')) } finally{ setBusy(false) }
  }
  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="space-y-2 pr-8">
          <DialogTitle>{t(isEdit ? "templates.edit_message" : "templates.new_message")}</DialogTitle>
          <DialogDescription>{t("templates.message_help")}</DialogDescription>
        </div>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label htmlFor="message-template-name" className="text-sm font-medium">{t("templates.name")}</label>
            <Input id="message-template-name" value={name} onChange={e=>setName(e.target.value)} placeholder={t('templates.message_name_placeholder')} maxLength={80} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">{t('templates.suggested_use')}</label>
              <Select value={data.trigger} onValueChange={v=>setData({ ...data, trigger: v as never })}>
                <SelectTrigger aria-label={t('templates.suggested_use')}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">{t('templates.trigger_manual')}</SelectItem>
                  <SelectItem value="on_activate">{t('templates.trigger_activate')}</SelectItem>
                  <SelectItem value="schedule">{t('templates.trigger_schedule')}</SelectItem>
                  <SelectItem value="on_start">{t('templates.trigger_start')}</SelectItem>
                  <SelectItem value="teams_locked">{t('templates.trigger_locked')}</SelectItem>
                  <SelectItem value="teams_assigned">{t('templates.trigger_assigned')}</SelectItem>
                </SelectContent>
              </Select>
              <span className="text-[11px] text-muted-foreground">{t('templates.suggested_help')}</span>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">{t("templates.channel")}</label>
              {channels.length > 0 ? (
                <Select value={data.channelId ?? "__none"} onValueChange={v=>setData({ ...data, channelId: v==="__none" ? null : v })}>
                  <SelectTrigger aria-label={t("templates.channel")}><SelectValue placeholder={t("templates.channel")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">{t('events.channel_default_announcement')}</SelectItem>
                    {channels.map(c=> <SelectItem key={c.id} value={c.id}>#{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input aria-label={t("templates.channel")} value={data.channelId ?? ""} onChange={e=>setData({ ...data, channelId: e.target.value.trim() || null })} placeholder={t('templates.channel_id_placeholder')} />
              )}
              <span className="text-[11px] text-muted-foreground">{t(channelsFailed ? 'templates.channel_fallback' : 'templates.channel_help')}</span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">{t("templates.message_title")}</label>
            <TagAutocompleteInput value={data.title} onChange={v=>setData({ ...data, title: v })} placeholder={t('templates.message_title_placeholder')} maxLength={100} />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">{t("templates.message_body")}</label>
            <TagAutocompleteTextarea value={data.message} onChange={v=>setData({ ...data, message: v })} placeholder="⏰ {schedule_title} — {schedule_desc} {everyone}" maxLength={2000} />
            <div className="flex flex-wrap items-center justify-between gap-1 text-[11px] text-muted-foreground">
              <span>{t('tags.type_hint')}</span><TagHelpButton />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border p-4 shrink-0 bg-card">
          <Button variant="outline" onClick={onClose}>{t("common.cancel")}</Button>
          <Button disabled={busy || name.trim().length<2 || data.title.trim().length<2 || data.message.trim().length<2} onClick={()=>void save()}>{t("common.save")}</Button>
        </div>
      </DialogContent>
    </Dialog>
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
