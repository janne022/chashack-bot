import { createFileRoute } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { ParticipantFrame } from '@/components/participant-appearance'
import { SignupQuestion, type Localized } from '@/components/signup-question'
import { useLocale, useT } from '@/lib/i18n'
import { LiveStatus, useLiveUpdates } from '@/lib/live-updates'
import { publicEventQuery, type PublicEvent } from '@/lib/public-event'


import { ParticipantNavigation } from '@/components/participant-navigation'
import { ClaimImportedSignup } from '@/components/claim-imported-signup'
import { PageSkeleton } from '@/components/ui/skeleton'
import { Check, Pencil, ArrowRight } from 'lucide-react'

type Profile = { experience: string; roleTrack: string; skills: string[]; teamPref: string }
type EventForm = PublicEvent
type Registration = { answers: Record<string, string | string[]>; profile: Profile | null; complete: boolean; missingRequiredQuestionIds: string[]; status: string; signupWindowReason?: 'signup_not_open' | 'signup_closed' | null }
type RegistrationLookup = { kind: 'member'; registration: Registration } | { kind: 'nonmember' } | { kind: 'anonymous' }
export const Route = createFileRoute('/events/$eventId/signup')({ component: Signup })

const emptyProfile = (): Profile => ({ experience: '', roleTrack: '', skills: [], teamPref: '' })

// A 401/404 from the participant endpoint is an answer, not a failure: it tells
// the page to show the login or the non-member notice.
const registrationQuery = (eventId: string, force = false) => ({
  queryKey: ['participant-registration', eventId] as const,
  queryFn: async (): Promise<RegistrationLookup> => {
    const res = await fetch(`/api/participant/events/${encodeURIComponent(eventId)}/registration`)
    if (res.status === 401) return { kind: 'anonymous' }
    if (res.status === 404) return { kind: 'nonmember' }
    if (!res.ok) throw new Error('participant.signup_load_error')
    return { kind: 'member', registration: await res.json() as Registration }
  },
  staleTime: force ? 0 : 15_000,
  gcTime: 30 * 60_000,
})

