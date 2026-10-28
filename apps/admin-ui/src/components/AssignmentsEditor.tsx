import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TagAutocompleteTextarea } from '@/components/TagAutocomplete'
import { useT } from '@/lib/i18n'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import type { Assignment } from '@/types'
import { Plus, Trash2, Edit2, Save, X } from 'lucide-react'
import { toast } from 'sonner'

function newId(prefix='assign') { return `${prefix}_${Math.random().toString(36).slice(2,8)}_${Date.now().toString(36)}` }

export function AssignmentsEditor({ value, onChange, onPendingChange }: { value: Assignment[]; onChange: (v: Assignment[])=>void; onPendingChange?: (pending: boolean) => void }) {
  const t = useT()
  const [draft, setDraft] = useState<Assignment>({ id: newId(), title: '', instructions: '', description: '', imageUrl: '' })
  const [editing, setEditing] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Assignment | null>(null)
  const pendingDraft = !!(draft.title.trim() || draft.instructions.trim() || draft.description?.trim() || draft.imageUrl?.trim())
  useEffect(() => { onPendingChange?.(pendingDraft || editing !== null) }, [onPendingChange, pendingDraft, editing])

  function add() {
    if (!draft.title.trim() || !draft.instructions.trim()) { toast.error(t('assignments.required')); return }
    onChange([...value, { ...draft, id: newId(), title: draft.title.trim(), instructions: draft.instructions.trim(), description: draft.description?.trim() || undefined, imageUrl: draft.imageUrl?.trim() || undefined }])
    setDraft({ id: newId(), title: '', instructions: '', description: '', imageUrl: '' })
  }
  function remove(id: string) { onChange(value.filter(v=>v.id!==id)) }
  function startEdit(a: Assignment) { setEditing(a.id); setEditDraft({ ...a }) }
  function saveEdit() {
    if (!editDraft || !editDraft.title.trim() || !editDraft.instructions.trim()) { toast.error(t('assignments.required')); return }
    onChange(value.map(v=> v.id===editDraft.id ? { ...editDraft, title: editDraft.title.trim(), instructions: editDraft.instructions.trim(), description: editDraft.description?.trim() || undefined, imageUrl: editDraft.imageUrl?.trim() || undefined } : v))
    setEditing(null); setEditDraft(null)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('assignments.title')}</CardTitle>
        <CardDescription>{t('assignments.description')}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {value.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">{t('assignments.empty')}</div>
        ) : (
          <ul className="flex flex-col gap-2">
            {value.map(a=>(
              <li key={a.id} className="rounded-lg border border-border bg-surface-2/40 p-3">
                {editing===a.id && editDraft ? (
                  <div className="flex flex-col gap-2">
                    <Label className="text-xs">{t('assignments.name')}</Label><Input aria-label={t('assignments.name')} value={editDraft.title} onChange={e=>setEditDraft({ ...editDraft, title: e.target.value })} placeholder={t('assignments.title_placeholder')} />
                    <Label className="text-xs">{t('assignments.instructions')}</Label><TagAutocompleteTextarea assignment value={editDraft.instructions} onChange={v=>setEditDraft({ ...editDraft, instructions: v })} rows={3} placeholder={t('assignments.instructions_placeholder')} />
                    <Label className="text-xs">{t('assignments.optional_description')}</Label><Input aria-label={t('assignments.optional_description')} value={editDraft.description ?? ''} onChange={e=>setEditDraft({ ...editDraft, description: e.target.value })} placeholder={t('assignments.short_hint')} />
                    <Label className="text-xs">{t('assignments.optional_image')}</Label>
                    <div className="flex items-start gap-2">
                      <Input aria-label={t('assignments.optional_image')} value={editDraft.imageUrl ?? ''} onChange={e=>setEditDraft({ ...editDraft, imageUrl: e.target.value })} placeholder={t('assignments.image_hint')} className="font-mono text-xs" />
                      {editDraft.imageUrl && /^https?:\/\//.test(editDraft.imageUrl) && (
                        <img src={editDraft.imageUrl} alt="" className="size-14 shrink-0 rounded-md border border-border object-cover" onError={(e)=>{ (e.target as HTMLImageElement).style.display='none' }} />
                      )}
                    </div>
                    <div className="flex gap-2"><Button size="sm" onClick={saveEdit}><Save className="size-3" />{t('common.save')}</Button><Button size="sm" variant="secondary" onClick={()=>{ setEditing(null); setEditDraft(null) }}><X className="size-3" />{t('common.cancel')}</Button></div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-sm">{a.title}</span><Badge variant="secondary" className="font-mono text-[10px]">{a.id.slice(0,12)}</Badge></div>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{a.instructions}</p>
                      {a.description && <p className="mt-1 text-xs text-muted-foreground">{a.description}</p>}
                      {a.imageUrl && (
                        <img src={a.imageUrl} alt="" className="mt-2 max-h-32 rounded-lg border border-border object-cover" onError={(e)=>{ (e.target as HTMLImageElement).style.display='none' }} />
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="icon" disabled={editing !== null} onClick={()=>startEdit(a)} aria-label={t('assignments.edit', { name: a.title })}><Edit2 className="size-4" /></Button>
                      <Button variant="ghost" size="icon" disabled={editing !== null} onClick={()=>remove(a.id)} aria-label={t('assignments.remove', { name: a.title })}><Trash2 className="size-4" /></Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="rounded-lg border border-border bg-background p-3 flex flex-col gap-2">
          <Label className="text-xs font-semibold">{t('assignments.add')}</Label>
          <Input aria-label={t('assignments.name')} value={draft.title} onChange={e=>setDraft({ ...draft, title: e.target.value })} placeholder={t('assignments.title_placeholder')} />
          <TagAutocompleteTextarea assignment value={draft.instructions} onChange={v=>setDraft({ ...draft, instructions: v })} rows={3} placeholder={t('assignments.instructions_placeholder')} />
          <Input aria-label={t('assignments.optional_description')} value={draft.description ?? ''} onChange={e=>setDraft({ ...draft, description: e.target.value })} placeholder={t('assignments.optional_description')} />
          <div className="flex items-start gap-2">
            <Input aria-label={t('assignments.optional_image')} value={draft.imageUrl ?? ''} onChange={e=>setDraft({ ...draft, imageUrl: e.target.value })} placeholder={t('assignments.image_hint')} className="font-mono text-xs" />
            {draft.imageUrl && /^https?:\/\//.test(draft.imageUrl) && (
              <img src={draft.imageUrl} alt="" className="size-14 shrink-0 rounded-md border border-border object-cover" onError={(e)=>{ (e.target as HTMLImageElement).style.display='none' }} />
            )}
          </div>
          <Button onClick={add} disabled={!draft.title.trim() || !draft.instructions.trim()}><Plus className="size-4" />{t('assignments.add_to_list')}</Button>
          {pendingDraft && <Button variant="ghost" onClick={() => setDraft({ id: newId(), title: '', instructions: '', description: '', imageUrl: '' })}>{t('assignments.clear_draft')}</Button>}
          <p className="text-xs text-muted-foreground">{t('assignments.tags_hint')}</p>
        </div>
      </CardContent>
    </Card>
  )
}
