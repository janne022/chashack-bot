"use client"
import { HelpCircle } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

export const TAG_DEFS: { tag: string; label: string; desc: string; example: string; context: string }[] = [
  { tag: "{event}", label: "Event name", desc: "Name of the hackathon event (e.g. from template).", example: "ChasHack 2026", context: "always" },
  { tag: "{event_description}", label: "Event description", desc: "Full description you set when creating the event.", example: "48-hour hackathon…", context: "always" },
  { tag: "{panel}", label: "Panel channel", desc: "Mention of the signup panel channel. Falls back to “panel not set” if none.", example: "<#123> → #signup-panel", context: "always" },
  { tag: "{announce}", label: "Announcement channel", desc: "Mention of announcement channel (or panel if none).", example: "<#123> → #announcements", context: "always" },
  { tag: "{everyone}", label: "@everyone ping", desc: "Pings everyone. Needs bot perm Mention Everyone + Send Messages.", example: "@everyone", context: "always — enables allowedMentions" },
  { tag: "{here}", label: "@here ping", desc: "Pings only online members. Same perm as everyone.", example: "@here", context: "always" },
  { tag: "{timer}", label: "Time until start", desc: "Relative Discord timestamp for startsAt.", example: "<t:171578:R> → “in 2 hours”", context: "needs startsAt" },
  { tag: "{startsAt}", label: "Start date (full)", desc: "Absolute start date.", example: "<t:171578:F> → Saturday, Jun 14 09:00", context: "needs startsAt" },
  { tag: "{endsAt}", label: "End date (full)", desc: "Absolute end date.", example: "<t:17158:F>", context: "needs endsAt" },
  { tag: "{schedule}", label: "Full schedule list", desc: "All blocks as • time title list. Only outside a specific schedule item.", example: "• 18:00 Dinner\n• 12:00 Fika", context: "global only" },
  { tag: "{schedule_title}", label: "This block’s title", desc: "The schedule item that triggered this (schedule trigger only).", example: "Dinner", context: "schedule trigger" },
  { tag: "{schedule_desc}", label: "This block’s description", desc: "Details you typed for the block (may be empty).", example: "Pizza in the kitchen", context: "schedule trigger" },
  { tag: "{schedule_time}", label: "This block’s clock time", desc: "Discord time for the block.", example: "<t:…:t> → 18:00", context: "schedule trigger" },
  { tag: "{timer_schedule}", label: "Time until this block", desc: "Relative timestamp for the schedule item.", example: "<t:…:R> → “in 10 minutes”", context: "schedule trigger" },
  { tag: "{schedule_kind}", label: "Kind", desc: "food / break / voting / prize / talk / custom", example: "food", context: "schedule trigger" },
]

export function TagPill({ tag }: { tag: string }) {
  const def = TAG_DEFS.find(d=>d.tag===tag)
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
          <div className="mt-1 font-mono text-[11px] opacity-80">ex: {def.example}</div>
          <div className="text-[11px] opacity-60">{def.context}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function TagCheatSheet({ compact=false }: { compact?: boolean }) {
  return (
    <TooltipProvider>
      <Card className={compact ? "border-dashed" : undefined}>
        <CardHeader className={compact ? "pb-2" : undefined}>
          <CardTitle className="flex items-center gap-2 text-sm"><HelpCircle className="size-4" /> Tag cheat sheet <Badge variant="secondary" className="ml-1 text-[10px]">hover a tag</Badge></CardTitle>
          <CardDescription>Tags are replaced when sent to Discord. <code className="rounded bg-muted px-1">{"{everyone}"}</code> and <code className="rounded bg-muted px-1">{"{here}"}</code> actually ping — bot enables <code>parse: ["everyone"]</code> only when it sees them.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            {TAG_DEFS.map(d=>(
              <div key={d.tag} className="flex gap-2 rounded-lg border border-border bg-background px-2.5 py-2">
                <TagPill tag={d.tag} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium leading-tight">{d.label}</div>
                  <div className="text-[11px] leading-snug text-muted-foreground">{d.desc}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted-foreground/80">ex: {d.example}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-md bg-surface-2/60 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            <b>Examples:</b> <code className="rounded bg-background px-1">Listen up {"{everyone}"} **{"{event}"}** starts {"{timer}"} — {"{panel}"}</code> → pings everyone + relative timer.{" "}
            <code className="rounded bg-background px-1">⏰ {"{schedule_title}"} — {"{schedule_desc}"} {"{timer_schedule}"}</code> → per-block announcement.
            <br /><b>Context:</b> <code>{"{schedule_title}"}</code> family only works inside a <Badge variant="outline" className="mx-1 text-[10px]">For each schedule item</Badge> trigger or per-block Zapier action; otherwise they’re empty. <code>{"{timer}"}</code> needs a start date.
          </div>
        </CardContent>
      </Card>
    </TooltipProvider>
  )
}

export function TagHelpButton() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm"><HelpCircle className="size-4" /> Cheat sheet</Button>
      </PopoverTrigger>
      <PopoverContent className="w-[520px] p-0 max-h-[80vh] overflow-y-auto" align="start">
        <TagCheatSheet />
      </PopoverContent>
    </Popover>
  )
}
