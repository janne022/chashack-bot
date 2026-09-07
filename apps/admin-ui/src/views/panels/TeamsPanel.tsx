import { useState } from 'react'
import { KeyRound, MoreHorizontal, Plus, RefreshCw, Trash2, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import type { AppState } from '@/types'
import { api } from '@/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { Input, Label } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { EmptyState } from '@/components/ui/empty-state'
import { TeamKindBadge, labelFor } from '@/lib/labels'
import { cn } from '@/lib/utils'

export function TeamsPanel({ state, refresh }: { state: AppState; refresh: () => Promise<void> }) {
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<'public' | 'private'>('public')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)

  const teamSize = state.config.teamSize

  async function act(fn: () => Promise<void>, okMsg: string) {
    try {
      await fn()
      toast.success(okMsg)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Action failed')
    }
  }

  async function createTeam() {
    try {
      await api.createTeam(newName.trim(), newKind)
      toast.success(`Team “${newName.trim()}” created`)
      setCreateOpen(false)
      setNewName('')
      setNewKind('public')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create team')
    }
  }

  if (state.teams.length === 0) {
    return (
      <>
        <Card>
          <CardContent>
            <EmptyState
              icon={<UsersRound className="size-5" />}
              title="No teams yet"
              description="Teams appear here when participants create them, or when you run matching."
              action={
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus />
                  Create team
                </Button>
              }
            />
          </CardContent>
        </Card>
        <CreateTeamDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          newName={newName}
          setNewName={setNewName}
          newKind={newKind}
          setNewKind={setNewKind}
          onCreate={createTeam}
        />
      </>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {state.teams.length} team{state.teams.length === 1 ? '' : 's'} · team size limit {teamSize}
        </p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus />
          Create team
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {state.teams.map((team) => (
          <Card key={team.id} className="animate-fade-in">
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div className="min-w-0">
                <CardTitle className="truncate">{team.name}</CardTitle>
                <CardDescription className="flex items-center gap-2 pt-1">
                  <TeamKindBadge kind={team.kind} />
                  <span>
                    {team.members.length}/{teamSize} members
                  </span>
                  {team.joinCode !== null && (
                    <span className="flex items-center gap-1 font-mono text-xs">
                      <KeyRound className="size-3" />
                      {team.joinCode}
                    </span>
                  )}
                </CardDescription>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={`Actions for ${team.name}`}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {team.kind === 'private' && (
                    <DropdownMenuItem
                      onSelect={() =>
                        void act(
                          async () => {
                            const code = await api.rotateCode(team.id)
                            toast.info(`New code: ${code}`, { duration: 8000 })
                          },
                          'Join code rotated',
                        )
                      }
                    >
                      <RefreshCw />
                      Rotate join code
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-danger data-[highlighted]:bg-danger/10"
                    onSelect={() => setDeleteTarget(team.id)}
                  >
                    <Trash2 />
                    Delete team
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardHeader>
            <CardContent>
              {team.members.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">Empty — nobody has joined yet.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {team.members.map((m) => (
                    <li
                      key={m.userId}
                      className="flex items-center justify-between gap-2 rounded-lg bg-surface-2/60 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{m.displayName}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {labelFor(state.config, 'roleTracks', m.roleTrack)}
                          {m.skills.length > 0 && ` · ${m.skills.map((s) => labelFor(state.config, 'skills', s)).join(', ')}`}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        className={cn('shrink-0 text-xs text-muted-foreground hover:text-danger')}
                        onClick={() =>
                          void act(
                            () => api.removeMember(team.id, m.userId),
                            `${m.displayName} removed from ${team.name}`,
                          )
                        }
                        aria-label={`Remove ${m.displayName} from ${team.name}`}
                      >
                        Kick
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <CreateTeamDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        newName={newName}
        setNewName={setNewName}
        newKind={newKind}
        setNewKind={setNewKind}
        onCreate={createTeam}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete team?</AlertDialogTitle>
            <AlertDialogDescription>
              Members stay signed up but become unteamed. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = deleteTarget
                setDeleteTarget(null)
                if (id !== null) void act(() => api.deleteTeam(id), 'Team deleted')
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function CreateTeamDialog({
  open,
  onOpenChange,
  newName,
  setNewName,
  newKind,
  setNewKind,
  onCreate,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  newName: string
  setNewName: (v: string) => void
  newKind: 'public' | 'private'
  setNewKind: (v: 'public' | 'private') => void
  onCreate: () => Promise<void>
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a team</DialogTitle>
          <DialogDescription>
            Public teams show up in /hackathon teams for anyone to join. Private teams need a join code.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="team-name">Team name</Label>
            <Input
              id="team-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Compiler Crashers"
              maxLength={60}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>Type</Label>
            <Select value={newKind} onValueChange={(v) => setNewKind(v as 'public' | 'private')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Public — listed for others</SelectItem>
                <SelectItem value="private">Private — join code only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void onCreate()} disabled={newName.trim().length < 3}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
