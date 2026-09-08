import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useT } from '@/lib/i18n'
import type { Participant } from '@/types'

const SKY = '#55bbda'
const TICK_FILL = '#8e97ab'
const GRID_STROKE = '#262c3a'

interface DayPoint {
  /** Local-day start (ms) — used for ordering / prev-day math only. */
  ts: number
  /** Short day label for the x axis, e.g. "Sep 8". */
  label: string
  /** Cumulative number of signups up to and including this day. */
  count: number
}

/** Start of the local day (midnight) for a timestamp. */
function localMidnight(ts: number): number {
  const d = new Date(ts)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function dayLabel(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/**
 * Buckets every signup by the local day of its createdAt, then walks day by day
 * (calendar-safe, DST-proof) from the first signup through today, carrying the
 * cumulative count forward. Empty participant lists yield [].
 */
function buildTimeline(participants: Participant[]): DayPoint[] {
  const created = participants.map((p) => p.createdAt).sort((a, b) => a - b)
  if (created.length === 0) return []

  const perDay = new Map<number, number>()
  for (const ts of created) {
    const day = localMidnight(ts)
    perDay.set(day, (perDay.get(day) ?? 0) + 1)
  }

  const end = localMidnight(Date.now())
  const from = Math.min(localMidnight(created[0]!), end)

  const points: DayPoint[] = []
  const cursor = new Date(from)
  let cumulative = 0
  while (cursor.getTime() <= end) {
    const key = cursor.getTime()
    cumulative += perDay.get(key) ?? 0
    points.push({ ts: key, label: dayLabel(key), count: cumulative })
    cursor.setDate(cursor.getDate() + 1)
  }

  // A single-point series renders no visible area — anchor it with a zero day.
  if (points.length === 1) {
    const prev = new Date(points[0]!.ts)
    prev.setDate(prev.getDate() - 1)
    points.unshift({ ts: prev.getTime(), label: dayLabel(prev.getTime()), count: 0 })
  }

  return points
}

function TimelineTooltip({ active, payload, label }: TooltipContentProps) {
  const t = useT()
  if (!active || payload === undefined || payload.length === 0) return null
  const value = payload[0]?.value
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs shadow-lg">
      <div className="font-semibold text-foreground">{String(label ?? '')}</div>
      <div className="mt-0.5 text-accent">{t('charts.signups_count', { count: Number(value ?? 0) })}</div>
    </div>
  )
}

export function SignupsTimeline({ participants }: { participants: Participant[] }) {
  const t = useT()
  const points = useMemo(() => buildTimeline(participants), [participants])

  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>{t('charts.signups_over_time')}</CardTitle>
        <CardDescription>
          {t('charts.signups_desc', { count: participants.length })}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {points.length === 0 ? (
          <div className="grid h-60 place-items-center text-sm text-muted-foreground">
            {t('common.no_data_yet')}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="signupsFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SKY} stopOpacity={0.32} />
                  <stop offset="100%" stopColor={SKY} stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID_STROKE} strokeOpacity={0.5} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: TICK_FILL, fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: GRID_STROKE }}
                minTickGap={32}
                interval="preserveStartEnd"
              />
              <YAxis
                width={38}
                allowDecimals={false}
                tick={{ fill: TICK_FILL, fontSize: 11 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip content={TimelineTooltip} cursor={{ stroke: GRID_STROKE, strokeDasharray: '3 3' }} />
              <Area
                type="monotone"
                dataKey="count"
                name={t('charts.signups')}
                stroke={SKY}
                strokeWidth={2}
                fill="url(#signupsFill)"
                dot={false}
                activeDot={{ r: 4, fill: SKY, stroke: '#0a0c10', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
