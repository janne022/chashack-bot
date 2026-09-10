"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { TAG_DEFS } from "@/components/TagHelp"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea-label"

type Pos = { start: number; end: number; prefix: string }

function getTagPos(value: string, cursor: number): Pos | null {
  const before = value.slice(0, cursor)
  const lastOpen = before.lastIndexOf("{")
  if (lastOpen === -1) return null
  const between = before.slice(lastOpen, cursor)
  if (between.includes("}")) return null
  const prefix = between.slice(1)
  if (prefix.length > 30) return null
  if (prefix !== "" && !/^[a-zA-Z0-9_]*$/.test(prefix)) return null
  return { start: lastOpen, end: cursor, prefix }
}

function FilteredTagsPortal({
  anchor,
  prefix,
  onPick,
  selectedIdx,
}: {
  anchor: HTMLElement | null
  prefix: string
  onPick: (tag: string) => void
  selectedIdx: number
}) {
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (!anchor) return
    const update = () => setRect(anchor.getBoundingClientRect())
    update()
    window.addEventListener("scroll", update, true)
    window.addEventListener("resize", update)
    return () => {
      window.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
    }
  }, [anchor])

  const filtered = useMemo(() => {
    const p = prefix.toLowerCase()
    if (p === "") return TAG_DEFS
    return TAG_DEFS.filter(d => d.tag.toLowerCase().includes(`{${p}`) || d.label.toLowerCase().includes(p) || d.tag.replace(/[{}]/g,"").toLowerCase().startsWith(p))
  }, [prefix])

  if (!anchor || !rect || filtered.length === 0) return null
  // position fixed below the input, with fallback above if near bottom
  const spaceBelow = window.innerHeight - rect.bottom
  const showAbove = spaceBelow < 280
  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.min(rect.left, window.innerWidth - 336),
    top: showAbove ? Math.max(8, rect.top - 268) : rect.bottom + 6,
    width: Math.min(360, Math.max(320, rect.width)),
    zIndex: 100,
  }

  const node = (
    <div
      style={style}
      className="max-h-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-xl"
      onMouseDown={e=>e.preventDefault()}
    >
      <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Tags — {prefix ? `matching "{${prefix}"` : "type to filter"}</div>
      {filtered.map((d, idx) => (
        <button
          key={d.tag}
          type="button"
          onMouseDown={e=>{ e.preventDefault(); onPick(d.tag) }}
          className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent ${idx===selectedIdx ? "bg-accent" : ""}`}
        >
          <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{d.tag}</code>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium leading-tight">{d.label}</div>
            <div className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{d.desc}</div>
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground">{d.context}</span>
        </button>
      ))}
      <div className="border-t border-border px-2 py-1 text-[10px] text-muted-foreground">↑↓ navigate · Enter Tab to pick · Esc to close</div>
    </div>
  )
  return createPortal(node, document.body)
}

function useTagAutocomplete(value: string, onChange: (next: string) => void) {
  const [pos, setPos] = useState<Pos | null>(null)
  const [selIdx, setSelIdx] = useState(0)
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null)

  const updatePos = (v: string, cursor: number) => {
    const p = getTagPos(v, cursor)
    setPos(p)
    setSelIdx(0)
  }

  const filtered = useMemo(() => {
    if (!pos) return []
    const p = pos.prefix.toLowerCase()
    if (p === "") return TAG_DEFS
    return TAG_DEFS.filter(d => d.tag.toLowerCase().includes(`{${p}`) || d.label.toLowerCase().includes(p) || d.tag.replace(/[{}]/g,"").toLowerCase().startsWith(p))
  }, [pos])

  const pick = (tag: string) => {
    if (!pos) return
    const before = value.slice(0, pos.start)
    const after = value.slice(pos.end)
    const next = before + tag + after
    onChange(next)
    setPos(null)
    requestAnimationFrame(()=>{
      const el = ref.current
      if (el) {
        const at = before.length + tag.length
        el.setSelectionRange(at, at)
        el.focus()
      }
    })
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!pos || filtered.length===0) return
    if (e.key === "ArrowDown") { e.preventDefault(); setSelIdx(i=>Math.min(i+1, filtered.length-1)) }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSelIdx(i=>Math.max(i-1, 0)) }
    else if (e.key === "Enter" || e.key === "Tab") {
      if (filtered[selIdx]) { e.preventDefault(); pick(filtered[selIdx].tag) }
    } else if (e.key === "Escape") { setPos(null) }
  }

  return { pos, selIdx, filtered, pick, onKeyDown, ref, updatePos, setPos }
}

export function TagAutocompleteTextarea({ value, onChange, placeholder, maxLength, className }: { value: string; onChange: (v: string)=>void; placeholder?: string; maxLength?: number; className?: string }) {
  const { pos, selIdx, pick, onKeyDown, ref, updatePos, setPos } = useTagAutocomplete(value, onChange)
  return (
    <>
      <Textarea
        ref={ref as React.RefObject<HTMLTextAreaElement>}
        value={value}
        onChange={e=>{
          const v = e.target.value
          onChange(v)
          requestAnimationFrame(()=> updatePos(v, (e.target as HTMLTextAreaElement).selectionStart ?? v.length))
        }}
        onKeyDown={onKeyDown}
        onSelect={e=>{
          const el = e.target as HTMLTextAreaElement
          updatePos(el.value, el.selectionStart ?? 0)
        }}
        onBlur={()=> setTimeout(()=>setPos(null), 150)}
        onClick={e=>{
          const el = e.target as HTMLTextAreaElement
          updatePos(el.value, el.selectionStart ?? 0)
        }}
        placeholder={placeholder ? `${placeholder} — type { for tags` : "Type { to see tags"}
        maxLength={maxLength}
        className={className}
      />
      {pos && <FilteredTagsPortal anchor={ref.current} prefix={pos.prefix} onPick={pick} selectedIdx={selIdx} />}
    </>
  )
}

export function TagAutocompleteInput({ value, onChange, placeholder, maxLength, className }: { value: string; onChange: (v: string)=>void; placeholder?: string; maxLength?: number; className?: string }) {
  const { pos, selIdx, pick, onKeyDown, ref, updatePos, setPos } = useTagAutocomplete(value, onChange)
  return (
    <>
      <Input
        ref={ref as React.RefObject<HTMLInputElement>}
        value={value}
        onChange={e=>{
          const v = e.target.value
          onChange(v)
          requestAnimationFrame(()=> updatePos(v, (e.target as HTMLInputElement).selectionStart ?? v.length))
        }}
        onKeyDown={onKeyDown}
        onSelect={e=>{
          const el = e.target as HTMLInputElement
          updatePos(el.value, el.selectionStart ?? 0)
        }}
        onBlur={()=> setTimeout(()=>setPos(null), 150)}
        onClick={e=>{
          const el = e.target as HTMLInputElement
          updatePos(el.value, el.selectionStart ?? 0)
        }}
        placeholder={placeholder ? `${placeholder} — { for tags` : "Type { for tags"}
        maxLength={maxLength}
        className={className}
      />
      {pos && <FilteredTagsPortal anchor={ref.current} prefix={pos.prefix} onPick={pick} selectedIdx={selIdx} />}
    </>
  )
}
