import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useT } from '@/lib/i18n'


type Localized = string | { en: string; sv?: string }
type EventForm = { event: { id: string; name: string; description: string }; form: { version: number; title: string; description: string; questions: { id: string; label: Localized; kind: string; required?: boolean; choices?: { id: string; label: Localized }[] }[] } }
type Registration = { answers: Record<string, string | string[]>; complete: boolean; missingRequiredQuestionIds: string[]; status: string }
export const Route = createFileRoute('/events/$eventId/signup')({ component: Signup })

function Signup() {
  const { eventId } = Route.useParams()
  const t = useT()
  const [event, setEvent] = useState<EventForm | null>(null)
  const [registration, setRegistration] = useState<Registration | null>(null)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [state, setState] = useState<'loading' | 'idle' | 'waiting' | 'failed'>('loading')
  const [message, setMessage] = useState('')

  const language = localStorage.getItem('chas-locale') === 'sv' ? 'sv' : 'en'
  const label = (value: Localized) => typeof value === 'string' ? value : value[language] || value.en
  const visibleQuestions = event?.form.questions ?? []

  const load = async () => {
    setState('loading')
    try {
      const res = await fetch(`/api/public/events/${encodeURIComponent(eventId)}`)
      if (!res.ok) throw new Error(t('participant.signup_unavailable'))
      setEvent(await res.json() as EventForm)
      const saved = await fetch(`/api/participant/events/${encodeURIComponent(eventId)}/registration`)
      if (saved.ok) {
        const value = await saved.json() as Registration
        setRegistration(value); setAnswers(value.answers)
      } else if (saved.status === 404) setMessage(t('participant.signup_member'))
      else if (saved.status !== 401) throw new Error(t('participant.signup_load_error'))
      setState('idle')
    } catch (error) { setMessage(error instanceof Error ? error.message : t('participant.signup_load_error')); setState('failed') }
  }
  useEffect(() => { void load() }, [eventId])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!event) return
    const missing = event.form.questions.filter((q) => { const answer = answers[q.id]; return q.required && !(Array.isArray(answer) ? answer.length : typeof answer === 'string' && answer.trim()) }).map((q) => q.id)
    if (missing.length) {
      setRegistration({ answers, complete: false, missingRequiredQuestionIds: missing, status: registration?.status ?? 'not_registered' })
      setMessage(t('participant.signup_required'))
      document.getElementById(missing[0]!)?.focus()
      return
    }
    setState('waiting'); setMessage('')
    try {
      const res = await fetch(`/api/participant/events/${encodeURIComponent(eventId)}/registration`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ formVersion: event.form.version, answers }) })
      const value = await res.json() as Registration & { error?: string }
      if (res.status === 401) { location.assign('/auth/participant'); return }
      if (res.status === 404) throw new Error(t('participant.signup_member'))
      if (!res.ok) { setRegistration({ ...value, answers, complete: false, status: registration?.status ?? 'not_registered' }); setMessage(value.error === 'stale_form_version' ? t('participant.signup_stale') : t('participant.signup_save_error')); setState('failed'); return }
      setRegistration(value); setMessage(t('participant.signup_saved')); setState('idle')
    } catch (error) { setMessage(error instanceof Error ? error.message : t('participant.signup_failed')); setState('failed') }
  }
  if (!event) return <main className="mx-auto max-w-2xl space-y-4 p-6">{state === 'loading' ? <p aria-busy="true">{t('participant.signup_loading')}</p> : <><p role="alert">{message}</p><Button onClick={() => void load()}>{t('participant.retry')}</Button></>}</main>
  return <main className="mx-auto max-w-2xl space-y-6 p-4 sm:p-8"><header><a href="/my-hackathons" className="text-sm text-accent underline">{t('participant.my_title')}</a><br/><a href={`/events/${encodeURIComponent(eventId)}`} className="text-sm text-accent">{t('participant.signup_details')}</a><h1 className="mt-3 text-3xl font-bold">{event.form.title || event.event.name}</h1><p className="mt-2 text-muted-foreground">{event.form.description || event.event.description}</p></header>
    {!registration && <section className="rounded-xl border p-5"><h2 className="text-lg font-semibold">{t('participant.signup_login')}</h2><p className="my-2 text-sm text-muted-foreground">{t('participant.signup_login_desc')}</p><Button onClick={() => location.assign('/auth/participant')}>{t('participant.signup_continue')}</Button></section>}
    {registration && <form className="space-y-5" onSubmit={(e) => void submit(e)}>{visibleQuestions.map((q) => { const invalid = registration.missingRequiredQuestionIds?.includes(q.id) ?? false; const errorId = `${q.id}-error`; const title = label(q.label); return <div key={q.id} className="space-y-2">{q.kind !== 'multi_choice' && <label htmlFor={q.id} className="text-sm font-medium">{title}{q.required ? ' *' : ''}</label>}{q.kind === 'single_choice' ? <select id={q.id} required={q.required} value={answers[q.id] ?? ''} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} className="min-h-10 w-full rounded-md border border-input bg-background px-3" onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}><option value="">{t('participant.signup_choose')}</option>{q.choices?.map((o) => <option key={o.id} value={o.id}>{label(o.label)}</option>)}</select> : q.kind === 'multi_choice' ? <fieldset id={q.id} aria-describedby={invalid ? errorId : undefined} aria-invalid={invalid} className="space-y-2"><legend className="text-sm font-medium">{title}{q.required ? ' *' : ''}</legend>{q.choices?.map((o) => { const selected = Array.isArray(answers[q.id]) ? answers[q.id] as string[] : []; return <label key={o.id} className="flex items-center gap-2"><input type="checkbox" aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} checked={selected.includes(o.id)} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.checked ? [...selected, o.id] : selected.filter((id) => id !== o.id) })}/>{label(o.label)}</label> })}</fieldset> : q.kind === 'text' ? <textarea id={q.id} required={q.required} value={String(answers[q.id] ?? '')} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} className="min-h-24 w-full rounded-md border border-input bg-background p-3" onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}/> : <Input id={q.id} required={q.required} value={String(answers[q.id] ?? '')} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}/>} {invalid && <p id={errorId} className="text-sm text-destructive">{t('participant.signup_required')}</p>}</div> })}
      {message && <p role={state === 'failed' ? 'alert' : 'status'}>{message}</p>}<div className="flex gap-3"><Button type="submit" disabled={state === 'waiting'} aria-busy={state === 'waiting'}>{state === 'waiting' ? t('participant.team_save') : registration.complete ? t('participant.signup_update') : t('participant.signup_submit')}</Button>{state === 'failed' && <Button type="button" variant="outline" onClick={() => void load()}>{t('participant.signup_reload')}</Button>}</div>{registration.complete && <p>{t('participant.signup_success')} <a className="text-accent underline" href={`/team?eventId=${encodeURIComponent(eventId)}`}>{t('participant.view_team')}</a></p>}</form>}
    {message && !registration && <p role={state === 'failed' ? 'alert' : 'status'}>{message}</p>}</main>
}
