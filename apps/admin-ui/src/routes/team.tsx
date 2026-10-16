import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export const Route = createFileRoute('/team')({ component: TeamPage })
type Team = { id: string; name: string; memberCount: number; kind: string }
type TeamList = { teams: Team[]; ownTeam: Team | null; invitations: { id: number; teamId: string; teamName?: string }[] }
function TeamPage() {
  const eventId = new URLSearchParams(location.search).get('eventId') ?? ''
  const [data, setData] = useState<TeamList | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [waiting, setWaiting] = useState(false)
  const base = `/api/participant/events/${encodeURIComponent(eventId)}`
  const load = async () => {
    if (!eventId) { setError('Open teams from a completed event registration.'); return }
    setError('')
    try {
      const response = await fetch(`${base}/teams`)
      if (response.status === 401) { location.assign('/auth/participant'); return }
      if (!response.ok) throw new Error(response.status === 404 ? 'Complete your event registration before joining a team.' : 'Could not load teams.')
      setData(await response.json() as TeamList)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load teams.') }
  }
  useEffect(() => { void load() }, [eventId])
  const mutate = async (path: string, method: string, body?: object) => {
    setWaiting(true); setError('')
    try {
      const response = await fetch(`${base}${path}`, { method, ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error === 'team_full' ? 'That team is full. Choose another team.' : result.error === 'already_in_team' ? 'Leave your current team before joining another.' : 'That team changed. Refresh and try again.')
      await load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not update your team.') }
    finally { setWaiting(false) }
  }
  const create = async (e: FormEvent) => { e.preventDefault(); if (name.trim()) await mutate('/teams', 'POST', { name: name.trim(), kind: 'public' }) }
  return <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8"><header><a href="/my-hackathons" className="text-sm text-accent underline">My hackathons</a><h1 className="mt-3 text-3xl font-bold">Your team</h1><p className="mt-2 text-muted-foreground">Create a team, or join an open team for this hackathon.</p></header>
    {error && <section role="alert" className="space-y-3"><p>{error}</p><Button variant="outline" onClick={() => void load()}>Refresh teams</Button></section>}
    {!data ? !error && <p aria-busy="true">Loading teams…</p> : data.ownTeam ? <section className="rounded-xl border p-5"><h2 className="text-lg font-semibold">{data.ownTeam.name}</h2><p className="mt-2 text-sm">{data.ownTeam.memberCount} members · {data.ownTeam.kind} team</p><Button className="mt-4" variant="outline" disabled={waiting} onClick={() => void mutate('/team', 'DELETE')}>Leave team</Button></section> : <><form className="flex flex-wrap gap-2" onSubmit={(e) => void create(e)}><label className="sr-only" htmlFor="team-name">New team name</label><Input id="team-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Team name" required/><Button disabled={waiting}>{waiting ? 'Saving…' : 'Create team'}</Button></form>{data.teams.length === 0 ? <section className="rounded-xl border border-dashed p-6"><h2 className="font-semibold">No open teams</h2><p className="mt-2 text-muted-foreground">Create a team or check back later.</p></section> : <ul className="space-y-3">{data.teams.map((team) => <li key={team.id} className="flex items-center justify-between gap-3 rounded-xl border p-4"><div><h2 className="font-semibold">{team.name}</h2><p className="text-sm text-muted-foreground">{team.memberCount} members</p></div><Button disabled={waiting} onClick={() => void mutate(`/teams/${encodeURIComponent(team.id)}/join`, 'POST')}>Join team</Button></li>)}</ul>}</>}
    {waiting && <p role="status" aria-live="polite">Updating team…</p>}
  </main>
}
