import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

type Registration = { eventId: string; name: string; description: string; startsAt: number | null; endsAt: number | null; status: string; teamId: string | null }
export const Route = createFileRoute('/my-hackathons')({ component: MyHackathons })
function MyHackathons() {
  const [items, setItems] = useState<Registration[] | null>(null)
  const [error, setError] = useState('')
  const load = async () => {
    setError('')
    try {
      const response = await fetch('/api/participant/registrations')
      if (response.status === 401) { location.assign('/auth/participant'); return }
      if (!response.ok) throw new Error('Could not load your hackathons.')
      setItems((await response.json() as { registrations: Registration[] }).registrations)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load your hackathons.') }
  }
  useEffect(() => { void load() }, [])
  return <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8"><header><h1 className="text-3xl font-bold">My hackathons</h1><p className="mt-2 text-muted-foreground">Events you have registered for with this Discord account.</p></header>
    {items === null ? error ? <section role="alert" className="space-y-3"><p>{error}</p><Button onClick={() => void load()}>Retry</Button></section> : <p aria-busy="true">Loading your hackathons…</p> : items.length === 0 ? <section className="rounded-xl border border-dashed p-6"><h2 className="text-lg font-semibold">No hackathons yet</h2><p className="mt-2 text-muted-foreground">Open an event’s signup page from your Discord server and register with your Discord account. You must be a current server member.</p><a href="/events" className="mt-4 inline-block text-accent underline">Browse event details</a></section> : <ul className="space-y-3">{items.map((item) => <li key={item.eventId} className="rounded-xl border p-4"><h2 className="text-lg font-semibold">{item.name}</h2><p className="mt-1 text-sm text-muted-foreground">{item.description}</p><p className="mt-3 text-sm">Registration: {item.status === 'active' ? 'Active' : item.status}</p><div className="mt-4 flex gap-4"><a className="text-accent underline" href={`/events/${encodeURIComponent(item.eventId)}/signup`}>View signup</a>{item.teamId && <a className="text-accent underline" href={`/team?eventId=${encodeURIComponent(item.eventId)}`}>View team</a>}</div></li>)}</ul>}
  </main>
}