function Signup() {
  const { eventId } = Route.useParams()
  const t = useT()
  const locale = useLocale()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [event, setEvent] = useState<EventForm | null>(null)
  const [registration, setRegistration] = useState<Registration | null>(null)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [profile, setProfile] = useState<Profile>(emptyProfile)
  const [state, setState] = useState<'loading' | 'idle' | 'waiting' | 'failed'>('loading')
  const [message, setMessage] = useState('')
  const [stale, setStale] = useState(false)
  const [access, setAccess] = useState<'anonymous' | 'member' | 'nonmember'>('anonymous')
  const dirty = useRef(false)
  const draftRevision = useRef(0)
  const sequence = useRef(0)
  const changeProfile = (next: Profile) => { draftRevision.current++; dirty.current = true; setProfile(next) }

  const language = locale
  const label = (value: Localized) => typeof value === 'string' ? value : value[language] || value.en
  const visibleQuestions = event?.form.questions ?? []
  const profileFields = event?.form.profileFields
  const profileRequired = !!profileFields && profileFields.experiences.length + profileFields.roleTracks.length + profileFields.skills.length + profileFields.teamPrefs.length > 0
  const canSubmit = profileRequired || visibleQuestions.length > 0
  const requiredAnswers = [
    ...(profileFields?.experiences.length ? [!!profile.experience] : []),
    ...(profileFields?.roleTracks.length ? [!!profile.roleTrack] : []),
    ...(profileFields?.skills.length ? [profile.skills.length > 0] : []),
    ...(profileFields?.teamPrefs.length ? [!!profile.teamPref] : []),
    ...visibleQuestions.filter(q => q.required).map(q => { const a = answers[q.id]; return Array.isArray(a) ? a.length > 0 : !!a?.trim() }),
  ]
  const answered = requiredAnswers.filter(Boolean).length
  const readOnly = !!registration?.complete && !editing && !dirty.current
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty.current) event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  // One run at a time: a live-update refresh racing a manual reload keeps the
  // newest answer instead of letting the slower response win.
  const load = async (background = false) => {
    const run = ++sequence.current
    if (!background) { setState('loading'); setMessage(''); setStale(false) }
    try {
      const [next, lookup] = await Promise.all([
        queryClient.fetchQuery(publicEventQuery(eventId, background)),
        queryClient.fetchQuery(registrationQuery(eventId, background)),
      ])
      if (run !== sequence.current) return
      if (dirty.current && event && next.form.version !== event.form.version) {
        setStale(true); setMessage(t('participant.signup_stale'))
        setEvent({ ...next, form: event.form })
      } else setEvent(next)
      if (lookup.kind === 'member') {
        setRegistration(lookup.registration)
        if (!dirty.current) { setAnswers(lookup.registration.answers); setProfile(lookup.registration.profile ?? emptyProfile()) }
        setAccess('member')
      } else { setRegistration(null); setAccess(lookup.kind) }
      if (!background) setState('idle')
    } catch (error) {
      if (run !== sequence.current) return
      // Query functions throw catalog keys, so a cached failure stays localized.
      const key = error instanceof Error && error.message.startsWith('participant.') ? error.message : ''
      setMessage(key ? t(key) : error instanceof Error ? error.message : t('participant.signup_load_error'))
      if (!background) setState('failed')
    }
  }
  useEffect(() => {
    dirty.current = false
    setEvent(null); setRegistration(null); setAnswers({})
    void load()
    return () => { sequence.current++ }
  }, [eventId])
  const live = useLiveUpdates(access === 'member' ? `/api/participant/events/${encodeURIComponent(eventId)}/live` : null, () => load(true))

  const refreshForm = async () => {
    setState('waiting')
    try {
      const next = await queryClient.fetchQuery(publicEventQuery(eventId, true))
      const previous = new Map(event?.form.questions.map(q => [q.id, q.kind]))
      setAnswers(current => Object.fromEntries(next.form.questions.flatMap((q): [string, string | string[]][] => {
        const answer = current[q.id]
        if (previous.get(q.id) !== q.kind || answer === undefined) return []
        if (q.kind === 'multi_choice' && Array.isArray(answer)) return [[q.id, answer.filter(id => q.choices?.some(choice => choice.id === id))]]
        if (q.kind === 'single_choice' && typeof answer === 'string') return [[q.id, q.choices?.some(choice => choice.id === answer) ? answer : '']]
        return typeof answer === 'string' && !['multi_choice', 'single_choice'].includes(q.kind) ? [[q.id, answer]] : []
      })))
      setEvent(next)
      setRegistration(current => current ? { ...current, complete: false, missingRequiredQuestionIds: [] } : current)
      setStale(false); setMessage(t('participant.signup_review')); setState('idle')
    } catch (error) {
      const key = error instanceof Error && error.message.startsWith('participant.') ? error.message : ''
      setMessage(key ? t(key) : error instanceof Error ? error.message : t('participant.signup_load_error')); setState('failed')
    }
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setAttempted(true)
    if (!event) return
    if (!canSubmit) { setMessage(t('participant.signup_empty')); return }
    const missingProfile = !!profileFields && ((profileFields.experiences.length > 0 && !profile.experience) || (profileFields.roleTracks.length > 0 && !profile.roleTrack) || (profileFields.skills.length > 0 && profile.skills.length === 0) || (profileFields.teamPrefs.length > 0 && !profile.teamPref))
    if (missingProfile) { setMessage(t('participant.signup_profile_required')); document.getElementById('profile-experience')?.focus(); return }
    const missing = event.form.questions.filter((q) => { const answer = answers[q.id]; return q.required && !(Array.isArray(answer) ? answer.length : typeof answer === 'string' && answer.trim()) }).map((q) => q.id)
    if (missing.length) {
      setRegistration({ answers, profile, complete: false, missingRequiredQuestionIds: missing, status: registration?.status ?? 'not_registered' })
      setMessage(t('participant.signup_required'))
      document.getElementById(missing[0]!)?.focus()
      return
    }
    setState('waiting'); setMessage(''); setStale(false)
    const submittedRevision = draftRevision.current
    try {
      const res = await fetch(`/api/participant/events/${encodeURIComponent(eventId)}/registration`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ formVersion: event.form.version, answers, ...(profileRequired ? { profile } : {}) }) })
      const value = await res.json() as Registration & { error?: string }
      if (res.status === 401) { location.assign('/auth/participant'); return }
      if (res.status === 404) throw new Error(t('participant.signup_member'))
      if (!res.ok) { setRegistration({ ...registration!, ...value, answers, missingRequiredQuestionIds: value.missingRequiredQuestionIds ?? registration?.missingRequiredQuestionIds ?? [] }); setStale(value.error === 'stale_form_version'); setMessage(value.error === 'stale_form_version' ? t('participant.signup_stale') : value.error === 'signup_not_open' || value.error === 'signup_closed' ? t(`participant.${value.error}`) : t('participant.signup_save_error')); setState('failed'); return }
      dirty.current = draftRevision.current !== submittedRevision; setRegistration(value); setMessage(t('participant.signup_saved')); setEditing(false); setState('idle')
    } catch (error) { setMessage(error instanceof Error ? error.message : t('participant.signup_failed')); setState('failed') }
  }
  if (!event) return <main className="mx-auto max-w-2xl space-y-4 p-6">{state === 'loading' ? <PageSkeleton /> : <><p role="alert">{message}</p><Button onClick={() => void load()}>{t('participant.retry')}</Button></>}</main>
  return <ParticipantFrame appearance={event.form.appearance}>
    <ParticipantNavigation eventId={eventId} active="signup" />
    <LiveStatus {...live} />
    <div className="grid gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
      <section className="order-1 space-y-6">
        <header className="space-y-3">
          <h1 className="participant-title">{event.form.title || event.event.name}</h1>
          <p className="max-w-prose opacity-80">{event.form.description || event.event.description}</p>
        </header>
        {registration && !registration.complete && !registration.signupWindowReason && access === 'member' && <ClaimImportedSignup
          eventId={eventId}
          onActivated={() => void load()}
          onPrefill={prefill => {
            draftRevision.current++
            dirty.current = true
            setAnswers(current => ({ ...current, ...prefill.answers }))
            // Never clobber a choice the participant already made with an empty import.
            setProfile(current => ({
              experience: prefill.profile.experience || current.experience,
              roleTrack: prefill.profile.roleTrack || current.roleTrack,
              skills: prefill.profile.skills.length > 0 ? prefill.profile.skills : current.skills,
              teamPref: prefill.profile.teamPref || current.teamPref,
            }))
            setMessage(t('participant.claim_prefilled'))
          }}
        />}
        {!registration && access === 'anonymous' && state !== 'failed' && <section className="rounded-xl border p-5">
        <h2 className="text-lg font-semibold">{t('participant.signup_login')}</h2>
          <p className="my-2 text-sm opacity-80">{t('participant.signup_login_desc')}</p>
          <Button onClick={() => location.assign('/auth/participant')}>{t('participant.signup_continue')}</Button>
        </section>}
        {!registration && access === 'nonmember' && <p role="alert">{t('participant.signup_member')}</p>}
        {registration?.signupWindowReason && <p role="alert">{t(`participant.${registration.signupWindowReason}`)}</p>}
        {registration && !registration.signupWindowReason && !canSubmit && <p role="alert">{t('participant.signup_empty')}</p>}
        {registration && !registration.signupWindowReason && <form className="space-y-6" onSubmit={e => void submit(e)}>
          <div className="participant-status" role="status"><div className="flex items-center gap-3"><Check size={18} /><div><strong>{dirty.current ? t('participant.unsaved') : registration.complete ? t('participant.saved') : t('participant.signup_pending')}</strong>{readOnly && <p className="mt-1 text-sm opacity-75">{t('participant.edit_hint')}</p>}</div></div>{readOnly && <Button type="button" variant="outline" onClick={() => setEditing(true)}><Pencil size={15} />{t('participant.edit_answers')}</Button>}</div>
          {requiredAnswers.length > 0 && <div><p className="mb-2 text-sm opacity-75">{t('participant.progress', { done: answered, total: requiredAnswers.length })}</p><progress className="participant-progress" value={answered} max={requiredAnswers.length} aria-label={t('participant.registration')} /></div>}
          <fieldset disabled={readOnly || state === 'waiting'} className="min-w-0 space-y-6 participant-fields">
          {profileRequired && <fieldset className="space-y-6 rounded-2xl border bg-card p-6 sm:p-8"><legend className="px-2 text-xl font-semibold">{t('participant.profile_intro')}</legend><p className="text-sm opacity-75">{t('participant.profile_hint')}</p>
            {(['experience', 'roleTrack', 'teamPref'] as const).filter(field => (field === 'experience' ? event.form.profileFields.experiences : field === 'roleTrack' ? event.form.profileFields.roleTracks : event.form.profileFields.teamPrefs).length > 0).map((field) => {
              const options = field === 'experience' ? event.form.profileFields.experiences : field === 'roleTrack' ? event.form.profileFields.roleTracks : event.form.profileFields.teamPrefs
              const id = field === 'roleTrack' ? 'role' : field === 'teamPref' ? 'team-pref' : 'experience'
              return <fieldset key={field} className="space-y-3"><legend className="mb-3 text-sm font-semibold">{t('participant.signup_' + (id === 'team-pref' ? 'team_pref' : id))}</legend><div className={field === 'teamPref' ? 'grid gap-2' : 'grid gap-2 sm:grid-cols-2'}>{options.map((option, index) => <label key={option.id} className="participant-choice"><input type="radio" id={index === 0 ? `profile-${id}` : undefined} name={field} aria-required="true" value={option.id} checked={profile[field] === option.id} onChange={() => changeProfile({ ...profile, [field]: option.id })} /><span>{label({ en: option.label, sv: option.label_sv })}</span></label>)}</div></fieldset>
            })}
            {event.form.profileFields.skills.length > 0 && <fieldset className="space-y-2"><legend className="text-sm font-medium">{t('participant.signup_skills')}</legend><p className="text-sm opacity-80">{t('participant.signup_skill_groups')}</p><div className="space-y-4">{[...new Set(event.form.profileFields.skills.map(skill => skill.group))].map(group => <div key={group}><h3 className="mb-2 text-xs font-semibold uppercase tracking-wider opacity-65">{group || t('participant.skill_other')}</h3><div className="grid gap-2 sm:grid-cols-2">{event.form.profileFields.skills.filter(skill => skill.group === group).map(skill => <label key={skill.id} className="participant-choice"><input type="checkbox" checked={profile.skills.includes(skill.id)} onChange={inputEvent => changeProfile({ ...profile, skills: inputEvent.target.checked ? [...profile.skills.filter(id => !skill.group || event.form.profileFields.skills.find(option => option.id === id)?.group !== skill.group), skill.id] : profile.skills.filter(id => id !== skill.id) })} /><span>{label({ en: skill.label, sv: skill.label_sv })}</span></label>)}</div></div>)}</div></fieldset>}
          </fieldset>}
          {visibleQuestions.length > 0 && <div className="pt-3"><h2 className="text-xl font-semibold">{t('participant.questions_intro')}</h2><p className="mt-2 text-sm opacity-75">{t('participant.questions_hint')}</p></div>}
          {visibleQuestions.map(q => <SignupQuestion key={q.id} question={q} answer={answers[q.id]} invalid={attempted && registration.missingRequiredQuestionIds.includes(q.id)} label={label} onChange={answer => { draftRevision.current++; dirty.current = true; setAnswers({ ...answers, [q.id]: answer }) }} t={t} />)}
          </fieldset>
          {message && <p role={state === 'failed' ? 'alert' : 'status'} tabIndex={-1}>{message}</p>}
          {!readOnly && <div className="participant-savebar"><Button type="submit" className="min-h-11" disabled={state === 'waiting' || stale || !canSubmit} aria-busy={state === 'waiting'}>{state === 'waiting' ? t('participant.team_save') : registration.complete ? t('participant.signup_update') : t('participant.signup_submit')}</Button>{stale ? <Button type="button" className="min-h-11" variant="outline" onClick={() => void refreshForm()}>{t('participant.signup_reload')}</Button> : state === 'failed' && <Button type="submit" className="min-h-11" variant="outline">{t('participant.retry')}</Button>}</div>}
          {registration.complete && <section className="space-y-3 border-t border-current/15 pt-4"><p role="status">{t('participant.signup_success')}</p><Button asChild variant="outline" className="min-h-11"><a href={`/team?eventId=${encodeURIComponent(eventId)}`}>{t('participant.team_title')}</a></Button></section>}
        </form>}
        {message && !registration && <p role={state === 'failed' ? 'alert' : 'status'}>{message} {state === 'failed' && <Button onClick={() => void load()}>{t('participant.retry')}</Button>}</p>}
      </section>
      <aside className="order-2 h-fit space-y-5 rounded-2xl border bg-card p-6 lg:sticky lg:top-6 lg:order-2">
        {registration && <p className="mb-4 border-b border-current/15 pb-3 text-sm font-semibold" role="status">{registration.complete && !dirty.current ? t('participant.signup_success') : t('participant.action_needed')}</p>}
        <h2 className="text-lg font-semibold">{event.event.name}</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm opacity-80">{event.event.description}</p>
        {event.event.startsAt && <p className="mt-4 text-sm"><strong>{t('participant.event_starts')}</strong><br /><time>{new Date(event.event.startsAt).toLocaleString(language === 'sv' ? 'sv-SE' : 'en-US')}</time></p>}
        {event.event.endsAt && <p className="mt-3 text-sm"><strong>{t('participant.event_ends')}</strong><br /><time>{new Date(event.event.endsAt).toLocaleString(language === 'sv' ? 'sv-SE' : 'en-US')}</time></p>}
        <div className="border-t pt-5"><h3 className="font-semibold">{t('participant.next_step')}</h3><p className="mt-2 text-sm opacity-75">{t('participant.next_hint')}</p><a className="mt-3 inline-flex min-h-11 items-center gap-2 text-sm font-semibold" href={`/team?eventId=${encodeURIComponent(eventId)}`}>{t('participant.team_title')}<ArrowRight size={16} /></a></div>
      </aside>
    </div>
  </ParticipantFrame>
}
