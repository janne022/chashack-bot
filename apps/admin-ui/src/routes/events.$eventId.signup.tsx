import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Localized = string | { en: string; sv?: string }
type EventForm = { event: { id: string; name: string; description: string }; form: { version: number; title: string; description: string; questions: { id: string; label: Localized; kind: string; required?: boolean; choices?: { id: string; label: Localized }[] }[] } }
type Registration = { answers: Record<string, string | string[]>; complete: boolean; missingRequiredQuestionIds: string[]; status: string }
export const Route = createFileRoute('/events/$eventId/signup')({ component: Signup })

function Signup() {
  const { eventId } = Route.useParams()
  const [event, setEvent] = useState<EventForm | null>(null)
  const [registration, setRegistration] = useState<Registration | null>(null)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [state, setState] = useState<'loading' | 'idle' | 'waiting' | 'failed'>('loading')
  const [message, setMessage] = useState('')
  const language = localStorage.getItem('chas-locale') === 'sv' ? 'sv' : 'en'
  const label = (value: Localized) => typeof value === 'string' ? value : value[language] || value.en

  const load = async () => {
    setState('loading')
    try {
      const res = await fetch(`/api/public/events/${encodeURIComponent(eventId)}`)
      if (!res.ok) throw new Error('This event is not available.')
      setEvent(await res.json() as EventForm)
      const saved = await fetch(`/api/participant/events/${encodeURIComponent(eventId)}/registration`)
      if (saved.ok) {
        const value = await saved.json() as Registration
        setRegistration(value); setAnswers(value.answers)
      } else if (saved.status === 404) setMessage('You must be a current member of this event’s Discord server to register.')
      else if (saved.status !== 401) throw new Error('Could not load your registration. Try again.')
      setState('idle')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load signup.'); setState('failed') }
  }
  useEffect(() => { void load() }, [eventId])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!event) return
    const missing = event.form.questions.filter((q) => { const answer = answers[q.id]; return q.required && !(Array.isArray(answer) ? answer.length : typeof answer === 'string' && answer.trim()) }).map((q) => q.id)
    if (missing.length) {
      setRegistration({ answers, complete: false, missingRequiredQuestionIds: missing, status: registration?.status ?? 'not_registered' })
      setMessage('Complete the required answers before continuing.')
      document.getElementById(missing[0]!)?.focus()
      return
    }
    setState('waiting'); setMessage('')
    try {
      const res = await fetch(`/api/participant/events/${encodeURIComponent(eventId)}/registration`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ formVersion: event.form.version, answers }) })
      const value = await res.json() as Registration & { error?: string }
      if (res.status === 401) { location.assign('/auth/participant'); return }
      if (res.status === 404) throw new Error('You must be a current member of this event’s Discord server to register.')
      if (!res.ok) { setRegistration({ ...value, answers, complete: false, status: registration?.status ?? 'not_registered' }); setMessage(value.error === 'stale_form_version' ? 'The signup form changed. Reload it before submitting.' : 'Check required answers and try again.'); setState('failed'); return }
      setRegistration(value); setMessage('Your registration is saved.'); setState('idle')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Your registration was not saved. Try again.'); setState('failed') }
  }
  if (!event) return <main className="mx-auto max-w-2xl space-y-4 p-6">{state === 'loading' ? <p aria-busy="true">Loading event…</p> : <><p role="alert">{message}</p><Button onClick={() => void load()}>Retry</Button></>}</main>
  return <main className="mx-auto max-w-2xl space-y-6 p-4 sm:p-8"><header><a href={`/events/${encodeURIComponent(eventId)}`} className="text-sm text-accent">Event details</a><h1 className="mt-3 text-3xl font-bold">{event.form.title || event.event.name}</h1><p className="mt-2 text-muted-foreground">{event.form.description || event.event.description}</p></header>
    {!registration && <section className="rounded-xl border p-5"><h2 className="text-lg font-semibold">Sign in with Discord</h2><p className="my-2 text-sm text-muted-foreground">We check your membership before saving your registration.</p><Button onClick={() => location.assign('/auth/participant')}>Continue with Discord</Button></section>}
    {registration && <form className="space-y-5" onSubmit={(e) => void submit(e)}>{event.form.questions.map((q) => { const invalid = registration.missingRequiredQuestionIds?.includes(q.id) ?? false; const errorId = `${q.id}-error`; const title = label(q.label); return <div key={q.id} className="space-y-2"><label htmlFor={q.id} className="text-sm font-medium">{title}{q.required ? ' *' : ''}</label>{q.kind === 'single_choice' ? <select id={q.id} required={q.required} value={answers[q.id] ?? ''} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} className="min-h-10 w-full rounded-md border border-input bg-background px-3" onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}><option value="">Choose an answer</option>{q.choices?.map((o) => <option key={o.id} value={o.id}>{label(o.label)}</option>)}</select> : q.kind === 'multi_choice' ? <fieldset id={q.id} aria-describedby={invalid ? errorId : undefined} className="space-y-2">{q.choices?.map((o) => { const selected = Array.isArray(answers[q.id]) ? answers[q.id] as string[] : []; return <label key={o.id} className="flex items-center gap-2"><input type="checkbox" checked={selected.includes(o.id)} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.checked ? [...selected, o.id] : selected.filter((id) => id !== o.id) })}/>{label(o.label)}</label> })}</fieldset> : q.kind === 'text' && title.toLowerCase().includes('tell') ? <textarea id={q.id} required={q.required} value={answers[q.id] ?? ''} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} className="min-h-24 w-full rounded-md border border-input bg-background p-3" onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}/> : <Input id={q.id} required={q.required} value={answers[q.id] ?? ''} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}/ >}{invalid && <p id={errorId} className="text-sm text-danger">{title} is required.</p>}</div> })}
      {message && <p role={state === 'failed' ? 'alert' : 'status'}>{message}</p>}<div className="flex gap-3"><Button type="submit" disabled={state === 'waiting'} aria-busy={state === 'waiting'}>{state === 'waiting' ? 'Saving…' : registration.complete ? 'Save changes' : 'Complete registration'}</Button>{state === 'failed' && <Button type="button" variant="outline" onClick={() => void load()}>Reload form</Button>}</div>{registration.complete && <p>Registration complete. <a className="text-accent underline" href={`/team?eventId=${encodeURIComponent(eventId)}`}>Continue to teams</a></p>}</form>}
    {message && !registration && <p role="status">{message}</p>}</main>
}
