import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label, Textarea } from '@/components/ui/textarea-label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useT } from '@/lib/i18n'


type Localized = string | { en: string; sv?: string }
type EventForm = { event: { id: string; name: string; description: string; startsAt: number | null; endsAt: number | null }; form: { version: number; title: string; description: string; themePreset: 'default'|'halloween'|'christmas'; accentColor: string; bannerUrl: string|null; questions: { id: string; label: Localized; help?: Localized; kind: string; required?: boolean; choices?: { id: string; label: Localized }[] }[] } }
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
  const presetColor = event.form.themePreset === 'halloween' ? '#ef793e' : event.form.themePreset === 'christmas' ? '#347b57' : '#55bbda'
  const accent = /^#[0-9a-fA-F]{6}$/.test(event.form.accentColor) ? event.form.accentColor : presetColor
  return <main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8" style={{'--participant-accent':accent,'--primary':accent,'--primary-foreground':accentForeground(accent)} as React.CSSProperties}>
    {event.form.bannerUrl && <img src={event.form.bannerUrl} alt="" referrerPolicy="no-referrer" className="max-h-64 w-full rounded-xl border object-cover" onError={e=>{e.currentTarget.hidden=true}} />}
    <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]"><section className="order-2 space-y-6 lg:order-1"><header><a href="/my-hackathons" className="text-sm underline" style={{color:accent}}>{t('participant.my_title')}</a><br/><a href={`/events/${encodeURIComponent(eventId)}`} className="text-sm" style={{color:accent}}>{t('participant.signup_details')}</a><h1 className="mt-3 text-3xl font-bold">{event.form.title || event.event.name}</h1><p className="mt-2 text-muted-foreground">{event.form.description || event.event.description}</p></header>
    {!registration && <section className="rounded-xl border p-5"><h2 className="text-lg font-semibold">{t('participant.signup_login')}</h2><p className="my-2 text-sm text-muted-foreground">{t('participant.signup_login_desc')}</p><Button onClick={() => location.assign('/auth/participant')}>{t('participant.signup_continue')}</Button></section>}
    {registration && <form className="space-y-5" onSubmit={(e) => void submit(e)}>{visibleQuestions.map((q) => <SignupQuestion key={q.id} question={q} answer={answers[q.id]} invalid={registration.missingRequiredQuestionIds.includes(q.id)} label={label} onChange={answer=>setAnswers({...answers,[q.id]:answer})} t={t} />)}
      {message && <p role={state === 'failed' ? 'alert' : 'status'}>{message}</p>}<div className="flex gap-3"><Button type="submit" disabled={state === 'waiting'} aria-busy={state === 'waiting'}>{state === 'waiting' ? t('participant.team_save') : registration.complete ? t('participant.signup_update') : t('participant.signup_submit')}</Button>{state === 'failed' && <Button type="submit" variant="outline">{t('participant.signup_reload')}</Button>}</div>{registration.complete && <p>{t('participant.signup_success')} <a className="underline" style={{color:accent}} href={`/team?eventId=${encodeURIComponent(eventId)}`}>{t('participant.view_team')}</a></p>}</form>}
    {message && !registration && <p role={state === 'failed' ? 'alert' : 'status'}>{message}</p>}</section><aside className="order-1 h-fit rounded-xl border bg-card p-5 lg:sticky lg:top-6 lg:order-2"><h2 className="text-lg font-semibold">{event.event.name}</h2><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{event.event.description}</p>{event.event.startsAt && <p className="mt-4 text-sm"><strong>Starts</strong><br/><time>{new Date(event.event.startsAt).toLocaleString(language === 'sv' ? 'sv-SE' : 'en-US')}</time></p>}{event.event.endsAt && <p className="mt-3 text-sm"><strong>Ends</strong><br/><time>{new Date(event.event.endsAt).toLocaleString(language === 'sv' ? 'sv-SE' : 'en-US')}</time></p>}</aside></div></main>
}

function accentForeground(hex: string) {
  const [r, g, b] = hex.slice(1).match(/.{2}/g)!.map(value => {
    const channel = parseInt(value, 16) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b! > 0.179 ? '#111827' : '#ffffff'
}

function SignupQuestion({ question, answer, invalid, label, onChange, t }: {
  question: EventForm['form']['questions'][number]
  answer: string | string[] | undefined
  invalid: boolean
  label: (value: Localized) => string
  onChange: (value: string | string[]) => void
  t: ReturnType<typeof useT>
}) {
  const title = label(question.label)
  const errorId = `${question.id}-error`
  const help = question.help ? label(question.help) : ''
  return <fieldset id={question.kind==='multi_choice'?question.id:undefined} tabIndex={question.kind==='multi_choice'?-1:undefined} className="space-y-2 rounded-lg border bg-card p-4" aria-describedby={invalid ? errorId : undefined}>
    {question.kind === 'multi_choice' ? <legend className="px-1 text-sm font-medium">{title}{question.required ? ' *' : ''}</legend> : <Label htmlFor={question.id}>{title}{question.required ? ' *' : ''}</Label>}
    {help && <p className="text-sm text-muted-foreground">{help}</p>}
    {question.kind === 'single_choice' ? <Select value={typeof answer === 'string' && answer ? answer : '__none__'} onValueChange={value=>onChange(value==='__none__'?'':value)}>
      <SelectTrigger id={question.id} aria-label={title} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined}><SelectValue placeholder={t('participant.signup_choose')} /></SelectTrigger>
      <SelectContent><SelectItem value="__none__">{t('participant.signup_choose')}</SelectItem>{question.choices?.map(option=><SelectItem key={option.id} value={option.id}>{label(option.label)}</SelectItem>)}</SelectContent>
    </Select> : question.kind === 'multi_choice' ? <div className="space-y-2">{question.choices?.map(option=>{
      const selected = Array.isArray(answer) ? answer : []
      return <label key={option.id} className="flex min-h-8 items-center gap-2"><Checkbox checked={selected.includes(option.id)} aria-invalid={invalid} onCheckedChange={checked=>onChange(checked?[...selected,option.id]:selected.filter(id=>id!==option.id))} /><span>{label(option.label)}</span></label>
    })}</div> : question.kind === 'text' ? <Textarea id={question.id} value={typeof answer==='string'?answer:''} aria-invalid={invalid} aria-describedby={invalid?errorId:undefined} onChange={event=>onChange(event.target.value)} /> : <Input id={question.id} value={typeof answer==='string'?answer:''} aria-invalid={invalid} aria-describedby={invalid?errorId:undefined} onChange={event=>onChange(event.target.value)} />}
    {invalid && <p id={errorId} className="text-sm text-destructive">{t('participant.signup_field_required', { field: title })}</p>}
  </fieldset>
}
