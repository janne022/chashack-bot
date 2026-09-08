import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { labelFor } from '@/lib/labels'
import type { FormConfig, Participant } from '@/types'

/** Fixed palette (brand tokens) — tracks get colors by order, cycling when exhausted. */
const TRACK_PALETTE = ['#55bbda', '#f08080', '#4e8780', '#c77fc7', '#f0b429', '#f4a7b9', '#2e8fb3']

const EXPERIENCE_ORDER = ['first_timer', 'some_experience', 'veteran']

const TICK_FILL = '#8e97ab'
const GRID_STROKE = '#262c3a'
const COHORT_FILL = '#eef2f7'

interface TrackDef {
  /** Stable chart data key, independent of the raw role track id. */
  key: string
  id: string
  label: string
  color: string
  count: number
}

interface CohortRow {
  cohort: string
  /** Active signups in this cohort (100% base). */
  total: number
  /** Per-track share of the cohort, as a percentage of `total`. */
  [key: string]: number | string
}

interface CompositionData {
  total: number
  rows: CohortRow[]
  tracks: TrackDef[]
}

function buildComposition(participants: Participant[], config: FormConfig): CompositionData {
  const active = participants.filter((p) => p.status === 'active')
  if (active.length === 0) return { total: 0, rows: [], tracks: [] }

  // Track order: form config first, then any stragglers in first-seen order.
  const seen = new Set<string>()
  const trackIds: string[] = []
  const pushId = (id: string) => {
    if (!seen.has(id)) {
      seen.add(id)
      trackIds.push(id)
    }
  }
  for (const t of config.roleTracks) pushId(t.id)
  for (const p of active) pushId(p.roleTrack)

  const tracks: TrackDef[] = trackIds.map((id, i) => ({
    key: `track${i}`,
    id,
    label: labelFor(config, 'roleTracks', id) || 'Unspecified',
    color: TRACK_PALETTE[i % TRACK_PALETTE.length]!,
    count: 0,
  }))
  const byId = new Map(tracks.map((t) => [t.id, t]))

  // Cohort rows: known experiences first, unknown ones appended in first-seen order.
  const cohortIds: string[] = [...EXPERIENCE_ORDER]
  for (const p of active) if (!cohortIds.includes(p.experience)) cohortIds.push(p.experience)

  const rows: CohortRow[] = []
  for (const cohortId of cohortIds) {
    const members = active.filter((p) => p.experience === cohortId)
    if (members.length === 0) continue

    const row: CohortRow = {
      cohort: labelFor(config, 'experiences', cohortId) || cohortId,
      total: members.length,
    }
    for (const t of tracks) row[t.key] = 0

    for (const m of members) {
      const track = byId.get(m.roleTrack)
      if (track === undefined) continue
      row[track.key] = (row[track.key] as number) + 1
      track.count += 1
    }

    // Normalise to 100% per cohort so rows are comparable as shares.
    for (const t of tracks) row[t.key] = ((row[t.key] as number) / members.length) * 100
    rows.push(row)
  }

  return { total: active.length, rows, tracks }
}

function CompositionTooltip({ active, payload, label }: TooltipContentProps) {
  if (!active || payload === undefined || payload.length === 0) return null
  const entries = payload.filter((e) => typeof e.value === 'number' && (e.value as number) > 0)
  if (entries.length === 0) return null
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs shadow-lg">
      <div className="font-semibold text-foreground">{String(label ?? '')}</div>
      <div className="mt-1 flex flex-col gap-1">
        {entries.map((e, i) => {
          const row = e.payload as CohortRow | undefined
          const pct = typeof e.value === 'number' ? e.value : 0
          const count = row === undefined ? Math.round(pct) : Math.round((pct * row.total) / 100)
          return (
            <div key={i} className="flex items-center gap-1.5">
              <span className="size-2 rounded-full" style={{ backgroundColor: e.color ?? TICK_FILL }} />
              <span className="text-muted-foreground">{String(e.name ?? '')}</span>
              <span className="font-semibold text-foreground">{count}</span>
              <span className="text-muted-foreground">({Math.round(pct)}%)</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function TeamComposition({
  participants,
  config,
}: {
  participants: Participant[]
  config: FormConfig
}) {
  const data = useMemo(() => buildComposition(participants, config), [participants, config])

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Team composition</CardTitle>
        <CardDescription>
          Active signups by role track, split by experience · {data.total} active
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.rows.length === 0 ? (
          <div className="grid h-60 place-items-center text-sm text-muted-foreground">
            No data yet
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart
                data={data.rows}
                layout="vertical"
                margin={{ top: 4, right: 16, bottom: 0, left: 0 }}
              >
                <CartesianGrid stroke={GRID_STROKE} strokeOpacity={0.5} horizontal={false} />
                <XAxis
                  type="number"
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tickFormatter={(v: number) => `${v}%`}
                  tick={{ fill: TICK_FILL, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: GRID_STROKE }}
                />
                <YAxis
                  type="category"
                  dataKey="cohort"
                  width={112}
                  tick={{ fill: COHORT_FILL, fontSize: 12, fontWeight: 600 }}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip content={CompositionTooltip} cursor={{ fill: 'rgba(85, 187, 218, 0.08)' }} />
                {data.tracks.map((t, i) => (
                  <Bar
                    key={t.key}
                    dataKey={t.key}
                    name={t.label}
                    stackId="tracks"
                    fill={t.color}
                    radius={i === data.tracks.length - 1 ? [0, 6, 6, 0] : 0}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {data.tracks.map((t) => (
                <span key={t.id} className="inline-flex items-center gap-1.5 text-xs">
                  <span className="size-2.5 rounded-[3px]" style={{ backgroundColor: t.color }} />
                  <span className="text-muted-foreground">{t.label}</span>
                  <span className="font-semibold text-foreground">{t.count}</span>
                  <span className="text-muted-foreground">
                    · {Math.round((t.count / data.total) * 100)}%
                  </span>
                </span>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
