import { MoreHorizontal, Search, Users } from 'lucide-react'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { useVirtualizer } from '@tanstack/react-virtual'
import { flexRender, useTable } from '@tanstack/react-table'
import type { Cell, SortingState } from '@tanstack/react-table'
import type { AnswerVersion, AppState, Participant } from '@/types'
import { AnswerVersions } from '@/components/answer-versions'
import { MemberCombobox, type GuildMemberOption } from '@/components/member-combobox'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { api } from '@/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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
import { useAppContext } from '@/lib/app-context'
import { useT } from '@/lib/i18n'
import { participantsFeatures } from './participants-table/features'
import {
  PARTICIPANTS_ACTIONS_COLUMN_ID,
  PARTICIPANTS_TEAM_COLUMN_ID,
  type ParticipantsColumnDef,
} from './participants-table/columns'
import type { ParticipantsFeatures } from './participants-table/features'
import type { ParticipantAction } from './participants-table/types'

const GRID_COLUMNS = 'grid min-w-[720px] grid-cols-[minmax(180px,2fr)_100px_120px_190px_64px] md:min-w-[880px] md:grid-cols-[minmax(180px,2fr)_100px_120px_minmax(160px,1fr)_190px_64px] lg:min-w-[1000px] lg:grid-cols-[minmax(180px,2fr)_100px_120px_minmax(160px,1fr)_120px_190px_64px]'

type StatusFilter = 'all' | 'active' | 'blocked' | 'withdrawn' | 'unteamed' | 'imported'

