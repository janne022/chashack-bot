import { useState } from 'react'
import { Check, Sparkles, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import type { AppState, MatchResult } from '@/types'
import { api } from '@/api'
import { useT } from '@/lib/i18n'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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
import { labelFor } from '@/lib/labels'
import { timeAgo } from '@/lib/format'

export function MatchingPanel({ state, refresh }: { state: AppState; refresh: () => Promise<void> }) {
  const t = useT()
  const [preview, setPreview] = useState<MatchResult | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('matching.commit_failed'))
    } finally {
      setBusy(false)
    }
  }

  const candidates = state.stats.matchingOptIn

  return (
    <div className="flex flex-col gap-4">
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
