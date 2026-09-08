import { useState } from 'react'
import { Activity, FolderTree, Filter, RefreshCw, UserPlus, Users, UsersRound, Zap } from 'lucide-react'
import { toast } from 'sonner'
import type { TabId } from '@/types-dashboard'
import type { AppState } from '@/types'
import { api } from '@/api'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input, Label } from '@/components/ui/input'
import { dateTime, timeAgo } from '@/lib/format'

export function OverviewPanel({
  state,
  refresh,
  go,
}: {
  state: AppState
  refresh: () => Promise<void>
  go: (tab: TabId) => void
}) {
  const { stats, audit } = state
  const [categoryId, setCategoryId] = useState(state.guildSettings.teamCategoryId ?? '')

  async function saveCategory() {
    try {
      await api.setGuildCategory(categoryId.trim() === '' ? null : categoryId.trim())
      toast.success('Team channel category saved')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Save failed')
    }
  }

  async function resetEvent() {
    try {
      await api.resetEvent()
      toast.success('Event reset — all signups and teams cleared')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reset failed')
    }
  }

  const statCards = [
    { label: 'Active signups', value: stats.active, icon: Users },
    { label: 'Unteamed', value: stats.unteamed, icon: UserPlus },
    { label: 'Matching opt-ins', value: stats.matchingOptIn, icon: Zap },
    { label: 'Teams', value: stats.teams, icon: UsersRound },
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {statCards.map(({ label, value, icon: Icon }) => (
          <Card key={label} className="animate-fade-in">
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                <Icon className="size-5" />
              </div>
              <div className="min-w-0">
                <div className="text-2xl font-bold leading-none">{value}</div>
                <div className="mt-1 truncate text-xs text-muted-foreground">{label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {stats.blocked > 0 && (
        <Card className="border-danger/40 bg-danger/5">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-2 text-sm">
              <Filter className="size-4 text-danger" />
              <span>
                <strong>{stats.blocked}</strong> blocked signup{stats.blocked === 1 ? '' : 's'}
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={() => go('participants')}>
              Review
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription>Latest changes across the event</CardDescription>
          </CardHeader>
          <CardContent>
            {audit.length === 0 ? (
              <EmptyState
                icon={<Activity className="size-5" />}
                title="No activity yet"
                description="Actions will show up here as people sign up and teams form."
              />
            ) : (
              <ul className="flex flex-col">
                {audit.slice(0, 8).map((a) => (
                  <li key={a.id} className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-0">
                    <div className="min-w-0 text-sm">
                      <span className="font-medium">{a.action}</span>
                      {a.target !== null && a.target !== a.action && (
                        <span className="text-muted-foreground"> · {a.target}</span>
                      )}
                    </div>
                    <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(a.ts)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Event</CardTitle>
            <CardDescription>Team space category & danger zone</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="team-category" className="flex items-center gap-1.5 text-sm">
                <FolderTree className="size-3.5" />
                Team channel category ID
              </Label>
              <div className="flex gap-2">
                <Input
                  id="team-category"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  placeholder="Discord category ID (empty = top level)"
                />
                <Button variant="secondary" onClick={() => void saveCategory()}>
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                New teams get a private text + voice channel under this category.
              </p>
            </div>
            {state.lastMatch !== null ? (
              <p className="text-sm text-muted-foreground">
                Last match: {state.lastMatch.teams} teams, {timeAgo(state.lastMatch.at)} ({dateTime(state.lastMatch.at)})
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Matching has not been run yet.</p>
            )}
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive">
                  <RefreshCw />
                  Reset event
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Reset the whole event?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes all signups and teams. The form configuration is kept.
                    People would need to sign up again.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={() => void resetEvent()}>Yes, reset</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
