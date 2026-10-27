"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useT } from "@/lib/i18n"
import { useTagDefinitions } from "@/components/TagHelp"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea-label"
import { getTagPosition, type TagPosition } from "@/lib/tag-position"
import { filterTags } from "@/lib/tag-search"

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
  const t = useT()
  const definitions = useTagDefinitions()
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => { menu.current?.querySelector(`[data-selected="true"]`)?.scrollIntoView({ block: "nearest" }) }, [selectedIdx])
  const [rect, setRect] = useState<DOMRect | null>(null)

  useEffect(() => {
    if (!anchor) return
    const update = () => setRect(anchor.getBoundingClientRect())
    update()
    const observer = new ResizeObserver(update)
    observer.observe(anchor)
    window.addEventListener("scroll", update, true)
    window.addEventListener("resize", update)
    return () => {
      observer.disconnect()
      window.removeEventListener("scroll", update, true)
      window.removeEventListener("resize", update)
    }
  }, [anchor])

  const filtered = useMemo(() => {
    return filterTags(definitions, prefix)
  }, [definitions, prefix])

  if (!anchor || !rect || filtered.length === 0) return null
  // Stay inside every scroll/clipping ancestor, including modal content.
  let top = 0, bottom = window.innerHeight
  for (let parent = anchor.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) {
      const bounds = parent.getBoundingClientRect()
      top = Math.max(top, bounds.top)
      bottom = Math.min(bottom, bounds.bottom)
    }
  }
  const spaceBelow = bottom - rect.bottom
  const spaceAbove = rect.top - top
  const showAbove = spaceBelow < Math.min(272, spaceAbove)
  const style: React.CSSProperties = {
    position: "absolute",
    left: 0,
    ...(showAbove ? { bottom: "calc(100% + 6px)" } : { top: "calc(100% + 6px)" }),
    width: "min(100%, 30rem)",
    maxHeight: Math.max(100, Math.min(256, (showAbove ? spaceAbove : spaceBelow) - 16)),
    zIndex: 100,
  }

  const node = (
    <div
      ref={menu}
      role="listbox"
      tabIndex={0}
      data-tag-suggestions="true"
      aria-label={t("tags.title")}
      style={style}
      className="max-h-64 overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-1 shadow-xl"
      onMouseDown={e=>e.preventDefault()}
    >
      <div className="px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t("tags.title")}</div>
      {filtered.map((d, idx) => (
        <button
          key={d.tag}
          role="option"
          aria-selected={idx === selectedIdx}
          data-selected={idx === selectedIdx}
          tabIndex={-1}
          type="button"
          onClick={()=>onPick(d.tag)}
          className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-muted ${idx===selectedIdx ? "bg-muted ring-1 ring-inset ring-border" : ""}`}
        >
          <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{d.tag}</code>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium leading-tight">{d.label}</div>
            <div className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{d.desc}</div>
          </div>
          <span className="shrink-0 text-[10px] text-muted-foreground">{d.context}</span>
        </button>
      ))}
      <div className="border-t border-border px-2 py-1 text-[10px] text-muted-foreground">{t("tags.keyboard")}</div>
    </div>
  )
  return createPortal(node, anchor.parentElement!)
}

function useTagAutocomplete(value: string, onChange: (next: string) => void) {
  const definitions = useTagDefinitions()
  const [pos, setPos] = useState<TagPosition | null>(null)
  const [selIdx, setSelIdx] = useState(0)
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement>(null)

  const lastPosition = useRef<{ value: string; cursor: number } | null>(null)
  const updatePos = (v: string, cursor: number, force = false) => {
    if (!force && lastPosition.current?.value === v && lastPosition.current.cursor === cursor) return
    lastPosition.current = { value: v, cursor }
    const p = getTagPosition(v, cursor)
    setPos(p)
    setSelIdx(0)
  }

  const filtered = useMemo(() => {
    if (!pos) return []
    return filterTags(definitions, pos.prefix)
  }, [definitions, pos])

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
    } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setPos(null) }
  }

  return { pos, selIdx, filtered, pick, onKeyDown, ref, updatePos, setPos }
}

export function TagAutocompleteTextarea({ value, onChange, placeholder, maxLength, className }: { value: string; onChange: (v: string)=>void; placeholder?: string; maxLength?: number; className?: string }) {
  const t = useT()
  const { pos, selIdx, pick, onKeyDown, ref, updatePos, setPos } = useTagAutocomplete(value, onChange)
  return (
    <div className="relative min-w-0">
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
          updatePos(el.value, el.selectionStart ?? 0, true)
        }}
        placeholder={placeholder ?? t("tags.placeholder")}
        aria-label={placeholder ?? t("tags.placeholder")}
        maxLength={maxLength}
        className={className}
      />
      {pos && <FilteredTagsPortal anchor={ref.current} prefix={pos.prefix} onPick={pick} selectedIdx={selIdx} />}
    </div>
  )
}

export function TagAutocompleteInput({ value, onChange, placeholder, maxLength, className }: { value: string; onChange: (v: string)=>void; placeholder?: string; maxLength?: number; className?: string }) {
  const t = useT()
  const { pos, selIdx, pick, onKeyDown, ref, updatePos, setPos } = useTagAutocomplete(value, onChange)
  return (
    <div className="relative min-w-0">
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
          updatePos(el.value, el.selectionStart ?? 0, true)
        }}
        placeholder={placeholder ?? t("tags.placeholder")}
        aria-label={placeholder ?? t("tags.placeholder")}
        maxLength={maxLength}
        className={className}
      />
      {pos && <FilteredTagsPortal anchor={ref.current} prefix={pos.prefix} onPick={pick} selectedIdx={selIdx} />}
    </div>
  )
}
