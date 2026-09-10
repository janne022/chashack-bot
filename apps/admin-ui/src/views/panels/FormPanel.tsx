import { useEffect, useState } from 'react'
import { RotateCcw, Save, BookCopy } from 'lucide-react'
import { toast } from 'sonner'
import type { AppState, FormConfig } from '@/types'
import { api } from '@/api'
import { useT } from '@/lib/i18n'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label, Textarea } from '@/components/ui/textarea-label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

import { useAppContext } from '@/lib/app-context'

export function FormPanel({ state, refresh, hideTemplates }: { state: AppState; refresh: () => Promise<void>; hideTemplates?: boolean }) {
  const t = useT()
  const [draft, setDraft] = useState<FormConfig>(state.config)
  const [dirty, setDirty] = useState(false)

  // Re-sync draft when the saved config changes underneath us.
  useEffect(() => {
    if (!dirty) setDraft(state.config)
  }, [state.config, dirty])

  function edit<K extends keyof FormConfig>(key: K, value: FormConfig[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
    setDirty(true)
  }

  async function save() {
    try {
      await api.updateForm(draft)
      setDirty(false)
      toast.success(t('form.updated'))
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('form.save_failed'))
    }
  }

  async function resetDefaults() {
    try {
      await api.resetForm()
      setDirty(false)
      toast.success(t('form.reset_done'))
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('form.reset_failed'))
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('form.title')}</CardTitle>
          <CardDescription>
            {t('form.desc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-6 sm:grid-cols-[1fr_12rem]">
            <div className="flex flex-col gap-2">
              <Label htmlFor="form-title">{t('form.form_title')}</Label>
              <Input
                id="form-title"
                value={draft.title}
                maxLength={45}
                onChange={(e) => edit('title', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="form-size">{t('form.team_size')}</Label>
              <Input
                id="form-size"
                type="number"
                min={2}
                max={25}
                value={draft.teamSize}
                onChange={(e) => edit('teamSize', Number(e.target.value))}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="form-desc">{t('form.description')}</Label>
            <Textarea
              id="form-desc"
              value={draft.description}
              maxLength={300}
              onChange={(e) => edit('description', e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <OptionListEditor
        title={t('form.role_tracks')}
        hint={t('form.role_tracks_hint')}
        items={draft.roleTracks}
        onChange={(items) => edit('roleTracks', items)}
      />
      <OptionListEditor
        title={t('form.skills')}
        hint={t('form.skills_hint')}
        items={draft.skills.map((s) => ({ id: s.id, label: s.label, group: s.group }))}
        onChange={(items) =>
          edit(
            'skills',
            items.map((s) => ({ id: s.id, label: s.label, group: s.group ?? '' })),
          )
        }
        grouped
      />

      {!hideTemplates && <FormTemplatesSection draft={draft} setDraft={setDraft} setDirty={setDirty} refresh={refresh} />}

      <div className="flex items-center justify-between gap-3">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="outline">
              <RotateCcw />
              {t('form.reset')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('form.reset_title')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('form.reset_desc')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction onClick={() => void resetDefaults()}>{t('form.reset_action')}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      {!hideTemplates && <SaveFormTemplateDialog config={draft} />}

        <Button onClick={() => void save()} disabled={!dirty}>
          <Save />
          {dirty ? t('form.save_changes') : t('form.saved')}
        </Button>
      </div>
    </div>
  )
}

interface OptionItem {
  id: string
  label: string
  group?: string
}

function OptionListEditor({
  title,
  hint,
  items,
  onChange,
  grouped = false,
}: {
  title: string
  hint: string
  items: OptionItem[]
  onChange: (items: OptionItem[]) => void
  grouped?: boolean
}) {
  const t = useT()
  const [newLabel, setNewLabel] = useState('')
  const [newGroup, setNewGroup] = useState('')

  function add() {
    const label = newLabel.trim()
    if (label === '') return
    onChange([
      ...items,
      {
        id: label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `opt_${items.length + 1}`,
        label,
        ...(grouped && newGroup.trim() !== '' ? { group: newGroup.trim().toLowerCase() } : {}),
      },
    ])
    setNewLabel('')
    setNewGroup('')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{hint}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-wrap gap-2.5">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded-full border border-border bg-surface-2 py-1.5 pr-2 pl-3.5 text-sm"
            >
              <span>{item.label}</span>
              {'group' in item && item.group !== undefined && item.group !== '' && (
                <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase text-accent">
                  {item.group}
                </span>
              )}
              <button
                onClick={() => onChange(items.filter((i) => i.id !== item.id))}
                aria-label={t('form.remove_aria', { label: item.label })}
                className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Input
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder={t('form.new_option')}
            className="w-52"
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          />
          {grouped && (
            <Input
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              placeholder={t('form.group_optional')}
              className="w-40"
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
            />
          )}
          <Button variant="secondary" onClick={add} disabled={newLabel.trim() === ''}>
            {t('form.add')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function SaveFormTemplateDialog({ config }: { config: FormConfig }) {
  const t = useT()
  const { refresh } = useAppContext()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    const clean = name.trim()
    if (clean.length < 2) return
    setBusy(true)
    try {
      await api.saveTemplate('', clean, 'form', JSON.stringify(config))
      toast.success(t('form.template_saved', { name: clean }))
      setOpen(false)
      setName('')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('form.template_save_failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <BookCopy />
        {t('form.save_template')}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <Card className="w-full max-w-md animate-pop-in" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle>{t('form.save_template_title')}</CardTitle>
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
                  {t('form.save_template_action')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </>
  )
}

function FormTemplatesSection({
  draft,
  setDraft,
  setDirty,
  refresh,
}: {
  draft: FormConfig
  setDraft: React.Dispatch<React.SetStateAction<FormConfig>>
  setDirty: (v: boolean) => void
  refresh: () => Promise<void>
}) {
  const t = useT()
  const { state } = useAppContext()
  const formTemplates = (state.templates ?? []).filter((tpl) => tpl.kind === 'form')
  void draft

  async function applyTemplate(tpl: { id: string; name: string; json: string }) {
    try {
      const parsed = JSON.parse(tpl.json) as Partial<FormConfig>
      setDraft(parsed as FormConfig)
      setDirty(true)
      toast.success(t('form.template_applied', { name: tpl.name }))
    } catch {
      toast.error(t('form.template_apply_failed'))
    }
  }

  async function deleteTpl(id: string) {
    try {
      await api.deleteTemplate(id)
      toast.success(t('form.template_deleted'))
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('form.template_delete_failed'))
    }
  }

  if (formTemplates.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('form.templates')}</CardTitle>
        <CardDescription>{t('form.templates_desc')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {formTemplates.map((tpl) => (
          <div key={tpl.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2/40 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{tpl.name}</div>
              <div className="truncate font-mono text-xs text-muted-foreground">{tpl.id}</div>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button size="sm" variant="secondary" onClick={() => void applyTemplate(tpl)}>
                {t('form.apply_template')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void deleteTpl(tpl.id)}>
                {t('form.delete_template')}
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
