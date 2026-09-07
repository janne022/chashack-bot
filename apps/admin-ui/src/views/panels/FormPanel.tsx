import { useEffect, useState } from 'react'
import { RotateCcw, Save } from 'lucide-react'
import { toast } from 'sonner'
import type { AppState, FormConfig } from '@/types'
import { api } from '@/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Label, Textarea } from '@/components/ui/input'
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
      toast.success('Form updated — the Discord modal now uses it')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    }
  }

  async function resetDefaults() {
    try {
      await api.resetForm()
      setDirty(false)
      toast.success('Form reset to defaults')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reset failed')
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Signup form</CardTitle>
          <CardDescription>
            Controls the /hackathon join modal: title, intro text, team size and the option lists.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="form-title">Title (Discord modal, max 45 chars)</Label>
              <Input
                id="form-title"
                value={draft.title}
                maxLength={45}
                onChange={(e) => edit('title', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="form-size">Team size</Label>
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
            <Label htmlFor="form-desc">Description (shown before signup)</Label>
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
        title="Role tracks"
        hint="The main role a person signs up for. IDs: frontend, backend, fullstack, design, devops, flex."
        items={draft.roleTracks}
        onChange={(items) => edit('roleTracks', items)}
      />
      <OptionListEditor
        title="Skills"
        hint="Skills within the same group are mutually exclusive (e.g. backend languages). Empty group = freely combinable."
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
              Reset to defaults
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Reset form to defaults?</AlertDialogTitle>
              <AlertDialogDescription>
                Your custom title, team size and option lists are replaced with the built-in defaults.
                Existing signups are kept but may reference removed options.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => void resetDefaults()}>Reset form</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Button onClick={() => void save()} disabled={!dirty}>
          <Save />
          {dirty ? 'Save changes' : 'Saved'}
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
        <ul className="flex flex-wrap gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-sm"
            >
              <span>{item.label}</span>
              {'group' in item && item.group !== undefined && item.group !== '' && (
                <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] uppercase text-accent">
                  {item.group}
                </span>
              )}
              <button
                onClick={() => onChange(items.filter((i) => i.id !== item.id))}
                aria-label={`Remove ${item.label}`}
                className="text-muted-foreground hover:text-danger"
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
            placeholder="New option label"
            className="w-52"
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
          />
          {grouped && (
            <Input
              value={newGroup}
              onChange={(e) => setNewGroup(e.target.value)}
              placeholder="Group (optional)"
              className="w-40"
              onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())}
            />
          )}
          <Button variant="secondary" onClick={add} disabled={newLabel.trim() === ''}>
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
