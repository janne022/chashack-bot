"use client"
import { useState } from "react"
import { Plus, Trash2, Lightbulb, Shuffle, Users, Crown, GraduationCap, HelpCircle, Layers } from "lucide-react"
import { toast } from "sonner"
import type { FormConfig } from "@/types"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label, Textarea } from "@/components/ui/textarea-label"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

function Help({ children }: { children: React.ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-accent-soft hover:text-accent"><HelpCircle className="size-3.5" /></button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-sm leading-relaxed" align="start">{children}</PopoverContent>
    </Popover>
  )
}

export function FormConfigEditor({
  value,
  onChange,
}: {
  value: FormConfig
  onChange: (next: FormConfig) => void
}) {
  function edit<K extends keyof FormConfig>(key: K, v: FormConfig[K]) {
    onChange({ ...value, [key]: v })
  }
  return (
    <div className="flex flex-col gap-5">
      {/* ── How matching works ── */}
      <Card className="border-accent/30 bg-accent-soft/40">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Lightbulb className="size-4 text-accent" /> How team matching uses this form</CardTitle>
          <CardDescription>When you hit <b>Preview / Commit</b> in Operations, the bot scores every pair 0–100 and greedily builds teams. Base 50, then:</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div className="flex gap-2.5 rounded-lg border border-border bg-background p-3">
              <Layers className="size-4 shrink-0 text-accent mt-0.5" />
              <div><div className="font-semibold">Skills + groups</div><div className="text-muted-foreground leading-snug">Shared skills +8 each (max +24). Different skill groups +4 each (max +12). So one frontend + one backend beats two backends.</div></div>
            </div>
            <div className="flex gap-2.5 rounded-lg border border-border bg-background p-3">
              <Shuffle className="size-4 shrink-0 text-accent mt-0.5" />
              <div><div className="font-semibold">Role tracks</div><div className="text-muted-foreground leading-snug">Same track +5. Complementary pairs (frontend↔backend, frontend↔design, backend↔design, devops↔frontend/backend, fullstack↔design/devops) +9. Custom roles get no bonus.</div></div>
            </div>
            <div className="flex gap-2.5 rounded-lg border border-border bg-background p-3">
              <GraduationCap className="size-4 shrink-0 text-accent mt-0.5" />
              <div><div className="font-semibold">Experience mix</div><div className="text-muted-foreground leading-snug">Adjacent levels (first-timer + some_experience) +6, same level +3, veteran + first-timer +0. Encourages mentorship without punishing.</div></div>
            </div>
            <div className="flex gap-2.5 rounded-lg border border-border bg-background p-3">
              <Users className="size-4 shrink-0 text-accent mt-0.5" />
              <div><div className="font-semibold">Friends (teammates field)</div><div className="text-muted-foreground leading-snug">Mutual mentions = <b>hard</b> must-be-together (unless group &gt; team size → reported as conflict). One-way mention +25.</div></div>
            </div>
          </div>
          <div className="mt-3 rounded-md bg-background px-3 py-2 text-xs text-muted-foreground">
            Example: A <b>frontend/react</b> veteran + <b>backend/node</b> some_experience = 50 + 8 (if share builds?) + 4 (different groups) + 9 (complementary roles) + 6 (adjacent experience) = <b>~77/100</b>. Two backend/node veterans on same track = 50 + 8 + 0 + 5 + 3 = 66.
          </div>
        </CardContent>
      </Card>

      {/* ── Basics ── */}
      <Card>
        <CardHeader>
          <CardTitle>Basics</CardTitle>
          <CardDescription>Shown in Discord before anyone taps <b>Sign up</b>.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-6 sm:grid-cols-[1fr_12rem]">
            <div className="flex flex-col gap-2">
              <Label htmlFor="f-title">Modal title <span className="font-normal text-muted-foreground">(max 45, Discord modal header)</span></Label>
              <Input id="f-title" value={value.title} maxLength={45} onChange={(e) => edit("title", e.target.value)} />
              <span className="text-xs text-muted-foreground">{value.title.length}/45</span>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2"><Label htmlFor="f-size">Team size</Label><Help>Max members per team. The greedy matcher fills teams until this size, then starts a new team. Larger = fewer, bigger teams. This is the <b>only</b> hard cap — friend groups larger than this are reported as a conflict and treated as a preference.</Help></div>
              <Input id="f-size" type="number" min={2} max={25} value={value.teamSize} onChange={(e) => edit("teamSize", Number(e.target.value))} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="f-desc">Intro description <span className="font-normal text-muted-foreground">(max 300, shown above the Sign up button)</span></Label>
            <Textarea id="f-desc" value={value.description} maxLength={300} onChange={(e) => edit("description", e.target.value)} />
            <span className="text-xs text-muted-foreground">{value.description.length}/300</span>
          </div>
        </CardContent>
      </Card>

      <ExperiencesEditor value={value.experiences} onChange={v=>edit("experiences", v as FormConfig["experiences"])} />
      <RoleTracksEditor value={value.roleTracks} onChange={v=>edit("roleTracks", v)} />
      <TeamPrefsEditor value={value.teamPrefs} onChange={v=>edit("teamPrefs", v as FormConfig["teamPrefs"])} />
      <SkillsEditor value={value.skills} onChange={v=>edit("skills", v)} />
    </div>
  )
}

