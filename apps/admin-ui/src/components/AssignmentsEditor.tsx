import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea-label'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import type { Assignment } from '@/types'
import { Plus, Trash2, Edit2, Save, X } from 'lucide-react'
import { toast } from 'sonner'

function newId(prefix='assign') { return `${prefix}_${Math.random().toString(36).slice(2,8)}_${Date.now().toString(36)}` }

export function AssignmentsEditor({ value, onChange }: { value: Assignment[]; onChange: (v: Assignment[])=>void }) {
  const [draft, setDraft] = useState<Assignment>({ id: newId(), title: '', instructions: '', description: '' })
  const [editing, setEditing] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<Assignment | null>(null)

  function add() {
    if (!draft.title.trim() || !draft.instructions.trim()) { toast.error('Title and instructions required'); return }
    onChange([...value, { ...draft, id: newId(), title: draft.title.trim(), instructions: draft.instructions.trim(), description: draft.description?.trim() || undefined }])
    setDraft({ id: newId(), title: '', instructions: '', description: '' })
  }
  function remove(id: string) { onChange(value.filter(v=>v.id!==id)) }
  function startEdit(a: Assignment) { setEditing(a.id); setEditDraft({ ...a }) }
  function saveEdit() {
    if (!editDraft || !editDraft.title.trim() || !editDraft.instructions.trim()) { toast.error('Title and instructions required'); return }
    onChange(value.map(v=> v.id===editDraft.id ? { ...editDraft, title: editDraft.title.trim(), instructions: editDraft.instructions.trim(), description: editDraft.description?.trim() || undefined } : v))
    setEditing(null); setEditDraft(null)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Assignments</CardTitle>
        <CardDescription>Add instructions to a list — e.g. “Here is your assignment Team {'{team}'}: build …”. A schedule zap (“Distribute assignments”) will then deal one per team (random/shuffled) or the same one to all teams.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {value.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">No assignments yet — add one below. You can keep the same brief for every team or let the zap randomly deal distinct ones.</div>
        ) : (
          <ul className="flex flex-col gap-2">
            {value.map(a=>(
              <li key={a.id} className="rounded-lg border border-border bg-surface-2/40 p-3">
                {editing===a.id && editDraft ? (
                  <div className="flex flex-col gap-2">
                    <Label className="text-xs">Title</Label><Input value={editDraft.title} onChange={e=>setEditDraft({ ...editDraft, title: e.target.value })} placeholder="e.g. Build a Discord bot" />
                    <Label className="text-xs">Instructions</Label><Textarea value={editDraft.instructions} onChange={e=>setEditDraft({ ...editDraft, instructions: e.target.value })} rows={3} placeholder="Here is your assignment {team}: … — will be sent to the team's channel" />
                    <Label className="text-xs">Description (optional)</Label><Input value={editDraft.description ?? ''} onChange={e=>setEditDraft({ ...editDraft, description: e.target.value })} placeholder="Short hint" />
                    <div className="flex gap-2"><Button size="sm" onClick={saveEdit}><Save className="size-3" />Save</Button><Button size="sm" variant="secondary" onClick={()=>{ setEditing(null); setEditDraft(null) }}><X className="size-3" />Cancel</Button></div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap"><span className="font-semibold text-sm">{a.title}</span><Badge variant="secondary" className="font-mono text-[10px]">{a.id.slice(0,12)}</Badge></div>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{a.instructions}</p>
                      {a.description && <p className="mt-1 text-xs text-muted-foreground">{a.description}</p>}
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="icon" onClick={()=>startEdit(a)} title="Edit"><Edit2 className="size-4" /></Button>
                      <Button variant="ghost" size="icon" onClick={()=>remove(a.id)} title="Remove"><Trash2 className="size-4" /></Button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="rounded-lg border border-border bg-background p-3 flex flex-col gap-2">
          <Label className="text-xs font-semibold">Add assignment</Label>
          <Input value={draft.title} onChange={e=>setDraft({ ...draft, title: e.target.value })} placeholder="Title — e.g. Mystery box" />
          <Textarea value={draft.instructions} onChange={(e: any)=>setDraft({ ...draft, instructions: e.target.value })} rows={3} placeholder="Instructions — e.g. Here is your assignment {team}: build a bot that greets newcomers. Use {everyone} if you want to ping." />
          <Input value={draft.description ?? ''} onChange={(e: any)=>setDraft({ ...draft, description: e.target.value })} placeholder="Description (optional)" />
          <Button onClick={add} disabled={!draft.title.trim() || !draft.instructions.trim()}><Plus className="size-4" />Add to list</Button>
          <p className="text-xs text-muted-foreground">Tags like {"{team}"}, {"{event}"}, {"{everyone}"} work in instructions — they’re rendered per-team when distributed.</p>
        </div>
      </CardContent>
    </Card>
  )
}
