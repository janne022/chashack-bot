import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, Check, ExternalLink, Lock, LockOpen, Pencil, Sparkles, Trash2, TriangleAlert, UserMinus, Users } from 'lucide-react'
import { toast } from 'sonner'
import type { AppState, HackathonEvent, MatchResult, Team, TeamSuggestion } from '@/types'
import { api } from '@/api'
import { useT } from '@/lib/i18n'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { EmptyState } from '@/components/ui/empty-state'
import { labelFor } from '@/lib/labels'
import { dateTime, timeAgo } from '@/lib/format'
import { matchAtSchema } from '@/lib/schemas'

export function MatchingPanel({ state, refresh }: { state: AppState; refresh: () => Promise<void> }) {
  const t = useT()
  const [preview, setPreview] = useState<MatchResult | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [placements, setPlacements] = useState<Record<string, TeamSuggestion[]>>({})
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [dragOverTeam, setDragOverTeam] = useState<string | null>(null)
  const [draggingUser, setDraggingUser] = useState<string | null>(null)

  const activeEvent = state.events.find((e) => e.id === state.activeEventId) ?? null
  const candidates = state.stats.matchingOptIn
  const unteamed = useMemo(
    () => state.participants.filter((p) => p.status === 'active' && p.teamId === null),
    [state.participants],
  )

  // ── late-signup suggestions (explicit fetch, never auto-assign) ────────────
  const loadSuggestions = useCallback(async () => {
    setSuggestionsLoading(true)
    try {
      const results = await Promise.all(
        unteamed.map(async (p) => {
          try {
            return [p.userId, await api.matchSuggestions(p.userId)] as const
          } catch {
            return [p.userId, [] as TeamSuggestion[]] as const
          }
        }),
      )
      setPlacements(Object.fromEntries(results))
    } finally {
      setSuggestionsLoading(false)
    }
  }, [unteamed])

  useEffect(() => {
    void loadSuggestions()
  }, [loadSuggestions])

  async function runPreview() {
    setBusy(true)
    try {
      const result = await api.matchPreview()
      setPreview(result)
      toast.success(t('matching.drafted', { count: result.teams.length }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('matching.preview_failed'))
      setPreview(null)
    } finally {
      setBusy(false)
    }
  }

  async function commit() {
    setBusy(true)
    try {
      const result = await api.matchCommit()
      setPreview(null)
      toast.success(t('matching.committed', { count: result.teams.length }))
      await refresh()
      await loadSuggestions()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('matching.commit_failed'))
    } finally {
      setBusy(false)
    }
  }

  async function place(userId: string, teamId: string | null, teamName?: string) {
    try {
      await api.assignTeam(userId, teamId)
      toast.success(teamName !== undefined ? `${nameOf(userId)} → ${teamName}` : `${nameOf(userId)} unassigned`)
      await refresh()
      await loadSuggestions()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Placement failed')
    }
  }

  function nameOf(userId: string): string {
    return state.participants.find((p) => p.userId === userId)?.displayName ?? userId
  }

  // ── drag & drop ─────────────────────────────────────────────────────────────
  function onDropTeam(team: Team) {
    setDragOverTeam(null)
    if (draggingUser === null) return
    const userId = draggingUser
    setDraggingUser(null)
    void place(userId, team.id, team.name)
  }

  const refreshAll = useCallback(async () => {
    await refresh()
    await loadSuggestions()
  }, [refresh, loadSuggestions])

  return (
    <div className="flex flex-col gap-4">
      <SchedulerCard event={activeEvent} refresh={refresh} />

      <Card>
        <CardHeader>
          <CardTitle>{t('matching.title')}</CardTitle>
          <CardDescription>
            {t('matching.desc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <div className="text-sm">
            <div className="text-2xl font-bold">{candidates}</div>
            <div className="text-xs text-muted-foreground">{t('matching.ready_count')}</div>
          </div>
          <div className="ml-auto flex gap-2">
            {preview !== null && (
              <Button variant="outline" onClick={() => setPreview(null)}>
                {t('matching.discard')}
              </Button>
            )}
            <Button onClick={() => void runPreview()} disabled={busy || candidates < 2}>
              <Sparkles />
              {preview !== null ? t('matching.rerun') : t('matching.preview')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {state.lastMatch !== null && (
        <p className="text-xs text-muted-foreground">
          {t('matching.last_match', { count: state.lastMatch.teams, when: timeAgo(state.lastMatch.at) })}
        </p>
      )}

      <NeedsPlacementSection
        state={state}
        unteamed={unteamed}
        placements={placements}
        loading={suggestionsLoading}
        draggingUser={draggingUser}
        setDraggingUser={setDraggingUser}
        onPlace={place}
      />

      {state.teams.length > 0 && (
        <section>
          <h2 className="font-display mb-3 text-sm uppercase tracking-wide text-muted-foreground">
            Teams — drop targets (right-click a card for actions)
          </h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {state.teams.map((team) => (
              <TeamCardWithMenu
                key={team.id}
                team={team}
                guildId={activeEvent?.guildId ?? null}
                isDropTarget={dragOverTeam === team.id}
                dragActive={draggingUser !== null}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  setDragOverTeam(team.id)
                }}
                onDragLeave={() => setDragOverTeam((cur) => (cur === team.id ? null : cur))}
                onDrop={() => onDropTeam(team)}
                onRenamed={refreshAll}
                onRemoved={refreshAll}
              />
            ))}
          </div>
        </section>
      )}

      {preview === null ? (
        candidates < 2 ? (
          <Card>
            <CardContent>
              <EmptyState
                icon={<Sparkles className="size-5" />}
                title={candidates === 0 ? t('matching.nobody_title') : t('matching.need_one_title')}
                description={
                  candidates === 0
                    ? t('matching.nobody_desc')
                    : t('matching.need_one_desc')
                }
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent>
              <EmptyState
                icon={<Sparkles className="size-5" />}
                title={t('matching.ready_title')}
                description={t('matching.ready_desc')}
              />
            </CardContent>
          </Card>
        )
      ) : (
        <>
          {preview.conflicts.length > 0 && (
            <Card className="border-warn/40 bg-warn/5">
              <CardContent className="flex flex-col gap-1.5 p-4 text-sm">
                {preview.conflicts.map((c, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
                    <span>{c}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            {preview.teams.map((team) => {
              const members = team.memberIds
                .map((id) => state.participants.find((p) => p.userId === id))
                .filter((p) => p !== undefined)
              const avgExp = new Set(members.map((m) => m.experience)).size
              return (
                <Card key={team.name}>
                  <CardHeader className="flex-row items-center justify-between space-y-0">
                    <CardTitle>{team.name}</CardTitle>
                    <Badge variant={team.score >= 70 ? 'success' : team.score >= 50 ? 'default' : 'warning'}>
                      {team.score}
                    </Badge>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-1.5">
                    {members.map((m) => (
                      <div key={m.userId} className="flex items-center justify-between gap-2 text-sm">
                        <span className="truncate font-medium">{m.displayName}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {labelFor(state.config, 'roleTracks', m.roleTrack)}
                        </span>
                      </div>
                    ))}
                    {team.notes.length > 0 && (
                      <p className="pt-1 text-xs text-warn">{team.notes.join(' · ')}</p>
                    )}
                    {avgExp > 1 && members.length > 1 && (
                      <p className="text-xs text-muted-foreground">{t('matching.mixed_experience')}</p>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <div className="flex justify-end">
            <Button size="lg" onClick={() => setConfirmOpen(true)}>
              <Check />
              {t('matching.commit_these')}
            </Button>
          </div>

          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('matching.commit_title', { count: preview.teams.length })}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('matching.commit_desc')}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('matching.back')}</AlertDialogCancel>
                <AlertDialogAction onClick={() => void commit()}>{t('matching.commit_announce')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  )
}

// ─── needs placement (late signups) ───────────────────────────────────────────

function NeedsPlacementSection({
  state,
  unteamed,
  placements,
  loading,
  draggingUser,
  setDraggingUser,
  onPlace,
}: {
  state: AppState
  unteamed: AppState['participants']
  placements: Record<string, TeamSuggestion[]>
  loading: boolean
  draggingUser: string | null
  setDraggingUser: (id: string | null) => void
  onPlace: (userId: string, teamId: string | null, teamName?: string) => Promise<void>
}) {
  if (unteamed.length === 0) {
    return null
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4 text-accent" />
          Needs placement ({unteamed.length})
        </CardTitle>
        <CardDescription>
          Late signups and anyone without a team. Drag a chip onto a team card below, or use the
          dropdown — nothing is placed automatically.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {unteamed.map((p) => {
          const suggestions = placements[p.userId] ?? []
          return (
            <div
              key={p.userId}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2/40 px-3 py-2"
            >
              <div className="min-w-40">
                <div className="text-sm font-medium">{p.displayName}</div>
                <div className="text-xs text-muted-foreground">
                  {labelFor(state.config, 'roleTracks', p.roleTrack)}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {suggestions.length === 0 && !loading && (
                  <span className="text-xs text-muted-foreground">no open teams yet</span>
                )}
                {loading && suggestions.length === 0 && (
                  <span className="text-xs text-muted-foreground">loading suggestions…</span>
                )}
                {suggestions.map((s) => (
                  <button
                    key={s.teamId}
                    type="button"
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/participant-id', p.userId)
                      e.dataTransfer.effectAllowed = 'move'
                      setDraggingUser(p.userId)
                    }}
                    onDragEnd={() => setDraggingUser(null)}
                    onClick={() => void onPlace(p.userId, s.teamId, s.teamName)}
                    className={`cursor-grab rounded-full border border-accent/40 bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/20 active:cursor-grabbing ${
                      draggingUser === p.userId ? 'opacity-50' : ''
                    }`}
                    title={`Suggested: ${s.teamName} (score ${s.score}) — click to place, or drag onto a team card`}
                  >
                    {s.teamName} · {s.score}
                  </button>
                ))}
              </div>
              {/* Accessible/mobile fallback: explicit select, never automatic. */}
              <Select
                value=""
                onValueChange={(teamId) => {
                  if (teamId !== '') {
                    const team = state.teams.find((t) => t.id === teamId)
                    void onPlace(p.userId, teamId, team?.name)
                  }
                }}
              >
                <SelectTrigger className="ml-auto h-7 w-36 text-xs" aria-label={`Place ${p.displayName} into a team`}>
                  <SelectValue placeholder="Place manually…" />
                </SelectTrigger>
                <SelectContent>
                  {state.teams.map((t) => (
                    <SelectItem key={t.id} value={t.id} disabled={t.members.length >= state.config.teamSize}>
                      {t.name} ({t.members.length}/{state.config.teamSize})
                    </SelectItem>
                  ))}
                  {state.teams.length === 0 && <SelectItem value="__none" disabled>No teams yet</SelectItem>}
                </SelectContent>
              </Select>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

// ─── team card with right-click context menu ─────────────────────────────────

export function TeamCardWithMenu({
  team,
  guildId,
  isDropTarget,
  dragActive,
  onDragOver,
  onDragLeave,
  onDrop,
  onRenamed,
  onRemoved,
}: {
  team: Team
  guildId: string | null
  isDropTarget: boolean
  dragActive: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: () => void
  onRenamed: () => Promise<void>
  onRemoved: () => Promise<void>
}) {
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState(team.name)
  const [busy, setBusy] = useState(false)

  async function rename() {
    const next = renameValue.trim()
    if (next.length < 3 || next === team.name) {
      setRenameOpen(false)
      return
    }
    setBusy(true)
    try {
      await api.updateTeamSettings(team.id, { name: next })
      toast.success(`Team renamed to “${next}”`)
      setRenameOpen(false)
      await onRenamed()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Rename failed')
    } finally {
      setBusy(false)
    }
  }

  async function kick(userId: string) {
    try {
      await api.removeMember(team.id, userId)
      toast.success(`${userId} removed from ${team.name}`)
      await onRenamed()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Kick failed')
    }
  }

  async function dissolve() {
    try {
      await api.deleteTeam(team.id)
      toast.success(`${team.name} dissolved`)
      await onRemoved()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Dissolve failed')
    }
  }

  const discordHref =
    guildId !== null && team.textChannelId !== null
      ? `https://discord.com/channels/${guildId}/${team.textChannelId}`
      : null

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <Card
            className={
              'transition-all ' +
              (dragActive && isDropTarget ? 'border-accent bg-accent/10 ring-2 ring-accent/40' : '')
            }
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={(e) => {
              e.preventDefault()
              onDrop()
            }}
          >
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">{team.name}</CardTitle>
              <Badge variant={team.kind === 'matched' ? 'success' : 'secondary'}>
                {team.kind} · {team.members.length}
              </Badge>
            </CardHeader>
            <CardContent className="flex flex-col gap-1 text-sm">
              {team.members.map((m) => (
                <div key={m.userId} className="flex items-center justify-between gap-2">
                  <span className="truncate">{m.displayName}</span>
                  <span className="text-xs text-muted-foreground">{m.roleTrack}</span>
                </div>
              ))}
              {team.members.length === 0 && <span className="text-xs text-muted-foreground">empty</span>}
              <span className="pt-1 text-[11px] text-muted-foreground">right-click for actions</span>
            </CardContent>
          </Card>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-52">
          {discordHref !== null && (
            <ContextMenuItem asChild>
              <a href={discordHref} target="_blank" rel="noreferrer">
                <ExternalLink />
                Open in Discord
              </a>
            </ContextMenuItem>
          )}
          <ContextMenuItem
            onSelect={(e) => {
              e.preventDefault()
              setRenameValue(team.name)
              setRenameOpen(true)
            }}
          >
            <Pencil />
            Rename
          </ContextMenuItem>
          {team.members.length > 0 && (
            <>
              <ContextMenuSeparator />
              <ContextMenuSub>
                <ContextMenuSubTrigger>
                  <UserMinus />
                  Kick member
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="w-48">
                  {team.members.map((m) => (
                    <ContextMenuItem key={m.userId} variant="destructive" onSelect={() => void kick(m.userId)}>
                      {m.displayName}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" onSelect={() => void dissolve()}>
            <Trash2 />
            Dissolve team
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename “{team.name}”</DialogTitle>
            <DialogDescription>The team name shows up in channels, roles and lists.</DialogDescription>
          </DialogHeader>
          <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} maxLength={60} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameOpen(false)}>
              Cancel
            </Button>
            <Button disabled={busy || renameValue.trim().length < 3} onClick={() => void rename()}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─── auto-match scheduler ─────────────────────────────────────────────────────

function SchedulerCard({ event, refresh }: { event: HackathonEvent | null; refresh: () => Promise<void> }) {
  const [when, setWhen] = useState('')
  const [busy, setBusy] = useState(false)
  const [, setTick] = useState(0)

  // Re-render every 30s so the countdown stays fresh.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  if (event === null) {
    return null
  }
  const ev = event

  async function schedule() {
    if (when === '') return
    const ms = Date.parse(when)
    if (Number.isNaN(ms)) {
      toast.error('Invalid time')
      return
    }
    const parsed = matchAtSchema.safeParse(ms)
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Invalid time')
      return
    }
    if (parsed.data <= Date.now() - 60 * 60 * 1000) {
      toast.error('Pick a time in the future (or now)')
      return
    }
    const matchAt: number = parsed.data
    setBusy(true)
    try {
      await api.updateEvent(ev.id, { matchAt })
      toast.success(`Auto-match scheduled for ${dateTime(matchAt)}`)
      setWhen('')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Scheduling failed')
    } finally {
      setBusy(false)
    }
  }

  async function cancelSchedule() {
    setBusy(true)
    try {
      await api.updateEvent(ev.id, { matchAt: null })
      toast.info('Auto-match schedule cleared')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Cancel failed')
    } finally {
      setBusy(false)
    }
  }

  async function lockNow() {
    setBusy(true)
    try {
      await api.matchLock()
      toast.success('Teams locked — auto-match will not run again')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Lock failed')
    } finally {
      setBusy(false)
    }
  }

  async function unlock() {
    setBusy(true)
    try {
      await api.matchUnlock()
      toast.info('Lock cleared — auto-match can run again')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Unlock failed')
    } finally {
      setBusy(false)
    }
  }

  const countdown = countdownLabel(ev.matchAt)

  return (
    <Card className={ev.matchLocked ? 'border-ok/40' : undefined}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarClock className="size-4 text-accent" />
          Auto-match
          {ev.matchLocked && <Badge variant="success"><Lock className="size-3" /> locked</Badge>}
        </CardTitle>
        <CardDescription>
          Schedule matching to run itself, then lock the lineups. Runs at the next maintenance tick —
          up to 5 minutes after the scheduled time.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <div className="text-sm">
          <div className="text-xs text-muted-foreground">Scheduled</div>
          <div>{ev.matchAt !== null ? dateTime(ev.matchAt) : 'manual'}</div>
        </div>
        {ev.matchAt !== null && countdown !== null && (
          <Badge variant={ev.matchLocked ? 'secondary' : 'default'}>{countdown}</Badge>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Input
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className="h-9 w-56"
            aria-label="Auto-match time"
          />
          <Button size="sm" disabled={busy || when === ''} onClick={() => void schedule()}>
            <CalendarClock />
            Schedule auto-match
          </Button>
          {ev.matchAt !== null && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void cancelSchedule()}>
              Cancel schedule
            </Button>
          )}
          {ev.matchLocked ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void unlock()}>
              <LockOpen />
              Unlock
            </Button>
          ) : (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void lockNow()}>
              <Lock />
              Lock now
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function countdownLabel(matchAt: number | null): string | null {
  if (matchAt === null) return null
  const diff = matchAt - Date.now()
  if (diff <= 0) return 'due — runs at next tick'
  const m = Math.floor(diff / 60_000)
  if (m < 60) return `in ${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `in ${h}h ${m % 60}m`
  return `in ${Math.floor(h / 24)}d`
}
