import { useState } from 'react'
import { History } from 'lucide-react'
import type { AppState } from '@/types'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import { dateTime } from '@/lib/format'

export function AuditPanel({ state }: { state: AppState }) {
  const [query, setQuery] = useState('')

  const filtered = state.audit.filter((a) => {
    const q = query.trim().toLowerCase()
    if (q === '') return true
    return (
      a.action.toLowerCase().includes(q) ||
      a.actor.toLowerCase().includes(q) ||
      (a.target ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Audit log</CardTitle>
            <CardDescription>Every mutation, newest first (latest 100)</CardDescription>
          </div>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter actions…"
            className="w-52"
            aria-label="Filter audit log"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<History className="size-5" />}
            title="Nothing logged yet"
            description="Admin actions, signups and matching runs are recorded here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">When</th>
                  <th className="px-4 py-3 font-medium">Action</th>
                  <th className="px-4 py-3 font-medium">Actor</th>
                  <th className="hidden px-4 py-3 font-medium sm:table-cell">Target</th>
                  <th className="hidden px-4 py-3 font-medium md:table-cell">Details</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.id} className="border-b border-border last:border-0 hover:bg-surface-2/50">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted-foreground">
                      {dateTime(a.ts)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs">{a.action}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{a.actor}</td>
                    <td className="hidden px-4 py-2.5 font-mono text-xs text-muted-foreground sm:table-cell">
                      {a.target ?? '—'}
                    </td>
                    <td className="hidden max-w-72 truncate px-4 py-2.5 font-mono text-xs text-muted-foreground md:table-cell">
                      {a.details ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