/* ── Experiences ── */
function ExperiencesEditor({ value, onChange }: { value: { id: string; label: string }[]; onChange: (v:{id:string;label:string}[])=>void }) {
  const [newLabel, setNewLabel] = useState("")
  function add() {
    const label=newLabel.trim(); if(!label) return
    const id=label.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"") || `opt_${value.length+1}`
    if(value.some(v=>v.id===id)) { toast.error(`ID "${id}" already exists`); return }
    // experience ids must be one of the 3 known for scoring; warn if custom
    if(!["first_timer","some_experience","veteran"].includes(id)) toast.info(`Custom experience "${id}" will always score ~1 (middle) — matching only gives bonuses for the 3 built-ins.`)
    onChange([...value, { id, label }]); setNewLabel("")
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2"><CardTitle className="text-base">Experience levels</CardTitle><Help>How experience is <b>measured</b> in matching: first_timer=0, some_experience=1, veteran=2. Pair diff 1 → +6 (ideal mentorship), diff 0 → +3, diff 2 → +0. Custom IDs get no bonus. Keep to 3 levels for the model to work.</Help></div>
        <CardDescription>The signup ask: “How many hackathons have you done?” Used only as a soft bonus — never blocks anyone.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-wrap gap-2">
          {value.map(item=>(
            <li key={item.id} className="flex items-center gap-2 rounded-full border border-border bg-surface-2 py-1.5 pr-2 pl-3.5 text-sm">
              <span className="font-medium">{item.label}</span><Badge variant="secondary" className="font-mono text-[10px]">{item.id}</Badge>
              <button onClick={()=>onChange(value.filter(v=>v.id!==item.id))} className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-danger/10 hover:text-danger"><Trash2 className="size-3" /></button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Input value={newLabel} onChange={e=>setNewLabel(e.target.value)} placeholder="e.g. First hackathon" className="w-64" onKeyDown={e=>e.key==="Enter"&&(e.preventDefault(),add())} />
          <Button variant="secondary" onClick={add} disabled={!newLabel.trim()}><Plus className="size-4" />Add</Button>
        </div>
        <div className="rounded-md bg-surface-2/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          <b>Impact:</b> first-timer ↔ some_experience = +6, same level = +3, veteran ↔ first-timer = +0. The matcher will prefer mixed teams, so add at least 2 levels.
        </div>
      </CardContent>
    </Card>
  )
}

/* ── Role tracks ── */
const COMPLEMENTARY_PAIRS = [["frontend","backend"],["frontend","design"],["backend","design"],["devops","frontend"],["devops","backend"],["fullstack","design"],["fullstack","devops"]] as const
function RoleTracksEditor({ value, onChange }: { value: { id:string; label:string }[]; onChange:(v:{id:string;label:string}[])=>void }) {
  const [newLabel, setNewLabel] = useState("")
  const known = new Set(["frontend","backend","fullstack","design","devops","flex"])
  function add() {
    const label=newLabel.trim(); if(!label) return
    const id=label.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"") || `opt_${value.length+1}`
    if(value.some(v=>v.id===id)) { toast.error(`ID "${id}" already exists`); return }
    if(!known.has(id)) toast.info(`Custom role "${id}" gets no complementary bonus — only ${[...known].join(", ")} are in the pair table.`)
    onChange([...value, { id, label }]); setNewLabel("")
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2"><CardTitle className="text-base">Role tracks</CardTitle><Help><div className="space-y-2"><p><b>Role mix</b> drives +9 for complementary pairs, +5 for same role, otherwise 0.</p><p className="font-mono text-xs">frontend↔backend, frontend↔design, backend↔design, devops↔frontend, devops↔backend, fullstack↔design, fullstack↔devops</p><p>Use IDs exactly as above. “flex” is wildcard — it never gets +9.</p></div></Help></div>
        <CardDescription>Primary role. Shown as a single-select in the modal. Complementary roles make the best teams.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ul className="flex flex-wrap gap-2">
          {value.map(item=>(
            <li key={item.id} className="flex items-center gap-2 rounded-full border border-border bg-surface-2 py-1.5 pr-2 pl-3.5 text-sm">
              <span>{item.label}</span><Badge variant={known.has(item.id) ? "default" : "secondary"} className="font-mono text-[10px]">{item.id}{!known.has(item.id) && " · custom"}</Badge>
              <button onClick={()=>onChange(value.filter(v=>v.id!==item.id))} className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-danger/10 hover:text-danger"><Trash2 className="size-3" /></button>
            </li>
          ))}
        </ul>
        <div className="flex gap-2">
          <Input value={newLabel} onChange={e=>setNewLabel(e.target.value)} placeholder="e.g. Frontend" className="w-52" onKeyDown={e=>e.key==="Enter"&&(e.preventDefault(),add())} />
          <Button variant="secondary" onClick={add} disabled={!newLabel.trim()}><Plus className="size-4" />Add</Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {COMPLEMENTARY_PAIRS.map(([a,b])=><Badge key={`${a}-${b}`} variant="outline" className="text-[11px]">{a} ↔ {b} +9</Badge>)}
          <Badge variant="outline" className="text-[11px]">same role +5</Badge>
        </div>
      </CardContent>
    </Card>
  )
}

/* ── Team preferences ── */
function TeamPrefsEditor({ value, onChange }: { value: { id:string; label:string }[]; onChange:(v:{id:string;label:string}[])=>void }) {
  const META: Record<string,{ icon:typeof Crown; title:string; desc:string; impact:string }> = {
    create_team: { icon: Crown, title: "Create my own team", desc: "User will create a public/private team and invite people. They are NOT auto-matched.", impact: "Excluded from matching pool." },
    join_team: { icon: Users, title: "Join an existing team", desc: "User browses public teams to request a join. They are NOT auto-matched.", impact: "Excluded from matching pool." },
    random_team: { icon: Shuffle, title: "Get matched", desc: "User opts into auto-matching. Only these signups are used when you Preview / Commit teams.", impact: "Included in matching pool." },
  }
  const [newLabel, setNewLabel] = useState("")
  const known = new Set(["create_team","join_team","random_team"])
  function add() {
    const label=newLabel.trim(); if(!label) return
    const id=label.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"") || `opt_${value.length+1}`
    if(value.some(v=>v.id===id)) { toast.error(`ID "${id}" already exists`); return }
    if(!known.has(id)) toast.info(`Custom pref "${id}" is treated as “not random” — only random_team enters the matcher.`)
    onChange([...value, { id, label }]); setNewLabel("")
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2"><CardTitle className="text-base">Team preferences</CardTitle><Help>What this <b>means</b> for matching: only <code className="rounded bg-muted px-1">random_team</code> (“Get matched”) signups are considered when you run Preview/Commit. The other two are manual — they must create or join a team themselves. This dropdown does NOT control matching directly; it gates who enters the matcher.</Help></div>
        <CardDescription>What the participant wants. Only “Get matched” enters the auto-matcher — the other two are manual.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {value.map(item=>{
            const m=META[item.id]
            const Icon=m?.icon ?? HelpCircle
            return (
              <div key={item.id} className="flex flex-col gap-2 rounded-xl border border-border bg-surface-2/40 p-3">
                <div className="flex items-center gap-2"><Icon className="size-4 text-accent" /><span className="text-sm font-semibold">{item.label}</span></div>
                <span className="font-mono text-[10px] text-muted-foreground">{item.id}{!known.has(item.id) && " · custom (not matched)"}</span>
                {m && <><p className="text-xs leading-relaxed text-muted-foreground">{m.desc}</p><Badge variant={item.id==="random_team" ? "default" : "secondary"} className="w-fit text-[10px]">{m.impact}</Badge></>}
                <button onClick={()=>onChange(value.filter(v=>v.id!==item.id))} className="mt-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-danger"><Trash2 className="size-3" />Remove</button>
              </div>
            )
          })}
        </div>
        <div className="flex gap-2">
          <Input value={newLabel} onChange={e=>setNewLabel(e.target.value)} placeholder='e.g. Get matched' className="w-64" onKeyDown={e=>e.key==="Enter"&&(e.preventDefault(),add())} />
          <Button variant="secondary" onClick={add} disabled={!newLabel.trim()}><Plus className="size-4" />Add</Button>
        </div>
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed">
          <b>Tip:</b> Keep IDs exactly <code>create_team</code>, <code>join_team</code>, <code>random_team</code> if you want the matcher to work. Renaming the <b>label</b> is fine — the <b>id</b> is what matters.
        </div>
      </CardContent>
    </Card>
  )
}

