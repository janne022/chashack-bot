import { useMemo, useState } from 'react'
import { MoreHorizontal, Search, Users } from 'lucide-react'
import { toast } from 'sonner'
import type { AppState, Participant } from '@/types'
import { api } from '@/api'
import { useT } from '@/lib/i18n'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { EmptyState } from '@/components/ui/empty-state'
import { StatusBadge, labelFor } from '@/lib/labels'
import { timeAgo } from '@/lib/format'

type StatusFilter = 'all' | 'active' | 'blocked' | 'withdrawn' | 'unteamed'

export function ParticipantsPanel({ state, refresh }: { state: AppState; refresh: () => Promise<void> }) {
  const t = useT()
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [confirmBlock, setConfirmBlock] = useState<Participant | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return state.participants.filter((p) => {
      if (filter === 'unteamed' && !(p.status === 'active' && p.teamId === null)) return false
      if (filter !== 'all' && filter !== 'unteamed' && p.status !== filter) return false
      if (q === '') return true
      return (
        p.displayName.toLowerCase().includes(q) ||
        p.userId.includes(q) ||
        p.skills.some((s) => labelFor(state.config, 'skills', s).toLowerCase().includes(q))
      )
    })
  }, [state.participants, state.config, query, filter])

  async function act(fn: () => Promise<void>, okMsg: string) {
    try {
      await fn()
      toast.success(okMsg)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.action_failed'))
    }
  }

  if (state.participants.length === 0) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={<Users className="size-5" />}
            title={t('participants.none_title')}
            description={t('participants.none_desc')}
          />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('participants.search_placeholder')}
              className="pl-9"
              aria-label={t('participants.search_aria')}
            />
          </div>
          <Select value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
            <SelectTrigger className="w-44" aria-label={t('participants.filter_aria')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('participants.filter_all')}</SelectItem>
              <SelectItem value="active">{t('participants.filter_active')}</SelectItem>
              <SelectItem value="blocked">{t('participants.filter_blocked')}</SelectItem>
              <SelectItem value="withdrawn">{t('participants.filter_withdrawn')}</SelectItem>
              <SelectItem value="unteamed">{t('participants.filter_unteamed')}</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            {t('participants.showing', { shown: filtered.length, total: state.participants.length })}
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('participants.title')}</CardTitle>
          <CardDescription>{t('participants.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">{t('participants.col_name')}</th>
                <th className="px-4 py-3 font-medium">{t('participants.col_status')}</th>
                <th className="px-4 py-3 font-medium">{t('participants.col_role')}</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">{t('participants.col_skills')}</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">{t('participants.col_pref')}</th>
                <th className="px-4 py-3 font-medium">{t('participants.col_team')}</th>
                <th className="px-4 py-3" aria-label={t('common.actions_for', { name: '' }).replace(/ $/, '')} />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.userId} className="border-b border-border last:border-0 hover:bg-surface-2/50">
                  <td className="px-4 py-3">
                    <div className="font-medium">{p.displayName}</div>
                    <div className="text-xs text-muted-foreground">
                      {labelFor(state.config, 'experiences', p.experience)} · {timeAgo(p.createdAt)}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={p.status} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {labelFor(state.config, 'roleTracks', p.roleTrack)}
                  </td>
                  <td className="hidden max-w-56 px-4 py-3 md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {p.skills.slice(0, 3).map((s) => (
                        <Badge key={s} variant="secondary">
                          {labelFor(state.config, 'skills', s)}
                        </Badge>
                      ))}
                      {p.skills.length > 3 && (
                        <Badge variant="outline">+{p.skills.length - 3}</Badge>
                      )}
                    </div>
                  </td>
                  <td className="hidden px-4 py-3 text-xs text-muted-foreground lg:table-cell">
                    {labelFor(state.config, 'teamPrefs', p.teamPref)}
                  </td>
                  <td className="px-4 py-3">
                    {p.status === 'active' ? (
                      <Select
                        value={p.teamId ?? '__none__'}
                        onValueChange={(teamId) =>
                          void act(
                            () => api.assignTeam(p.userId, teamId === '__none__' ? null : teamId),
                            t('participants.team_updated'),
                          )
                        }
                      >
                        <SelectTrigger className="h-8 w-40 text-xs" aria-label={t('participants.team_for_aria', { name: p.displayName })}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">{t('common.no_team')}</SelectItem>
                          {state.teams.map((team) => (
                            <SelectItem key={team.id} value={team.id}>
                              {team.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={t('common.actions_for', { name: p.displayName })}>
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {p.status !== 'blocked' ? (
                          <DropdownMenuItem
                            className="text-danger data-[highlighted]:bg-danger/10"
                            onSelect={() => setConfirmBlock(p)}
                          >
                            {t('participants.block')}
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onSelect={() =>
                              void act(() => api.participantAction(p.userId, 'unblock'), t('participants.unblocked'))
                            }
                          >
                            {t('participants.unblock')}
                          </DropdownMenuItem>
                        )}
                        {p.status === 'active' && (
                          <DropdownMenuItem
                            onSelect={() =>
                              void act(
                                () => api.participantAction(p.userId, 'withdraw'),
                                t('participants.signup_removed'),
                              )
                            }
                          >
                            {t('participants.remove_signup')}
                          </DropdownMenuItem>
                        )}
                        {p.status === 'withdrawn' && (
                          <DropdownMenuItem
                            onSelect={() =>
                              void act(
                                () => api.participantAction(p.userId, 'reactivate'),
                                t('participants.reactivated'),
                              )
                            }
                          >
                            {t('participants.reactivate')}
                          </DropdownMenuItem>
                        )}
                        {p.teamId !== null && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() =>
                                void act(
                                  () => api.assignTeam(p.userId, null),
                                  t('participants.removed_from_team'),
                                )
                              }
                            >
                              {t('participants.kick_off_team')}
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <AlertDialog open={confirmBlock !== null} onOpenChange={(o) => !o && setConfirmBlock(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('participants.block_title', { name: confirmBlock?.displayName ?? '' })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('participants.block_desc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const p = confirmBlock
                setConfirmBlock(null)
                if (p !== null) {
                  void act(() => api.participantAction(p.userId, 'block'), t('participants.blocked'))
                }
              }}
            >
              {t('participants.blocked')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
