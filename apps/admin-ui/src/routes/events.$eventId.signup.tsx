import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { ParticipantFrame } from '@/components/participant-appearance'
import { SignupQuestion, type Localized, type Question } from '@/components/signup-question'
import type { FormAppearance } from '@/types'
import { useT } from '@/lib/i18n'


type EventForm = { event: { id: string; name: string; description: string; startsAt: number | null; endsAt: number | null }; form: { version: number; title: string; description: string; appearance: FormAppearance; questions: Question[] } }
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
  const [access, setAccess] = useState<'anonymous' | 'member' | 'nonmember'>('anonymous')

  const language = localStorage.getItem('chas-locale') === 'sv' ? 'sv' : 'en'
  const label = (value: Localized) => typeof value === 'string' ? value : value[language] || value.en
  const visibleQuestions = event?.form.questions ?? []

  const load = async () => {
    setState('loading')
    setMessage('')
    try {
      const res = await fetch(`/api/public/events/${encodeURIComponent(eventId)}`)
      if (!res.ok) throw new Error(t('participant.signup_unavailable'))
      setEvent(await res.json() as EventForm)
      const saved = await fetch(`/api/participant/events/${encodeURIComponent(eventId)}/registration`)
      if (saved.ok) {
        const value = await saved.json() as Registration
        setRegistration(value); setAnswers(value.answers); setAccess('member')
      } else if (saved.status === 404) setAccess('nonmember')
      else if (saved.status === 401) setAccess('anonymous')
      else throw new Error(t('participant.signup_load_error'))
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
      if (!res.ok) { setRegistration({ ...registration!, ...value, answers, missingRequiredQuestionIds: value.missingRequiredQuestionIds ?? registration?.missingRequiredQuestionIds ?? [] }); setMessage(value.error === 'stale_form_version' ? t('participant.signup_stale') : t('participant.signup_save_error')); setState('failed'); return }
      setRegistration(value); setMessage(t('participant.signup_saved')); setState('idle')
    } catch (error) { setMessage(error instanceof Error ? error.message : t('participant.signup_failed')); setState('failed') }
  }
  if (!event) return <main className="mx-auto max-w-2xl space-y-4 p-6">{state === 'loading' ? <p aria-busy="true">{t('participant.signup_loading')}</p> : <><p role="alert">{message}</p><Button onClick={() => void load()}>{t('participant.retry')}</Button></>}</main>
  return <ParticipantFrame appearance={event.form.appearance}>
    <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
      <section className="order-2 space-y-6 lg:order-1">
        <header className="space-y-3">
          <nav className="flex flex-wrap gap-x-5 gap-y-1 text-sm" aria-label={t('participant.signup_details')}>
            <a href="/my-hackathons" className="inline-flex min-h-11 items-center underline">{t('participant.my_title')}</a>
            <a href={`/events/${encodeURIComponent(eventId)}`} className="inline-flex min-h-11 items-center underline">{t('participant.signup_details')}</a>
          </nav>
          <h1 className="text-3xl font-bold">{event.form.title || event.event.name}</h1>
          <p className="max-w-prose opacity-80">{event.form.description || event.event.description}</p>
        </header>
        {!registration && access === 'anonymous' && state !== 'failed' && <section className="rounded-xl border p-5">
          <h2 className="text-lg font-semibold">{t('participant.signup_login')}</h2>
          <p className="my-2 text-sm opacity-80">{t('participant.signup_login_desc')}</p>
          <Button onClick={() => location.assign('/auth/participant')}>{t('participant.signup_continue')}</Button>
        </section>}
        {!registration && access === 'nonmember' && <p role="alert">{t('participant.signup_member')}</p>}
        {registration && <form className="space-y-5" onSubmit={e => void submit(e)}>
          {visibleQuestions.map(q => <SignupQuestion key={q.id} question={q} answer={answers[q.id]} invalid={registration.missingRequiredQuestionIds.includes(q.id)} label={label} onChange={answer => setAnswers({ ...answers, [q.id]: answer })} t={t} />)}
          {message && <p role={state === 'failed' ? 'alert' : 'status'} tabIndex={-1}>{message}</p>}
          <div className="flex flex-wrap gap-3"><Button type="submit" className="min-h-11" disabled={state === 'waiting'} aria-busy={state === 'waiting'}>{state === 'waiting' ? t('participant.team_save') : registration.complete ? t('participant.signup_update') : t('participant.signup_submit')}</Button>{state === 'failed' && <Button type="submit" className="min-h-11" variant="outline">{t('participant.retry')}</Button>}</div>
          {registration.complete && <p>{t('participant.signup_success')} <a className="underline" href={`/team?eventId=${encodeURIComponent(eventId)}`}>{t('participant.view_team')}</a></p>}
        </form>}
        {message && !registration && <p role={state === 'failed' ? 'alert' : 'status'}>{message} {state === 'failed' && <Button onClick={() => void load()}>{t('participant.retry')}</Button>}</p>}
      </section>
      <aside className="order-1 h-fit rounded-xl border bg-card p-5 lg:sticky lg:top-6 lg:order-2">
        <h2 className="text-lg font-semibold">{event.event.name}</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm opacity-80">{event.event.description}</p>
        {event.event.startsAt && <p className="mt-4 text-sm"><strong>{t('participant.event_starts')}</strong><br /><time>{new Date(event.event.startsAt).toLocaleString(language === 'sv' ? 'sv-SE' : 'en-US')}</time></p>}
        {event.event.endsAt && <p className="mt-3 text-sm"><strong>{t('participant.event_ends')}</strong><br /><time>{new Date(event.event.endsAt).toLocaleString(language === 'sv' ? 'sv-SE' : 'en-US')}</time></p>}
      </aside>
    </div>
  </ParticipantFrame>
}