/* ── Skills ── */
function SkillsEditor({ value, onChange }: { value: { id:string; label:string; group:string }[]; onChange:(v:{id:string;label:string;group:string}[])=>void }) {
  const [newLabel, setNewLabel] = useState("")
  const [newGroup, setNewGroup] = useState("")
  const groups = Array.from(new Set(value.map(v=>v.group).filter(Boolean))).sort()
  const grouped = new Map<string, typeof value>()
  for(const s of value) { const g=s.group || "(no group · combinable)"; const arr=grouped.get(g) ?? []; arr.push(s); grouped.set(g, arr) }
  function add() {
    const label=newLabel.trim(); if(!label) return
    const id=label.toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"") || `skill_${value.length+1}`
    if(value.some(v=>v.id===id)) { toast.error(`ID "${id}" already exists`); return }
    const group=newGroup.trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"")
    onChange([...value, { id, label, group }]); setNewLabel(""); setNewGroup("")
  }
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2"><CardTitle className="text-base">Skills</CardTitle><Help><div className="space-y-2"><p><b>What “group” does:</b> skills that share the same group are <b>mutually exclusive</b> — the Discord modal only lets you pick one from that group (e.g. you can’t pick both <code>Backend — Node</code> and <code>Backend — Python</code> if both are group <code>backend</code>).</p><p>Empty group = freely combinable (UI/UX, DevOps etc.). The text you type under “Group” is that exclusivity key — it’s <b>not</b> auto-inferred from the label.</p><p><b>Matching effect:</b> shared skills +8 each (cap 24). Different skill groups between two people +4 each (cap 12). So diversity across groups is rewarded.</p></div></Help></div>
        <CardDescription>Grouped pills = pick one per group. Empty group = can pick alongside anything. Matching rewards diversity across groups.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Grouped view */}
        {value.length>0 ? (
          <div className="flex flex-col gap-3">
            {[...grouped.entries()].sort((a,b)=>a[0].localeCompare(b[0])).map(([group, skills])=>(
              <div key={group} className="rounded-lg border border-border bg-surface-2/30 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Badge variant={group==="(no group · combinable)" ? "secondary" : "default"} className="text-[11px]">{group}</Badge>
                  <span className="text-xs text-muted-foreground">{group==="(no group · combinable)" ? "can combine with anything" : "pick one only"}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {skills.map(s=>(
                    <span key={s.id} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-3 py-1 text-sm">
                      {s.label}<span className="font-mono text-[10px] text-muted-foreground">{s.id}</span>
                      <button onClick={()=>onChange(value.filter(v=>v.id!==s.id))} className="ml-1 flex size-5 items-center justify-center rounded-full hover:bg-danger/10 hover:text-danger"><Trash2 className="size-3" /></button>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : <span className="text-sm text-muted-foreground">No skills yet — add some below.</span>}

        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border bg-surface-2/20 p-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Skill label</Label>
            <Input value={newLabel} onChange={e=>setNewLabel(e.target.value)} placeholder="e.g. Backend — Node/TypeScript" className="w-64" onKeyDown={e=>e.key==="Enter"&&(e.preventDefault(),add())} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Group <span className="font-normal text-muted-foreground">(leave empty = combinable)</span></Label>
            <div className="flex gap-2">
              <Select value={newGroup || "__none"} onValueChange={v=>setNewGroup(v==="__none" ? "" : v)}>
                <SelectTrigger className="w-44"><SelectValue placeholder="No group" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">No group (combinable)</SelectItem>
                  {groups.map(g=><SelectItem key={g} value={g}>{g}</SelectItem>)}
                  <SelectItem value="__custom">— Type a new group —</SelectItem>
                </SelectContent>
              </Select>
              {newGroup!=="" && !groups.includes(newGroup) && newGroup!=="__custom" && <Badge variant="outline" className="self-center">new: {newGroup}</Badge>}
            </div>
            {newGroup==="__custom" && (
              <Input value="" onChange={e=>setNewGroup(e.target.value)} placeholder="e.g. backend" className="w-44" autoFocus onFocus={()=>{ if(newGroup==="__custom") setNewGroup("") }} />
            )}
          </div>
          <Button variant="secondary" onClick={add} disabled={!newLabel.trim()} className="self-end"><Plus className="size-4" />Add skill</Button>
        </div>
        <div className="grid gap-2 text-xs leading-relaxed text-muted-foreground sm:grid-cols-2">
          <div className="rounded-md bg-surface-2/60 px-3 py-2"><b>UI rule:</b> same group → modal allows one choice from that group. Different groups or empty → can pick multiple.</div>
          <div className="rounded-md bg-surface-2/60 px-3 py-2"><b>Matching rule:</b> identical skill +8 (cap 24), different groups +4 (cap 12). So “React + Node” beats “Node + Node”.</div>
        </div>
      </CardContent>
    </Card>
  )
}
