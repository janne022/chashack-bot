"use client"
import { useState } from "react"
import { Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import type { FormConfig } from "@/types"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label, Textarea } from "@/components/ui/textarea-label"
import { useT } from "@/lib/i18n"

export function FormConfigEditor({
  value,
  onChange,
}: {
  value: FormConfig
  onChange: (next: FormConfig) => void
}) {
  const t = useT()
  function edit<K extends keyof FormConfig>(key: K, v: FormConfig[K]) {
    onChange({ ...value, [key]: v })
  }
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("form.form_title")}</CardTitle>
          <CardDescription>{t("form.desc")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-6 sm:grid-cols-[1fr_12rem]">
            <div className="flex flex-col gap-2">
              <Label htmlFor="f-title">Title (Discord modal, max 45)</Label>
              <Input id="f-title" value={value.title} maxLength={45} onChange={(e) => edit("title", e.target.value)} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="f-size">Team size</Label>
              <Input id="f-size" type="number" min={2} max={25} value={value.teamSize} onChange={(e) => edit("teamSize", Number(e.target.value))} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="f-desc">Description (shown before signup)</Label>
            <Textarea id="f-desc" value={value.description} maxLength={300} onChange={(e) => edit("description", e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <OptionListEditor title="Experiences" hint="e.g. First hackathon, 1–3, Veteran. ID auto-generated." items={value.experiences.map(e => ({ id: e.id, label: e.label }))} onChange={(items) => edit("experiences", items.map(i => ({ id: i.id as FormConfig["experiences"][number]["id"], label: i.label })))} />
      <OptionListEditor title="Role tracks" hint="Main role a person signs up for." items={value.roleTracks} onChange={(items) => edit("roleTracks", items)} />
      <OptionListEditor title="Team preferences" hint="How participant wants to find a team." items={value.teamPrefs.map(p => ({ id: p.id, label: p.label }))} onChange={(items) => edit("teamPrefs", items.map(i => ({ id: i.id as FormConfig["teamPrefs"][number]["id"], label: i.label })))} />
      <OptionListEditor
        title="Skills"
        hint="Skills within same group are mutually exclusive (e.g. backend languages). Empty group = combinable."
        items={value.skills.map(s => ({ id: s.id, label: s.label, group: s.group }))}
        onChange={(items) => edit("skills", items.map(s => ({ id: s.id, label: s.label, group: s.group ?? "" })))}
        grouped
      />
    </div>
  )
}

interface Opt { id: string; label: string; group?: string }

function OptionListEditor({ title, hint, items, onChange, grouped=false }: { title: string; hint: string; items: Opt[]; onChange: (items: Opt[])=>void; grouped?: boolean }) {
  const t = useT()
  const [newLabel, setNewLabel] = useState("")
  const [newGroup, setNewGroup] = useState("")
  function add() {
    const label = newLabel.trim()
    if (!label) return
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `opt_${items.length+1}`
    if (items.some(i=>i.id===id)) { toast.error(`ID "${id}" already exists`); return }
    onChange([...items, { id, label, ...(grouped && newGroup.trim() ? { group: newGroup.trim().toLowerCase() } : {}) }])
    setNewLabel(""); setNewGroup("")
  }
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle><CardDescription>{hint}</CardDescription></CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-wrap gap-2.5">
          {items.map(item => (
            <li key={item.id} className="flex items-center gap-2 rounded-full border border-border bg-surface-2 py-1.5 pr-2 pl-3.5 text-sm">
              <span>{item.label}</span>
              {item.group !== undefined && item.group !== "" && <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent">{item.group}</span>}
              <button onClick={() => onChange(items.filter(i=>i.id!==item.id))} aria-label={t("form.remove_aria", { label: item.label })} className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"><Trash2 className="size-3" /></button>
            </li>
          ))}
          {items.length===0 && <span className="text-sm text-muted-foreground">No options yet.</span>}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Input value={newLabel} onChange={e=>setNewLabel(e.target.value)} placeholder="New option label" className="w-52" onKeyDown={e=>e.key==="Enter"&&(e.preventDefault(),add())} />
          {grouped && <Input value={newGroup} onChange={e=>setNewGroup(e.target.value)} placeholder="Group (optional)" className="w-40" onKeyDown={e=>e.key==="Enter"&&(e.preventDefault(),add())} />}
          <Button variant="secondary" onClick={add} disabled={newLabel.trim()===""}><Plus className="size-4" />Add</Button>
        </div>
      </CardContent>
    </Card>
  )
}
