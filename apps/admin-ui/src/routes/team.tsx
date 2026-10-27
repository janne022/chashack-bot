import { ParticipantNavigation } from '@/components/participant-navigation'
import { PageSkeleton } from '@/components/ui/skeleton'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ParticipantFrame, type Appearance } from '@/components/participant-appearance'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { useT } from '@/lib/i18n'
import { LiveStatus, useLiveUpdates } from '@/lib/live-updates'
import { publicEventQuery } from '@/lib/public-event'

export const Route = createFileRoute('/team')({ component: TeamPage })
type Team = { id: string; name: string; memberCount: number; kind: string; ownerId?: string; joinCode?: string; members?: { userId: string; displayName: string }[] }
type TeamList = { teams: Team[]; ownTeam: Team | null; invitations: { id: number; teamId: string; requesterId: string; kind: 'invite' | 'join_request' }[] }
const DEFAULT_APPEARANCE: Appearance = { themePreset: 'default', accentColor: '#55bbda', bannerUrl: null }
function TeamPage() {
  const t = useT()
  const eventId = new URLSearchParams(location.search).get('eventId') ?? ''
  // The event name and theme come from the same cached read as the signup page.
  const publicEvent = useQuery({ ...publicEventQuery(eventId), enabled: eventId !== '' })
  const eventName = publicEvent.data?.event.name ?? ''
  const appearance = publicEvent.data?.form.appearance ?? DEFAULT_APPEARANCE
  const [data, setData] = useState<TeamList | null>(null)
  const [name, setName] = useState('')
  const [targetId, setTargetId] = useState('')
  const [error, setError] = useState('')
  const [waiting, setWaiting] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const base = `/api/participant/events/${encodeURIComponent(eventId)}`
  const load = async (signal?: AbortSignal) => {
    if (!eventId) { setError(t('participant.team_no_event')); return }
    setError('')
    try {
      const response = await fetch(`${base}/teams`, signal ? { signal } : undefined)
      if (signal?.aborted) return
      if (response.status === 401) { location.assign('/auth/participant'); return }
      if (!response.ok) throw new Error(response.status === 404 ? t('participant.team_complete') : t('participant.team_conflict'))
      const value = await response.json() as TeamList
      if (!signal?.aborted) setData(value)
    } catch (e) { if (!signal?.aborted) setError(e instanceof Error ? e.message : t('participant.my_error')) }
  }
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [eventId])
  const live = useLiveUpdates(eventId ? `${base}/live` : null, load)
  const mutate = async (path: string, method: string, body?: object) => {
    setWaiting(true); setError('')
    try {
      const response = await fetch(`${base}${path}`, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error === 'team_full' ? t('participant.team_full') : result.error === 'already_in_team' ? t('participant.team_complete') : t('participant.team_conflict'))
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : t('participant.team_mutation_failed')) }
    finally { setWaiting(false) }
  }
  const create = async (e: FormEvent) => { e.preventDefault(); if (name.trim()) await mutate('/teams', 'POST', { name: name.trim(), kind: 'public' }) }
  return <ParticipantFrame appearance={appearance}><ParticipantNavigation eventId={eventId} active="team" /><div className="mx-auto max-w-4xl space-y-6 [&_button]:min-h-11 [&_input]:min-h-11"><header className="space-y-3"><p className="text-sm font-medium opacity-65">{eventName}</p><h1 className="participant-title">{t('participant.team_title')}</h1><p className="text-muted-foreground">{t('participant.team_desc')}</p></header>
    <LiveStatus {...live} />
    {error && <section role="alert" className="space-y-3"><p>{error}</p><Button variant="outline" onClick={() => void load()}>{t('participant.team_refresh')}</Button></section>}
    {!data ? !error && <PageSkeleton /> : data.ownTeam ? <section className="participant-team-create"><h2 className="text-lg font-semibold">{data.ownTeam.name}</h2><p className="mt-2 text-sm">{t('participant.team_members', { count: data.ownTeam.memberCount, kind: data.ownTeam.kind })}</p><ul className="mt-5 grid gap-3 sm:grid-cols-2">{data.ownTeam.members?.map(member => <li key={member.userId} className="flex items-center gap-3 rounded-xl border p-3"><span className="grid size-10 shrink-0 place-items-center rounded-full border text-sm font-semibold" aria-hidden="true">{member.displayName.slice(0, 2).toUpperCase()}</span><div><p className="font-medium">{member.displayName}</p><p className="text-xs opacity-65">{member.userId === data.ownTeam?.ownerId ? t('participant.team_owner') : t('participant.team_member')}</p></div></li>)}</ul><Button className="mt-4" variant="outline" disabled={waiting} onClick={() => setConfirmLeave(true)}>{t('participant.team_leave')}</Button><form className="mt-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (targetId.trim()) void mutate(`/teams/${encodeURIComponent(data.ownTeam!.id)}/invites`, 'POST', { targetId: targetId.trim() }) }}><label htmlFor="invite-id" className="sr-only">{t('participant.invite_id')}</label><Input id="invite-id" value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder={t('participant.invite_id')} required/><Button disabled={waiting}>{t('participant.invite_send')}</Button></form></section> : <><section className="participant-team-create"><h2 className="text-xl font-semibold">{t('participant.team_workspace')}</h2><p className="mb-5 mt-2 text-sm opacity-75">{t('participant.team_create_hint')}</p><form className="flex flex-wrap gap-3" onSubmit={(e) => void create(e)}><label className="sr-only" htmlFor="team-name">{t('participant.team_name')}</label><Input id="team-name" value={name} onChange={(e) => setName(e.target.value)} minLength={3} maxLength={60} placeholder={t('participant.team_name')} required/><Button disabled={waiting}>{waiting ? t('participant.team_save') : t('participant.team_create')}</Button></form></section><h2 className="text-xl font-semibold">{t('participant.team_browse')}</h2>{data.teams.length === 0 ? <section className="rounded-xl border border-dashed p-6"><h2 className="font-semibold">{t('participant.team_empty')}</h2><p className="mt-2 text-muted-foreground">{t('participant.team_empty_desc')}</p><Button className="mt-3" variant="outline" disabled={waiting} onClick={() => void load()}>{t('participant.team_refresh')}</Button></section> : <ul className="space-y-3">{data.teams.map((team) => <li key={team.id} className="flex items-center justify-between gap-3 rounded-xl border p-4"><div><h2 className="font-semibold">{team.name}</h2><p className="text-sm text-muted-foreground">{t('participant.team_member_count', { count: team.memberCount })}</p></div><Button disabled={waiting} onClick={() => void mutate(`/teams/${encodeURIComponent(team.id)}/join`, 'POST')}>{t('participant.team_join')}</Button></li>)}</ul>}</>}
    {data?.invitations.length ? <section className="space-y-3"><h2 className="text-lg font-semibold">{t('participant.invites')}</h2>{data.invitations.filter((invite) => invite.kind === 'invite').map((invite) => <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><p>{t('participant.team_invitation_from', { id: invite.requesterId })}</p><div className="flex gap-2"><Button disabled={waiting} onClick={() => void mutate(`/invitations/${invite.id}/respond`, 'POST', { decision: 'accept' })}>{t('participant.accept')}</Button><Button variant="outline" disabled={waiting} onClick={() => void mutate(`/invitations/${invite.id}/respond`, 'POST', { decision: 'decline' })}>{t('participant.decline')}</Button></div></div>)}</section> : null}
    {waiting && <p role="status" aria-live="polite">{t('participant.team_updating')}</p>}
    <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('participant.team_leave_title', { name: data?.ownTeam?.name ?? '' })}</AlertDialogTitle><AlertDialogDescription>{t('participant.team_leave_desc', { name: data?.ownTeam?.name ?? '' })}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel><AlertDialogAction onClick={() => { setConfirmLeave(false); void mutate('/team', 'DELETE') }}>{t('participant.team_leave')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div></ParticipantFrame>
}
