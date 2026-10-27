import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '@/api'
import { CustomQuestionsEditor } from '@/components/CustomQuestionsEditor'
import { Button } from '@/components/ui/button'
import { PageSkeleton } from '@/components/ui/skeleton'
import { useLocale, useT } from '@/lib/i18n'
import { useLiveUpdates } from '@/lib/live-updates'
import { validateQuestions } from '@/lib/question-validation'
import type { FormConfig, SubmissionForm, SubmissionRecord } from '@/types'

export function SubmissionManager({ eventId, baseForm, readOnly }: { eventId: string; baseForm: FormConfig; readOnly: boolean }) {
  const t = useT()
  const locale = useLocale()
  const [form, setForm] = useState<SubmissionForm | null>(null)
  const [records, setRecords] = useState<(SubmissionRecord & { userId: string })[]>([])
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const dirty = useRef(false)
  const currentVersion = useRef(0)
  const load = async (signal?: AbortSignal, discardDraft = false) => {
    try {
      const result = await api.submissions(eventId, signal)
      if (signal?.aborted) return
      if (result.form.version < currentVersion.current) return
      setRecords(result.submissions)
      if (!dirty.current || discardDraft) { dirty.current = false; currentVersion.current = result.form.version; setForm(result.form); setError('') }
      else if (form && result.form.version !== form.version) setError(t('submission.form_stale'))
    } catch { if (!signal?.aborted && !form) setError(t('submission.load_error')) }
  }
  useEffect(() => { const controller = new AbortController(); dirty.current = false; currentVersion.current = 0; void load(controller.signal); return () => controller.abort() }, [eventId])
  useLiveUpdates(form ? `/api/live?eventId=${encodeURIComponent(eventId)}` : null, load)
  const save = async () => {
    if (!form || busy || !validateQuestions({ ...baseForm, customQuestions: form.questions })) return
    if (form.enabled && !form.questions.length) { setError(t('submission.questions_required')); return }
    setBusy(true); setError(''); setMessage('')
    try { const result = await api.saveSubmissionForm(eventId, form); dirty.current = false; currentVersion.current = result.form.version; setForm(result.form); setError(''); setMessage(t('submission.form_saved')) }
    catch (cause) { setError(cause instanceof ApiError && cause.code === 'stale_form_version' ? t('submission.form_stale') : t('submission.form_save_error')) }
    finally { setBusy(false) }
  }
  if (!form) return error ? <div role="alert"><p>{error}</p><Button onClick={() => void load()}>{t('participant.retry')}</Button></div> : <PageSkeleton />
  return <section className="space-y-6 rounded-xl border p-5" aria-labelledby="submission-manager-title">
    <div><h2 id="submission-manager-title" className="text-xl font-semibold">{t('submission.manage')}</h2><p className="mt-1 text-sm text-muted-foreground">{t('submission.manage_help')}</p></div>
    {error && <div role="alert" className="space-y-2"><p>{error}</p>{error === t('submission.form_stale') && <Button variant="outline" onClick={() => void load(undefined, true)}>{t('submission.reload')}</Button>}</div>}
    {message && <p role="status">{message}</p>}
    <fieldset disabled={readOnly || busy} className="space-y-5">
      <label className="flex items-center gap-2"><input type="checkbox" checked={form.enabled} onChange={e => { dirty.current = true; setForm({ ...form, enabled: e.target.checked }) }} />{t('submission.enabled')}</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={form.allowEdits} onChange={e => { dirty.current = true; setForm({ ...form, allowEdits: e.target.checked }) }} />{t('submission.allow_edits')}</label>
      <CustomQuestionsEditor submission value={form.questions} form={{ ...baseForm, customQuestions: form.questions }} onChange={questions => { dirty.current = true; setForm({ ...form, questions }) }} />
      {!readOnly && <Button type="button" disabled={busy} onClick={() => void save()}>{t('common.save')}</Button>}
    </fieldset>
    <div className="space-y-3"><h3 className="font-semibold">{t('submission.received', { count: records.length })}</h3>
      {records.length === 0 ? <p className="text-sm text-muted-foreground">{t('submission.no_answers')}</p> : records.map(record => <article key={record.userId} className="space-y-3 rounded-xl border p-4">
        <h4 className="font-medium">{record.userId}</h4>
        <dl className="space-y-2">{Object.entries(record.answers).map(([id, answer]) => {
          const question = form.questions.find(q => q.id === id)
          const title = question?.label[locale] || question?.label.en || id
          const values = Array.isArray(answer) ? answer : [answer]
          return <div key={id}><dt className="text-sm font-medium">{title}</dt><dd className="whitespace-pre-wrap text-sm text-muted-foreground">{values.map(value => question?.choices?.find(choice => choice.id === value)?.label[locale] || question?.choices?.find(choice => choice.id === value)?.label.en || value).join(', ')}</dd></div>
        })}</dl>
      </article>)}
    </div>
  </section>
}
