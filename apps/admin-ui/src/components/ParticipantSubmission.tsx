import { useEffect, useRef, useState } from 'react'
import { rateLimitMessage } from '@/api'
import { SignupQuestion, type Localized } from '@/components/signup-question'
import { Button } from '@/components/ui/button'
import { PageSkeleton } from '@/components/ui/skeleton'
import { LiveStatus, useLiveUpdates } from '@/lib/live-updates'
import { useLocale, useT } from '@/lib/i18n'
import type { SubmissionForm, SubmissionRecord } from '@/types'

type SubmissionState = { form: SubmissionForm; submission: SubmissionRecord | null; complete: boolean; editable: boolean; missingRequiredQuestionIds: string[] }

export function ParticipantSubmission({ eventId }: { eventId: string }) {
  const t = useT()
  const locale = useLocale()
  const [data, setData] = useState<SubmissionState | null>(null)
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({})
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [stale, setStale] = useState(false)
  const [signIn, setSignIn] = useState(false)
  const [busy, setBusy] = useState(false)
  const dirty = useRef(false)
  const revision = useRef(0)
  const endpoint = `/api/participant/events/${encodeURIComponent(eventId)}/submission`
  const label = (value: Localized) => typeof value === 'string' ? value : value[locale] || value.en
  const load = async (signal?: AbortSignal, reconcileDraft = false) => {
    try {
      const response = await fetch(endpoint, { signal })
      if (response.status === 401) { if (!signal?.aborted) setSignIn(true); return }
      if (response.status === 429) throw new Error(rateLimitMessage(response))
      if (!response.ok) throw new Error(response.status === 404 ? t('submission.access_error') : t('submission.load_error'))
      const next = await response.json() as SubmissionState
      if (signal?.aborted) return
      if (dirty.current && data && next.form.version !== data.form.version && !reconcileDraft) { setStale(true); return }
      if (dirty.current && reconcileDraft && data) {
        const previousKinds = new Map(data.form.questions.map(question => [question.id, question.kind]))
        setAnswers(current => Object.fromEntries(next.form.questions.flatMap((question): [string, string | string[]][] => {
          const value = current[question.id]
          if (value === undefined || previousKinds.get(question.id) !== question.kind) return []
          if (question.kind === 'multi_choice' && Array.isArray(value)) return [[question.id, value.filter(id => question.choices?.some(choice => choice.id === id))]]
          if (question.kind === 'single_choice' && typeof value === 'string') return [[question.id, question.choices?.some(choice => choice.id === value) ? value : '']]
          return typeof value === 'string' ? [[question.id, value]] : []
        })))
      } else if (!dirty.current) setAnswers(next.submission?.answers ?? {})
      setData(next); setSignIn(false); setError(''); setStale(false)
    } catch (cause) { if (!signal?.aborted) setError(cause instanceof Error ? cause.message : t('submission.load_error')) }
  }
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort() }, [eventId])
  useEffect(() => { const warn = (event: BeforeUnloadEvent) => { if (dirty.current) event.preventDefault() }; window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn) }, [])
  const live = useLiveUpdates(data ? `/api/participant/events/${encodeURIComponent(eventId)}/live` : null, load)
  const save = async () => {
    if (!data || busy || stale) return
    setBusy(true); setError(''); setMessage('')
    const submittedRevision = revision.current
    try {
      const response = await fetch(endpoint, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ formVersion: data.form.version, answers }) })
      const result = await response.json() as SubmissionRecord & { complete?: boolean; missingRequiredQuestionIds?: string[]; error?: string }
      if (!response.ok) {
        if (response.status === 429) { setError(rateLimitMessage(response)); return }
        if (result.error === 'stale_form_version') { setStale(true); setError(t('submission.form_stale')) }
        else setError(result.error === 'submission_locked' ? t('submission.locked') : t('submission.save_error'))
        return
      }
      dirty.current = revision.current !== submittedRevision
      setData({ ...data, submission: result, complete: !!result.complete, editable: data.form.allowEdits || !result.complete, missingRequiredQuestionIds: result.missingRequiredQuestionIds ?? [] })
      setEditing(!result.complete || dirty.current); setMessage(result.complete ? t('submission.complete') : t('submission.draft_saved'))
    } catch { setError(t('submission.save_error')) }
    finally { setBusy(false) }
  }
  return <section className="max-w-3xl space-y-6"><LiveStatus {...live} /><h1 className="participant-title">{t('submission.title')}</h1>
    {signIn ? <div className="space-y-3"><p>{t('participant.signup_login_desc')}</p><Button onClick={() => location.assign('/auth/participant')}>{t('participant.signup_continue')}</Button></div> :
      !data ? error ? <div role="alert"><p>{error}</p><Button onClick={() => void load()}>{t('participant.retry')}</Button></div> : <PageSkeleton /> :
      !data.form.enabled ? <p className="rounded-xl border border-dashed p-6">{t('submission.disabled')}</p> : <>
        <div className="participant-status" role="status">{dirty.current ? t('participant.unsaved') : data.complete ? t('submission.complete') : data.submission ? t('submission.draft_saved') : t('submission.not_started')}</div>
        {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
        {stale && <div role="alert" className="space-y-2"><p>{t('submission.form_stale')}</p><Button variant="outline" onClick={() => void load(undefined, true)}>{t('submission.reload')}</Button></div>}
        {data.complete && !editing ? <div className="space-y-4">{data.form.questions.map(question => {
          const raw = answers[question.id]; const values = Array.isArray(raw) ? raw : raw ? [raw] : []
          return <div key={question.id} className="rounded-xl border p-5"><h2 className="font-semibold">{label(question.label)}</h2><p className="mt-2 whitespace-pre-wrap">{values.map(value => question.choices?.find(choice => choice.id === value) ? label(question.choices.find(choice => choice.id === value)!.label) : value === 'yes' || value === 'no' ? t(`participant.answer_${value}`) : value).join(', ') || '—'}</p></div>
        })}{data.editable ? <Button onClick={() => setEditing(true)}>{t('submission.edit')}</Button> : <p>{t('submission.locked')}</p>}</div> : <div className="space-y-4">
          {data.form.questions.map(question => <SignupQuestion key={question.id} question={question} answer={answers[question.id]} invalid={false} label={label} t={t} onChange={answer => { dirty.current = true; revision.current++; setAnswers(previous => ({ ...previous, [question.id]: answer })) }} />)}
          <Button disabled={busy || stale} onClick={() => void save()}>{busy ? t('submission.saving') : t('submission.save')}</Button>
        </div>}
      </>}
  </section>
}