export function ParticipantsPanel({
  state: stateProp,
  refresh: refreshProp,
}: {
  state?: AppState
  refresh?: () => Promise<void>
} = {}) {
  const { state: ctxState, refresh: ctxRefresh } = useAppContext()
  const state = stateProp ?? ctxState
  const refresh = refreshProp ?? ctxRefresh
  // Pin actions to the event being viewed.
  const eventId = state.selectedEventId ?? undefined
  const t = useT()

  const [query, setQuery] = useState('')
  const [selectedMember, setSelectedMember] = useState<GuildMemberOption | null>(null)
  const [adding, setAdding] = useState(false)
  const canAdd = state.events.some(event => event.id === eventId && event.status === 'active')
  async function addMember() {
    if (!eventId || !selectedMember || adding) return
    setAdding(true)
    try {
      await api.addParticipant(eventId, selectedMember.id)
      setSelectedMember(null)
      toast.success(t('participants.added'))
      await refresh()
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : ''
      toast.error(code === 'blocked' ? t('participants.add_blocked') : code === 'invalid_member' ? t('participants.add_invalid') : code === 'event_not_active' ? t('participants.add_event_closed') : t('participants.add_failed'))
    } finally { setAdding(false) }
  }
  const addControl = canAdd ? <Card><CardContent className="flex flex-col gap-3 p-4"><div><p className="font-medium">{t('participants.add_title')}</p><p className="text-sm text-muted-foreground">{t('participants.add_description')}</p></div><div className="flex flex-wrap items-center gap-2"><div className="min-w-52 flex-1"><MemberCombobox value={selectedMember} onSelect={setSelectedMember} disabled={adding} /></div><Button disabled={!selectedMember || adding} onClick={() => void addMember()}>{t('participants.add_button')}</Button></div></CardContent></Card> : null
  const [filter, setFilter] = useState<StatusFilter>('all')
  const suggestions = useMemo(() => {
    const term = query.trim().toLowerCase()
    if (!term) return []
    return [...new Set(state.participants.flatMap(p => [p.displayName, ...p.skills.map(skill => labelFor(state.config, 'skills', skill))]))].filter(value => value.toLowerCase().includes(term)).slice(0, 15)
  }, [query, state.participants, state.config])
  const [answersParticipant, setAnswersParticipant] = useState<Participant | null>(null)
  const [confirmBlock, setConfirmBlock] = useState<Participant | null>(null)
  const [sorting, setSorting] = useState<SortingState>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return state.participants.filter((p) => {
      if (filter === 'imported' && p.importedSignupId === null) return false
      if (filter === 'unteamed' && !(p.status === 'active' && p.teamId === null)) return false
      if (filter !== 'all' && filter !== 'unteamed' && filter !== 'imported' && p.status !== filter) return false
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

  // Handler table passed to cell templates through the table's `meta`
  // option (typed via the tableMeta slot on participantsFeatures).
  const meta = useMemo(
    () => ({
      teams: state.teams,
      assignTeam: (userId: string, teamId: string | null) =>
        void act(
          () => api.assignTeam(userId, teamId, eventId),
          teamId === null ? t('participants.removed_from_team') : t('participants.team_updated'),
        ),
      onBlockRequest: (participant: Participant) => setConfirmBlock(participant),
      onAction: (participant: Participant, action: ParticipantAction) => {
        const messages: Record<ParticipantAction, string> = {
          unblock: t('participants.unblocked'),
          withdraw: t('participants.signup_removed'),
          reactivate: t('participants.reactivated'),
        }
        void act(() => api.participantAction(participant.userId, action, undefined, eventId), messages[action])
      },
    }),
    // `act` closes over `refresh`; t is stable per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.teams, refresh, t, eventId],
  )

  const columns = useMemo<ParticipantsColumnDef[]>(() => {
    const label = (list: 'experiences' | 'roleTracks' | 'skills' | 'teamPrefs', id: string) =>
      labelFor(state.config, list, id)
    return [
      {
        id: 'name',
        accessorFn: (row) => row.displayName,
        header: t('participants.col_name'),
        cell: (ctx) => {
          const p = ctx.row.original
          return (
            <div>
              <div className="flex items-center gap-1.5 font-medium">
                <span className="truncate">{p.displayName}</span>
                {p.importedSignupId !== null && (
                  <Badge variant="secondary" className="shrink-0 text-[10px] font-normal">
                    {t('participants.badge_imported')}
                  </Badge>
                )}
                {p.userId.startsWith('imp:') && (
                  <Badge variant="outline" className="shrink-0 text-[10px] font-normal">
                    {t('participants.badge_not_in_discord')}
                  </Badge>
                )}
              </div>
              <div className="text-xs text-muted-foreground">
                {label('experiences', p.experience)} · {timeAgo(p.createdAt)}
              </div>
            </div>
          )
        },
      },
      {
        id: 'status',
        enableSorting: false,
        header: t('participants.col_status'),
        cell: (ctx) => <StatusBadge status={ctx.row.original.status} />,
      },
      {
        id: 'role',
        enableSorting: false,
        header: t('participants.col_role'),
        cell: (ctx) => (
          <span className="text-muted-foreground">
            {label('roleTracks', ctx.row.original.roleTrack)}
          </span>
        ),
      },
      {
        id: 'skills',
        enableSorting: false,
        header: t('participants.col_skills'),
        cell: (ctx) => {
          const skills = ctx.row.original.skills
          return (
            <div className="flex flex-wrap gap-1">
              {skills.slice(0, 3).map((s) => (
                <Badge key={s} variant="secondary">
                  {label('skills', s)}
                </Badge>
              ))}
              {skills.length > 3 && <Badge variant="outline">+{skills.length - 3}</Badge>}
            </div>
          )
        },
      },
      {
        id: 'pref',
        enableSorting: false,
        header: t('participants.col_pref'),
        cell: (ctx) => (
          <span className="text-xs text-muted-foreground">
            {label('teamPrefs', ctx.row.original.teamPref)}
          </span>
        ),
      },
      {
        id: PARTICIPANTS_TEAM_COLUMN_ID,
        enableSorting: false,
        header: t('participants.col_team'),
        cell: ParticipantTeamCell,
      },
      {
        id: PARTICIPANTS_ACTIONS_COLUMN_ID,
        enableSorting: false,
        header: '',
        cell: (ctx) => {
          const p = ctx.row.original
          const m = ctx.table.options.meta
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label={t('common.actions_for', { name: p.displayName })}>
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {eventId && <DropdownMenuItem onSelect={() => setAnswersParticipant(p)}>{t('answers.view')}</DropdownMenuItem>}
                {p.status !== 'blocked' ? (
                  <DropdownMenuItem
                    className="text-danger data-[highlighted]:bg-danger/10"
                    onSelect={() => m?.onBlockRequest(p)}
                  >
                    {t('participants.block')}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => m?.onAction(p, 'unblock')}>
                    {t('participants.unblock')}
                  </DropdownMenuItem>
                )}
                {p.status === 'active' && (
                  <DropdownMenuItem variant="destructive" onSelect={() => m?.onAction(p, 'withdraw')}>
                    {t('participants.remove_signup')}
                  </DropdownMenuItem>
                )}
                {p.status === 'withdrawn' && (
                  <DropdownMenuItem onSelect={() => m?.onAction(p, 'reactivate')}>
                    {t('participants.reactivate')}
                  </DropdownMenuItem>
                )}
                {p.teamId !== null && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-danger data-[highlighted]:bg-danger/10"
                      onSelect={() => m?.assignTeam(p.userId, null)}
                    >
                      {t('participants.kick_off_team')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        },
      },
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.config, t, eventId])

  const table = useTable({
    features: participantsFeatures,
    columns,
    data: filtered,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => row.userId,
    meta,
  })

  const sortedRows = table.getRowModel().rows
  const virtualize = sortedRows.length > 30
  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: sortedRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    getItemKey: (index) => sortedRows[index]?.id ?? index,
    overscan: 8,
    enabled: virtualize,
  })
  if (state.participants.length === 0) {
    return (
      <div className="flex flex-col gap-4">
      {addControl}
      <Card>
        <CardContent>
          <EmptyState
            icon={<Users className="size-5" />}
            title={t('participants.none_title')}
            description={t('participants.none_desc')}
          />
        </CardContent>
      </Card>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {addControl}
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              list="participant-search-suggestions"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('participants.search_placeholder')}
              className="pl-9"
              aria-label={t('participants.search_aria')}
            />
            <datalist id="participant-search-suggestions">
              {suggestions.map(value => <option key={value} value={value} />)}
            </datalist>
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
              <SelectItem value="imported">{t('participants.filter_imported')}</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            {t('participants.showing', { shown: filtered.length, total: state.participants.length })}
          </span>
        </CardContent>
      </Card>

      <Card className="pb-0">
        <CardHeader>
          <CardTitle>{t('participants.title')}</CardTitle>
          <CardDescription>{t('participants.desc')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {filtered.length === 0 ? <EmptyState icon={<Search className="size-5" />} title={t('participants.no_matches')} action={<Button variant="outline" onClick={() => { setQuery(''); setFilter('all') }}>{t('common.clear')}</Button>} /> : <Table containerRef={scrollRef} containerClassName={virtualize ? "h-[70vh] overflow-auto" : "overflow-y-hidden"} className={virtualize ? "grid" : undefined} aria-rowcount={sortedRows.length + 1}>
              <TableHeader className="sticky top-0 z-10 bg-surface">
                <TableRow className={`${virtualize ? GRID_COLUMNS : ""} border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground`}>
                  {table.getHeaderGroups()[0]?.headers.map((header) => {
                    const canSort = header.column.getCanSort()
                    const sorted = header.column.getIsSorted()
                    const isSkills = header.column.id === 'skills'
                    const isPref = header.column.id === 'pref'
                    const isActions = header.column.id === PARTICIPANTS_ACTIONS_COLUMN_ID
                    return (
                      <TableHead
                        key={header.id}
                        scope="col"
                        aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                        className={
                          isSkills
                            ? 'hidden px-4 py-3 font-medium md:table-cell'
                            : isPref
                              ? 'hidden px-4 py-3 font-medium lg:table-cell'
                              : isActions
                                ? 'px-4 py-3'
                                : 'px-4 py-3 font-medium'
                        }
                        aria-label={
                          isActions ? t('common.actions_for', { name: '' }).replace(/ $/, '') : undefined
                        }
                      >
                        {canSort ? (
                          <button
                            type="button"
                            onClick={header.column.getToggleSortingHandler()}
                            className="group inline-flex cursor-pointer items-center gap-1 uppercase tracking-wide hover:text-foreground"
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {sorted === 'asc' ? (
                              <ChevronUp className="size-3.5 text-sky" />
                            ) : sorted === 'desc' ? (
                              <ChevronDown className="size-3.5 text-sky" />
                            ) : (
                              <ChevronsUpDown className="size-3.5 opacity-40 transition-opacity group-hover:opacity-80" />
                            )}
                          </button>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </TableHead>
                    )
                  })}
                </TableRow>
              </TableHeader>
              <TableBody className={virtualize ? "relative grid [&_tr:last-child]:border-b" : undefined} style={virtualize ? { height: rowVirtualizer.getTotalSize() } : undefined}>
                {virtualize ? rowVirtualizer.getVirtualItems().map((item) => {
                  const row = sortedRows[item.index]
                  if (!row) return null
                  return <TableRow
                    key={row.id}
                    data-index={item.index}
                    aria-rowindex={item.index + 2}
                    ref={rowVirtualizer.measureElement}
                    className={`${GRID_COLUMNS} absolute w-full border-b border-border hover:bg-surface-2/50`}
                    style={{ transform: `translateY(${item.start}px)` }}
                  >
                    {row.getAllCells().map((cell) => renderCell(cell))}
                  </TableRow>
                }) : sortedRows.map((row) => (
                  <TableRow key={row.id} className="border-b border-border last:border-0 hover:bg-surface-2/50">
                    {row.getAllCells().map((cell) => renderCell(cell))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>}
        </CardContent>
      </Card>

      {answersParticipant && eventId && <ParticipantAnswers eventId={eventId} participant={answersParticipant} onClose={() => setAnswersParticipant(null)} />}
      <AlertDialog open={confirmBlock !== null} onOpenChange={(o) => !o && setConfirmBlock(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('participants.block_title', { name: confirmBlock?.displayName ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('participants.block_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const p = confirmBlock
                setConfirmBlock(null)
                if (p !== null) {
                  void act(() => api.participantAction(p.userId, 'block', undefined, eventId), t('participants.blocked'))
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

// Keep the component identity stable when a live refresh replaces state.config.
function ParticipantTeamCell(ctx: ReturnType<Cell<ParticipantsFeatures, Participant>['getContext']>) {
  const t = useT()
  const p = ctx.row.original
  const m = ctx.table.options.meta
  if (p.status !== 'active') return <span className="text-xs text-muted-foreground">—</span>
  return (
    <Select value={p.teamId ?? '__none__'} onValueChange={teamId => m?.assignTeam(p.userId, teamId === '__none__' ? null : teamId)}>
      <SelectTrigger className="h-8 w-40 text-xs" aria-label={t('participants.team_for_aria', { name: p.displayName })}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">{t('common.no_team')}</SelectItem>
        {m?.teams.map(team => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

/** Renders one cell; applies the responsive visibility of the Skills/Pref columns. */
function renderCell(cell: Cell<ParticipantsFeatures, Participant>): ReactNode {
  const isSkills = cell.column.id === 'skills'
  const isPref = cell.column.id === 'pref'
  const isActions = cell.column.id === PARTICIPANTS_ACTIONS_COLUMN_ID
  return (
    <TableCell
      key={cell.id}
      className={
        isSkills
          ? 'hidden max-w-56 whitespace-normal px-4 py-3 md:table-cell'
          : isPref
            ? 'hidden whitespace-normal px-4 py-3 text-xs text-muted-foreground lg:table-cell'
            : isActions
              ? 'px-4 py-3 text-right'
              : 'whitespace-normal px-4 py-3'
      }
    >
      {flexRender(cell.column.columnDef.cell, cell.getContext())}
    </TableCell>
  )
}

function ParticipantAnswers({ eventId, participant, onClose }: { eventId: string; participant: Participant; onClose: () => void }) {
  const t = useT()
  const [versions, setVersions] = useState<AnswerVersion[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    void api.registrationAnswers(eventId, participant.userId).then(result => {
      if (active) setVersions([result, ...result.answerHistory])
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [eventId, participant.userId])
  return <Dialog open onOpenChange={open => { if (!open) onClose() }}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
    <DialogTitle>{t('answers.title', { name: participant.displayName })}</DialogTitle>
    <DialogDescription>{t('answers.description')}</DialogDescription>
    {failed ? <p role="alert">{t('answers.load_failed')}</p> : versions === null ? <p role="status">{t('answers.loading')}</p> : <AnswerVersions versions={versions} />}
  </DialogContent></Dialog>
}
