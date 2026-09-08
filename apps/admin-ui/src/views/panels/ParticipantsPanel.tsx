import { MoreHorizontal, Search, Users } from 'lucide-react'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { useVirtualizer } from '@tanstack/react-virtual'
import { flexRender, useTable } from '@tanstack/react-table'
import type { Cell, SortingState } from '@tanstack/react-table'
import type { AppState, Participant } from '@/types'
import { api } from '@/api'
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
import { useAppContext } from '@/lib/app-context'
import { participantsFeatures } from './participants-table/features'
import {
  PARTICIPANTS_ACTIONS_COLUMN_ID,
  PARTICIPANTS_TEAM_COLUMN_ID,
  type ParticipantsColumnDef,
} from './participants-table/columns'
import type { ParticipantsFeatures } from './participants-table/features'
import type { ParticipantAction } from './participants-table/types'

type StatusFilter = 'all' | 'active' | 'blocked' | 'withdrawn' | 'unteamed'

/** Rows above this count switch the table to a virtualized scroll container. */
const VIRTUALIZE_THRESHOLD = 30
/** Fixed row height the virtualizer estimates (px). */
const ROW_HEIGHT = 56
/** Sticky thead height inside the scroll container (px). */
const HEADER_OFFSET = 41

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

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StatusFilter>('all')
  const [confirmBlock, setConfirmBlock] = useState<Participant | null>(null)
  const [sorting, setSorting] = useState<SortingState>([])
  const scrollRef = useRef<HTMLDivElement | null>(null)

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
      toast.error(e instanceof Error ? e.message : 'Action failed')
    }
  }

  // Handler table passed to cell templates through the table's `meta`
  // option (typed via the tableMeta slot on participantsFeatures).
  const meta = useMemo(
    () => ({
      teams: state.teams,
      assignTeam: (userId: string, teamId: string | null) =>
        void act(
          () => api.assignTeam(userId, teamId),
          teamId === null ? 'Removed from team' : 'Team updated',
        ),
      onBlockRequest: (participant: Participant) => setConfirmBlock(participant),
      onAction: (participant: Participant, action: ParticipantAction) => {
        const messages: Record<ParticipantAction, string> = {
          unblock: 'Unblocked',
          withdraw: 'Signup removed',
          reactivate: 'Reactivated',
        }
        void act(() => api.participantAction(participant.userId, action), messages[action])
      },
    }),
    // `act` closes over `refresh` only.
    [state.teams, refresh],
  )

  const columns = useMemo<ParticipantsColumnDef[]>(() => {
    const label = (list: 'experiences' | 'roleTracks' | 'skills' | 'teamPrefs', id: string) =>
      labelFor(state.config, list, id)
    return [
      {
        id: 'name',
        accessorFn: (row) => row.displayName,
        header: 'Name',
        cell: (ctx) => {
          const p = ctx.row.original
          return (
            <div>
              <div className="font-medium">{p.displayName}</div>
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
        header: 'Status',
        cell: (ctx) => <StatusBadge status={ctx.row.original.status} />,
      },
      {
        id: 'role',
        enableSorting: false,
        header: 'Role',
        cell: (ctx) => (
          <span className="text-muted-foreground">
            {label('roleTracks', ctx.row.original.roleTrack)}
          </span>
        ),
      },
      {
        id: 'skills',
        enableSorting: false,
        header: 'Skills',
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
        header: 'Pref',
        cell: (ctx) => (
          <span className="text-xs text-muted-foreground">
            {label('teamPrefs', ctx.row.original.teamPref)}
          </span>
        ),
      },
      {
        id: PARTICIPANTS_TEAM_COLUMN_ID,
        enableSorting: false,
        header: 'Team',
        cell: (ctx) => {
          const p = ctx.row.original
          const m = ctx.table.options.meta
          if (p.status !== 'active') {
            return <span className="text-xs text-muted-foreground">—</span>
          }
          return (
            <Select
              value={p.teamId ?? '__none__'}
              onValueChange={(teamId) => m?.assignTeam(p.userId, teamId === '__none__' ? null : teamId)}
            >
              <SelectTrigger className="h-8 w-40 text-xs" aria-label={`Team for ${p.displayName}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No team</SelectItem>
                {m?.teams.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )
        },
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
                <Button variant="ghost" size="icon" aria-label={`Actions for ${p.displayName}`}>
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {p.status !== 'blocked' ? (
                  <DropdownMenuItem
                    className="text-danger data-[highlighted]:bg-danger/10"
                    onSelect={() => m?.onBlockRequest(p)}
                  >
                    Block from signing up
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem onSelect={() => m?.onAction(p, 'unblock')}>
                    Unblock
                  </DropdownMenuItem>
                )}
                {p.status === 'active' && (
                  <DropdownMenuItem onSelect={() => m?.onAction(p, 'withdraw')}>
                    Remove signup
                  </DropdownMenuItem>
                )}
                {p.status === 'withdrawn' && (
                  <DropdownMenuItem onSelect={() => m?.onAction(p, 'reactivate')}>
                    Reactivate
                  </DropdownMenuItem>
                )}
                {p.teamId !== null && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-danger data-[highlighted]:bg-danger/10"
                      onSelect={() => m?.assignTeam(p.userId, null)}
                    >
                      Kick off team
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )
        },
      },
    ]
  }, [state.config])

  const table = useTable({
    features: participantsFeatures,
    columns,
    data: filtered,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => row.userId,
    meta,
  })

  const virtualize = filtered.length > VIRTUALIZE_THRESHOLD
  const rowVirtualizer = useVirtualizer<HTMLDivElement, HTMLTableRowElement>({
    count: filtered.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    getItemKey: (index) => filtered[index]?.userId ?? String(index),
    // Rows render below the sticky thead inside the same scroll container.
    scrollMargin: HEADER_OFFSET,
    enabled: virtualize,
  })

  const sortedRows = table.getRowModel().rows
  const virtualItems = rowVirtualizer.getVirtualItems()
  const totalSize = rowVirtualizer.getTotalSize()
  const firstVirtual = virtualItems[0]
  const lastVirtual = virtualItems[virtualItems.length - 1]
  const leadingSpacer =
    virtualize && firstVirtual !== undefined ? Math.max(0, firstVirtual.start - HEADER_OFFSET) : 0
  const trailingSpacer =
    virtualize && lastVirtual !== undefined
      ? Math.max(0, totalSize + HEADER_OFFSET - (lastVirtual.start + lastVirtual.size))
      : 0

  if (state.participants.length === 0) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={<Users className="size-5" />}
            title="No signups yet"
            description="Once people use /hackathon join in Discord, they appear here."
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
              placeholder="Search name, id or skill…"
              className="pl-9"
              aria-label="Search participants"
            />
          </div>
          <Select value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
            <SelectTrigger className="w-44" aria-label="Filter by status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="blocked">Blocked</SelectItem>
              <SelectItem value="withdrawn">Withdrawn</SelectItem>
              <SelectItem value="unteamed">Unteamed only</SelectItem>
            </SelectContent>
          </Select>
          <span className="text-sm text-muted-foreground">
            {filtered.length} of {state.participants.length}
          </span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Participants</CardTitle>
          <CardDescription>Move people between teams, block or remove signups</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div
            ref={scrollRef}
            className={virtualize ? 'max-h-[70vh] overflow-auto' : 'overflow-x-auto'}
          >
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  {table.getHeaderGroups()[0]?.headers.map((header) => {
                    const canSort = header.column.getCanSort()
                    const sorted = header.column.getIsSorted()
                    const isSkills = header.column.id === 'skills'
                    const isPref = header.column.id === 'pref'
                    const isActions = header.column.id === PARTICIPANTS_ACTIONS_COLUMN_ID
                    return (
                      <th
                        key={header.id}
                        className={
                          isSkills
                            ? 'hidden px-4 py-3 font-medium md:table-cell'
                            : isPref
                              ? 'hidden px-4 py-3 font-medium lg:table-cell'
                              : isActions
                                ? 'px-4 py-3'
                                : 'px-4 py-3 font-medium'
                        }
                        aria-label={isActions ? 'Actions' : undefined}
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
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {virtualize && leadingSpacer > 0 && (
                  <tr aria-hidden style={{ height: leadingSpacer }}>
                    <td colSpan={7} />
                  </tr>
                )}
                {virtualize
                  ? virtualItems.map((vi) => {
                      const row = sortedRows[vi.index]
                      if (row === undefined) return null
                      return (
                        <tr
                          key={row.id}
                          data-index={vi.index}
                          ref={rowVirtualizer.measureElement}
                          className="border-b border-border hover:bg-surface-2/50"
                          style={{ height: ROW_HEIGHT }}
                        >
                          {row.getAllCells().map((cell) => renderCell(cell))}
                        </tr>
                      )
                    })
                  : sortedRows.map((row) => (
                      <tr
                        key={row.id}
                        className="border-b border-border last:border-0 hover:bg-surface-2/50"
                      >
                        {row.getAllCells().map((cell) => renderCell(cell))}
                      </tr>
                    ))}
                {virtualize && trailingSpacer > 0 && (
                  <tr aria-hidden style={{ height: trailingSpacer }}>
                    <td colSpan={7} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={confirmBlock !== null} onOpenChange={(o) => !o && setConfirmBlock(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Block {confirmBlock?.displayName}?</AlertDialogTitle>
            <AlertDialogDescription>
              They can no longer sign up or update their signup, and they are removed from any team.
              You can unblock them later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const p = confirmBlock
                setConfirmBlock(null)
                if (p !== null) {
                  void act(() => api.participantAction(p.userId, 'block'), 'Blocked')
                }
              }}
            >
              Block
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** Renders one cell; applies the responsive visibility of the Skills/Pref columns. */
function renderCell(cell: Cell<ParticipantsFeatures, Participant>): ReactNode {
  const isSkills = cell.column.id === 'skills'
  const isPref = cell.column.id === 'pref'
  const isActions = cell.column.id === PARTICIPANTS_ACTIONS_COLUMN_ID
  return (
    <td
      key={cell.id}
      className={
        isSkills
          ? 'hidden max-w-56 px-4 py-3 md:table-cell'
          : isPref
            ? 'hidden px-4 py-3 text-xs text-muted-foreground lg:table-cell'
            : isActions
              ? 'px-4 py-3 text-right'
              : 'px-4 py-3'
      }
    >
      {flexRender(cell.column.columnDef.cell, cell.getContext())}
    </td>
  )
}
