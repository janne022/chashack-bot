import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ParticipantFrame, type Appearance } from '@/components/participant-appearance'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { useT } from '@/lib/i18n'
import { LiveStatus, useLiveUpdates } from '@/lib/live-updates'

export const Route = createFileRoute('/team')({ component: TeamPage })
type Team = { id: string; name: string; memberCount: number; kind: string; ownerId?: string; joinCode?: string }
type TeamList = { teams: Team[]; ownTeam: Team | null; invitations: { id: number; teamId: string; requesterId: string; kind: 'invite' | 'join_request' }[] }
function TeamPage() {
  const t = useT()
  const eventId = new URLSearchParams(location.search).get('eventId') ?? ''
  const [data, setData] = useState<TeamList | null>(null)
  const [eventName, setEventName] = useState('')
  const [appearance, setAppearance] = useState<Appearance>({ themePreset: 'default', accentColor: '#55bbda', bannerUrl: null })
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
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); if (eventId) void fetch(`/api/public/events/${encodeURIComponent(eventId)}`, { signal: controller.signal }).then(r => r.ok ? r.json() : null).then(value => { if (!controller.signal.aborted && value) { setEventName(value.event.name); setAppearance(value.form.appearance) } }).catch(() => undefined); return () => controller.abort() }, [eventId])
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
  return <ParticipantFrame appearance={appearance}><div className="mx-auto max-w-3xl space-y-6 [&_button]:min-h-11 [&_input]:min-h-11"><header className="space-y-3"><nav className="flex flex-wrap gap-2" aria-label={t('participant.signup_navigation')}>{eventName && <><Button asChild variant="outline" className="min-h-11"><a href={'/events/' + encodeURIComponent(eventId)}>{eventName}</a></Button><Button asChild variant="outline" className="min-h-11"><a href={`/events/${encodeURIComponent(eventId)}/signup`}>{t('participant.view_signup')}</a></Button></>}</nav><h1 className="text-3xl font-bold">{t('participant.team_title')}</h1><p className="text-muted-foreground">{t('participant.team_desc')}</p></header>
    <LiveStatus {...live} />
    {error && <section role="alert" className="space-y-3"><p>{error}</p><Button variant="outline" onClick={() => void load()}>{t('participant.team_refresh')}</Button></section>}
    {!data ? !error && <p aria-busy="true">{t('participant.team_loading')}</p> : data.ownTeam ? <section className="rounded-xl border p-5"><h2 className="text-lg font-semibold">{data.ownTeam.name}</h2><p className="mt-2 text-sm">{t('participant.team_members', { count: data.ownTeam.memberCount, kind: data.ownTeam.kind })}</p><Button className="mt-4" variant="outline" disabled={waiting} onClick={() => setConfirmLeave(true)}>{t('participant.team_leave')}</Button><form className="mt-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (targetId.trim()) void mutate(`/teams/${encodeURIComponent(data.ownTeam!.id)}/invites`, 'POST', { targetId: targetId.trim() }) }}><label htmlFor="invite-id" className="sr-only">{t('participant.invite_id')}</label><Input id="invite-id" value={targetId} onChange={(e) => setTargetId(e.target.value)} placeholder={t('participant.invite_id')} required/><Button disabled={waiting}>{t('participant.invite_send')}</Button></form></section> : <><form className="flex flex-wrap gap-2" onSubmit={(e) => void create(e)}><label className="sr-only" htmlFor="team-name">{t('participant.team_name')}</label><Input id="team-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t('participant.team_name')} required/><Button disabled={waiting}>{waiting ? t('participant.team_save') : t('participant.team_create')}</Button></form>{data.teams.length === 0 ? <section className="rounded-xl border border-dashed p-6"><h2 className="font-semibold">{t('participant.team_empty')}</h2><p className="mt-2 text-muted-foreground">{t('participant.team_empty_desc')}</p><Button className="mt-3" variant="outline" disabled={waiting} onClick={() => void load()}>{t('participant.team_refresh')}</Button></section> : <ul className="space-y-3">{data.teams.map((team) => <li key={team.id} className="flex items-center justify-between gap-3 rounded-xl border p-4"><div><h2 className="font-semibold">{team.name}</h2><p className="text-sm text-muted-foreground">{t('participant.team_member_count', { count: team.memberCount })}</p></div><Button disabled={waiting} onClick={() => void mutate(`/teams/${encodeURIComponent(team.id)}/join`, 'POST')}>{t('participant.team_join')}</Button></li>)}</ul>}</>}
    {data?.invitations.length ? <section className="space-y-3"><h2 className="text-lg font-semibold">{t('participant.invites')}</h2>{data.invitations.filter((invite) => invite.kind === 'invite').map((invite) => <div key={invite.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"><p>{t('participant.team_invitation_from', { id: invite.requesterId })}</p><div className="flex gap-2"><Button disabled={waiting} onClick={() => void mutate(`/invitations/${invite.id}/respond`, 'POST', { decision: 'accept' })}>{t('participant.accept')}</Button><Button variant="outline" disabled={waiting} onClick={() => void mutate(`/invitations/${invite.id}/respond`, 'POST', { decision: 'decline' })}>{t('participant.decline')}</Button></div></div>)}</section> : null}
    {waiting && <p role="status" aria-live="polite">{t('participant.team_updating')}</p>}
    <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('participant.team_leave_title', { name: data?.ownTeam?.name ?? '' })}</AlertDialogTitle><AlertDialogDescription>{t('participant.team_leave_desc', { name: data?.ownTeam?.name ?? '' })}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel><AlertDialogAction onClick={() => { setConfirmLeave(false); void mutate('/team', 'DELETE') }}>{t('participant.team_leave')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div></ParticipantFrame>
}
