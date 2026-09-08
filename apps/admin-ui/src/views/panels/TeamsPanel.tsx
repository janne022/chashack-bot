import { useState } from 'react'
import { KeyRound, MoreHorizontal, Palette, Plus, RefreshCw, Settings2, Trash2, UsersRound } from 'lucide-react'
import { toast } from 'sonner'
import type { AppState, Team } from '@/types'
import { TEAM_COLOR_SWATCHES } from '@/types'
import { api } from '@/api'
import { useT } from '@/lib/i18n'
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
  const t = useT()
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<'public' | 'private'>('public')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [settingsTeam, setSettingsTeam] = useState<Team | null>(null)

  const teamSize = state.config.teamSize

  async function act(fn: () => Promise<void>, okMsg: string) {
    try {
      await fn()
      toast.success(okMsg)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('common.action_failed'))
    }
  }

  async function createTeam() {
    try {
      await api.createTeam(newName.trim(), newKind)
      toast.success(t('teams.created', { name: newName.trim() }))
      setCreateOpen(false)
      setNewName('')
      setNewKind('public')
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('teams.create_failed'))
    }
  }

  if (state.teams.length === 0) {
    return (
      <>
        <Card>
          <CardContent>
            <EmptyState
              icon={<UsersRound className="size-5" />}
              title={t('teams.none_title')}
              description={t('teams.none_desc')}
              action={
                <Button onClick={() => setCreateOpen(true)}>
                  <Plus />
                  {t('teams.create')}
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
        <p className="text-sm text-muted-foreground">{t('teams.count', { count: state.teams.length, size: teamSize })}</p>
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus />
          {t('teams.create')}
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {state.teams.map((team) => (
          <Card key={team.id} className="animate-fade-in">
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div className="flex min-w-0 items-start gap-3">
                <span
                  className="mt-1 size-3.5 shrink-0 rounded-full border border-border"
                  style={{ backgroundColor: TEAM_COLOR_SWATCHES.find((c) => c.id === team.colorId)?.hex ?? '#5865F2' }}
                  aria-hidden
                />
                <div className="min-w-0">
                  <CardTitle className="truncate">{team.name}</CardTitle>
                  <CardDescription className="flex items-center gap-2 pt-1">
                    <TeamKindBadge kind={team.kind} />
                    <span>{t('teams.members', { count: team.members.length, size: teamSize })}</span>
                    {team.joinCode !== null && (
                      <span className="flex items-center gap-1 font-mono text-xs">
                        <KeyRound className="size-3" />
                        {team.joinCode}
                      </span>
                    )}
                  </CardDescription>
                </div>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={t('common.actions_for', { name: team.name })}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {team.kind !== 'matched' && (
                    <DropdownMenuItem onSelect={() => setSettingsTeam(team)}>
                      <Settings2 />
                      {t('teams.rename_visibility_color')}
                    </DropdownMenuItem>
                  )}
                  {team.kind === 'private' && (
                    <DropdownMenuItem
                      onSelect={() =>
                        void act(
                          async () => {
                            const code = await api.rotateCode(team.id)
                            toast.info(t('teams.new_code', { code }), { duration: 8000 })
                          },
                          t('teams.code_rotated'),
                        )
                      }
                    >
                      <RefreshCw />
                      {t('teams.rotate_code')}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-danger data-[highlighted]:bg-danger/10"
                    onSelect={() => setDeleteTarget(team.id)}
                  >
                    <Trash2 />
                    {t('teams.delete_team')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardHeader>
            <CardContent>
              {team.members.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">{t('teams.empty')}</p>
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
                            t('teams.kicked', { name: m.displayName, team: team.name }),
                          )
                        }
                        aria-label={t('teams.remove_aria', { name: m.displayName, team: team.name })}
                      >
                        {t('teams.kick')}
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
            <AlertDialogTitle>{t('teams.delete_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('teams.delete_desc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const id = deleteTarget
                setDeleteTarget(null)
                if (id !== null) void act(() => api.deleteTeam(id), t('teams.deleted'))
              }}
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {settingsTeam !== null && (
        <TeamSettingsDialog
          team={settingsTeam}
          onClose={() => setSettingsTeam(null)}
          onSave={async (update) => {
            await act(
              async () => {
                await api.updateTeamSettings(settingsTeam.id, update)
              },
              t('teams.updated'),
            )
            setSettingsTeam(null)
          }}
        />
      )}
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
  const t = useT()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('teams.create_title')}</DialogTitle>
          <DialogDescription>
            {t('teams.create_desc')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="team-name">{t('teams.name')}</Label>
            <Input
              id="team-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t('teams.name_placeholder')}
              maxLength={60}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t('teams.type')}</Label>
            <Select value={newKind} onValueChange={(v) => setNewKind(v as 'public' | 'private')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">{t('teams.kind_public')}</SelectItem>
                <SelectItem value="private">{t('teams.kind_private')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void onCreate()} disabled={newName.trim().length < 3}>
            {t('common.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TeamSettingsDialog({
  team,
  onClose,
  onSave,
}: {
  team: Team
  onClose: () => void
  onSave: (update: { name?: string; kind?: 'public' | 'private'; colorId?: string | null }) => Promise<void>
}) {
  const t = useT()
  const [name, setName] = useState(team.name)
  const [kind, setKind] = useState<'public' | 'private'>(team.kind === 'private' ? 'private' : 'public')
  const [colorId, setColorId] = useState<string | null>(team.colorId)
  const [busy, setBusy] = useState(false)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('teams.settings')}</DialogTitle>
          <DialogDescription>
            {t('teams.settings_desc')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="settings-name">{t('teams.name')}</Label>
            <Input id="settings-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t('teams.visibility')}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as 'public' | 'private')}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">{t('teams.kind_public')}</SelectItem>
                <SelectItem value="private">{t('teams.kind_private')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label>
              <Palette className="mr-1 inline size-3.5" />
              {t('teams.role_color')}
            </Label>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('teams.role_color_aria')}>
              {TEAM_COLOR_SWATCHES.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={colorId === c.id}
                  aria-label={c.label}
                  onClick={() => setColorId(c.id)}
                  className={`size-7 rounded-full border-2 transition-transform hover:scale-110 ${
                    colorId === c.id ? 'border-foreground ring-2 ring-accent' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c.hex }}
                />
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={busy || name.trim().length < 3}
            onClick={() => {
              setBusy(true)
              void onSave({ name: name.trim(), kind, colorId }).finally(() => setBusy(false))
            }}
          >
            {t('teams.save_changes')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
