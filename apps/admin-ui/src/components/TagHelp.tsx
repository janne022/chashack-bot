"use client"
import { HelpCircle } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useMemo } from "react"
import { useT } from "@/lib/i18n"

export const TAG_DEFS: { tag: string; label: string; desc: string; example: string; context: string }[] = [
  { tag: "{event}", label: "Event name", desc: "Name of the hackathon event (e.g. from template).", example: "ChasHack 2026", context: "always" },
  { tag: "{event_description}", label: "Event description", desc: "Full description you set when creating the event.", example: "48-hour hackathon…", context: "always" },
  { tag: "{panel}", label: "Panel channel", desc: "Mention of the signup panel channel. Falls back to “panel not set” if none.", example: "<#123> → #signup-panel", context: "always" },
  { tag: "{announce}", label: "Announcement channel", desc: "Mention of announcement channel (or panel if none).", example: "<#123> → #announcements", context: "always" },
  { tag: "{everyone}", label: "@everyone ping", desc: "Pings everyone. Needs bot perm Mention Everyone + Send Messages.", example: "@everyone", context: "mention" },
  { tag: "{here}", label: "@here ping", desc: "Pings only online members. Same perm as everyone.", example: "@here", context: "always" },
  { tag: "{timer}", label: "Time until start", desc: "Relative Discord timestamp for startsAt.", example: "<t:171578:R> → “in 2 hours”", context: "start" },
  { tag: "{startsAt}", label: "Start date (full)", desc: "Absolute start date.", example: "<t:171578:F> → Saturday, Jun 14 09:00", context: "start" },
  { tag: "{start_date}", label: "Start date (alias)", desc: "Same as {startsAt} — absolute start.", example: "<t:171578:F>", context: "start" },
  { tag: "{endsAt}", label: "End date (full)", desc: "Absolute end date.", example: "<t:17158:F>", context: "end" },
  { tag: "{end_date}", label: "End date (alias)", desc: "Same as {endsAt} — absolute end.", example: "<t:17158:F>", context: "end" },
  { tag: "{schedule}", label: "Full schedule list", desc: "All blocks as • time title list.", example: "• 18:00 Dinner\\n• 12:00 Fika", context: "always" },
  { tag: "{schedule_title}", label: "This block’s title", desc: "The schedule item that triggered this (schedule trigger only).", example: "Dinner", context: "schedule" },
  { tag: "{schedule_desc}", label: "This block’s description", desc: "Details you typed for the block (may be empty).", example: "Pizza in the kitchen", context: "schedule" },
  { tag: "{schedule_time}", label: "This block’s clock time", desc: "Discord time for the block.", example: "<t:…:t> → 18:00", context: "schedule" },
  { tag: "{timer_schedule}", label: "Time until this block", desc: "Relative timestamp for the schedule item.", example: "<t:…:R> → “in 10 minutes”", context: "schedule" },
  { tag: "{schedule_kind}", label: "Kind", desc: "food / break / voting / prize / talk / custom", example: "food", context: "schedule" },
]

export function useTagDefinitions() {
  const t = useT()
  return useMemo(() => TAG_DEFS.map(def => {
    const key = def.tag.slice(1, -1)
    return { ...def, label: t(`tags.variable.${key}.label`), desc: t(`tags.variable.${key}.description`),
      example: t(`tags.variable.${key}.example`), context: t(`tags.context.${def.context}`) }
  }), [t])
}

export function TagPill({ tag }: { tag: string }) {
  const t = useT()
  const def = useTagDefinitions().find(d=>d.tag===tag)
  if (!def) return <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{tag}</code>
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <code className="cursor-help rounded bg-accent-soft px-1.5 py-0.5 font-mono text-xs text-accent hover:bg-accent hover:text-accent-foreground">{tag}</code>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[260px] whitespace-normal text-xs leading-relaxed">
          <div className="font-semibold">{def.label} — {def.tag}</div>
          <div>{def.desc}</div>
          <div className="mt-1 font-mono text-[11px] opacity-80">{t('tags.help_example')}: {def.example}</div>
          <div className="text-[11px] opacity-60">{def.context}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function TagCheatSheet({ compact=false }: { compact?: boolean }) {
  const t = useT()
  const definitions = useTagDefinitions()
  return (
    <TooltipProvider>
      <Card className={compact ? "border-dashed" : undefined}>
        <CardHeader className={compact ? "pb-2" : undefined}>
          <CardTitle className="flex items-center gap-2 text-sm"><HelpCircle className="size-4" /> {t('tags.help_title')} <Badge variant="secondary" className="ml-1 text-[10px]">{t('tags.help_hover')}</Badge></CardTitle>
          <CardDescription>{t('tags.help_intro')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {definitions.map(d=>(
              <div key={d.tag} className="flex gap-2 rounded-lg border border-border bg-background px-2.5 py-2">
                <TagPill tag={d.tag} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium leading-tight">{d.label}</div>
                  <div className="text-[11px] leading-snug text-muted-foreground">{d.desc}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted-foreground/80">{t('tags.help_example')}: {d.example}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-md bg-surface-2/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            {t('tags.help_context')}
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  )
}

export function TagHelpButton() {
  const t = useT()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm"><HelpCircle className="size-4" /> {t('tags.help_button')}</Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(520px,calc(100vw-2rem))] p-0 max-h-[min(80vh,var(--radix-popover-content-available-height))] overflow-y-auto" align="start" collisionPadding={12}>
        <TagCheatSheet />
      </PopoverContent>
    </Popover>
  )
}
