import { useEffect, useState } from 'react'
import { RotateCcw, Save } from 'lucide-react'
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

export function FormPanel({ state, refresh }: { state: AppState; refresh: () => Promise<void> }) {
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
