import { useState } from 'react'
import { Check, Sparkles, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import type { AppState, MatchResult } from '@/types'
import { api } from '@/api'
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
  const [preview, setPreview] = useState<MatchResult | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  async function runPreview() {
    setBusy(true)
    try {
      const result = await api.matchPreview()
      setPreview(result)
      toast.success(`${result.teams.length} teams drafted`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Preview failed')
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
      toast.success(`${result.teams.length} teams committed and announced`)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Commit failed')
    } finally {
      setBusy(false)
    }
  }

  const candidates = state.stats.matchingOptIn

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Compatibility matching</CardTitle>
          <CardDescription>
            Builds teams from unteamed participants who opted into matching. Mutual friend requests are
            kept together; scores blend role complementarity, skill overlap/diversity and experience mix.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-4">
          <div className="text-sm">
            <div className="text-2xl font-bold">{candidates}</div>
            <div className="text-xs text-muted-foreground">participants ready to match</div>
          </div>
          <div className="ml-auto flex gap-2">
            {preview !== null && (
              <Button variant="outline" onClick={() => setPreview(null)}>
                Discard draft
              </Button>
            )}
            <Button onClick={() => void runPreview()} disabled={busy || candidates < 2}>
              <Sparkles />
              {preview !== null ? 'Re-run preview' : 'Preview match'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {state.lastMatch !== null && (
        <p className="text-xs text-muted-foreground">
          Last committed match: {state.lastMatch.teams} teams · {timeAgo(state.lastMatch.at)}
        </p>
      )}

      {preview === null ? (
        candidates < 2 ? (
          <Card>
            <CardContent>
              <EmptyState
                icon={<Sparkles className="size-5" />}
                title={candidates === 0 ? 'Nobody to match yet' : 'Need one more participant'}
                description={
                  candidates === 0
                    ? 'Participants who pick “match me into a team” in the signup form appear here.'
                    : 'Matching needs at least 2 participants who opted in and have no team.'
                }
              />
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent>
              <EmptyState
                icon={<Sparkles className="size-5" />}
                title="Ready when you are"
                description="Run a preview to draft teams. Nothing is saved until you commit."
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
                      <p className="text-xs text-muted-foreground">mixed experience levels</p>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <div className="flex justify-end">
            <Button size="lg" onClick={() => setConfirmOpen(true)}>
              <Check />
              Commit these teams
            </Button>
          </div>

          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Commit {preview.teams.length} teams?</AlertDialogTitle>
                <AlertDialogDescription>
                  Previous matched teams are dissolved, these become permanent, and the lineups are
                  announced in Discord. You can re-run matching later if people drop.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Back</AlertDialogCancel>
                <AlertDialogAction onClick={() => void commit()}>Commit & announce</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  )
}
