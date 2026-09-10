import { useState } from 'react'
import { LayoutTemplate, Plus, Trash2, Copy, BookCopy } from 'lucide-react'
import { toast } from 'sonner'
import { useAppContext } from '@/lib/app-context'
import { useT } from '@/lib/i18n'
import { api } from '@/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { FormPanel } from '@/views/panels/FormPanel'
import { dateTime } from '@/lib/format'

export function TemplatesPage() {
  const { state, refresh } = useAppContext()
  const t = useT()
  const eventTemplates = (state.templates ?? []).filter((tpl) => tpl.kind === 'event')
  const formTemplates = (state.templates ?? []).filter((tpl) => tpl.kind === 'form')

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl">{t('templates.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('templates.subtitle')}</p>
      </header>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LayoutTemplate className="size-4 text-accent" />
              {t('templates.event_templates')}
            </CardTitle>
            <CardDescription>{t('templates.event_templates_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <CreateEventTemplateDialog />
            {eventTemplates.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('templates.no_event_templates')}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {eventTemplates.map((tpl) => (
                  <div key={tpl.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/40 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{tpl.name}</div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{tpl.id}</span>
                        <span>·</span>
                        <span>{dateTime(tpl.createdAt)}</span>
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard.writeText(tpl.id)}>
                        <Copy />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={async () => {
                        try { await api.deleteTemplate(tpl.id); toast.success(t('templates.deleted')); await refresh() } catch (e) { toast.error(e instanceof Error ? e.message : t('common.action_failed')) }
                      }}>
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BookCopy className="size-4 text-accent" />
              {t('templates.form_templates')}
            </CardTitle>
            <CardDescription>{t('templates.form_templates_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <CreateFormTemplateDialog />
            {formTemplates.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('templates.no_form_templates')}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {formTemplates.map((tpl) => (
                  <div key={tpl.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/40 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{tpl.name}</div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span className="font-mono">{tpl.id}</span>
                        <span>·</span>
                        <span>{dateTime(tpl.createdAt)}</span>
                      </div>
                    </div>
                    <div className="flex gap-1.5">
                      <Button size="sm" variant="secondary" onClick={async () => {
                        try {
                          const parsed = JSON.parse(tpl.json) as Record<string, unknown>
                          await api.updateForm(parsed)
                          toast.success(t('templates.form_applied', { name: tpl.name }))
                          await refresh()
                        } catch (e) { toast.error(e instanceof Error ? e.message : t('form.template_apply_failed')) }
                      }}>
                        {t('templates.apply_to_global')}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={async () => {
                        try { await api.deleteTemplate(tpl.id); toast.success(t('templates.deleted')); await refresh() } catch (e) { toast.error(e instanceof Error ? e.message : t('common.action_failed')) }
                      }}>
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-display text-sm uppercase tracking-wide text-muted-foreground">{t('templates.global_form')}</h2>
        <FormPanel state={state} refresh={refresh} hideTemplates />
      </section>
    </div>
  )
}

function CreateEventTemplateDialog() {
  const { state, refresh } = useAppContext()
  const t = useT()
  const [open, setOpen] = useState(false)
  const [eventId, setEventId] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const events = state.events ?? []
  const effectiveName = name.trim() || events.find(e => e.id === eventId)?.name || ''

  async function save() {
    if (eventId === '' || effectiveName.length < 2) return
    setBusy(true)
    try {
      await api.saveTemplate(eventId, effectiveName, 'event')
      toast.success(t('templates.created', { name: effectiveName }))
      setOpen(false)
      setName('')
      setEventId('')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('templates.create_failed'))
    } finally { setBusy(false) }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus />
        {t('templates.new_event_template')}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <Card className="w-full max-w-md animate-pop-in" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle>{t('templates.new_event_template')}</CardTitle>
              <CardDescription>{t('templates.new_event_template_desc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('templates.source_event')}</span>
                <Select value={eventId} onValueChange={setEventId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('templates.pick_event')} />
                  </SelectTrigger>
                  <SelectContent>
                    {events.map(e => <SelectItem key={e.id} value={e.id}>{e.name} · {e.status}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('form.template_name')}</span>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={events.find(e => e.id === eventId)?.name ?? t('form.template_name_placeholder')} maxLength={80} />
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
                <Button disabled={busy || eventId === '' || effectiveName.length < 2} onClick={() => void save()}>
                  {t('common.create')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}

function CreateFormTemplateDialog() {
  const { state, refresh } = useAppContext()
  const t = useT()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    const clean = name.trim()
    if (clean.length < 2) return
    setBusy(true)
    try {
      await api.saveTemplate('', clean, 'form', JSON.stringify(state.config))
      toast.success(t('form.template_saved', { name: clean }))
      setOpen(false)
      setName('')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('form.template_save_failed'))
    } finally { setBusy(false) }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus />
        {t('templates.new_form_template')}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <Card className="w-full max-w-md animate-pop-in" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle>{t('templates.new_form_template')}</CardTitle>
              <CardDescription>{t('form.save_template_desc')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">{t('form.template_name')}</span>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('form.template_name_placeholder')} maxLength={80} />
              </label>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
                <Button disabled={busy || name.trim().length < 2} onClick={() => void save()}>
                  {t('common.create')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}
