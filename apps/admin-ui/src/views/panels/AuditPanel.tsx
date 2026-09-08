import { useState } from 'react'
import { History } from 'lucide-react'
import type { AppState } from '@/types'
import { useT } from '@/lib/i18n'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import { dateTime } from '@/lib/format'

export function AuditPanel({ state }: { state: AppState }) {
  const t = useT()
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
            <CardTitle>{t('audit.title')}</CardTitle>
            <CardDescription>{t('audit.desc')}</CardDescription>
          </div>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('audit.filter_placeholder')}
            className="w-52"
            aria-label={t('audit.filter_aria')}
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<History className="size-5" />}
            title={t('audit.none_title')}
            description={t('audit.none_desc')}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">{t('audit.col_when')}</th>
                  <th className="px-4 py-3 font-medium">{t('audit.col_action')}</th>
                  <th className="px-4 py-3 font-medium">{t('audit.col_actor')}</th>
                  <th className="hidden px-4 py-3 font-medium sm:table-cell">{t('audit.col_target')}</th>
                  <th className="hidden px-4 py-3 font-medium md:table-cell">{t('audit.col_details')}</th>
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
