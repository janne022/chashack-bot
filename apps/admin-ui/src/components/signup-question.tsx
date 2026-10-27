import { Input } from '@/components/ui/input'
import { Label, Textarea } from '@/components/ui/textarea-label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useT } from '@/lib/i18n'

export type Localized = string | { en: string; sv?: string }
export type Question = { id: string; label: Localized; help?: Localized; kind: string; required?: boolean; choices?: { id: string; label: Localized }[] }

export function SignupQuestion({ question, answer, invalid, label, onChange, t }: {
  question: Question
  answer: string | string[] | undefined
  invalid: boolean
  label: (value: Localized) => string
  onChange: (value: string | string[]) => void
  t: ReturnType<typeof useT>
}) {
  const title = label(question.label)
  const errorId = `${question.id}-error`
  const helpId = `${question.id}-help`
  const help = question.help ? label(question.help) : ''
  const describedBy = [help ? helpId : '', invalid ? errorId : ''].filter(Boolean).join(' ') || undefined
  return <fieldset id={question.kind === 'multi_choice' ? question.id : undefined} tabIndex={question.kind === 'multi_choice' ? -1 : undefined} className="space-y-3 rounded-2xl border bg-card p-6 sm:p-8" aria-describedby={describedBy}>
    {question.kind === 'multi_choice' ? <legend className="px-1 text-base font-semibold">{title}{question.required ? ` (${t('form.required')})` : ''}</legend> : <Label htmlFor={question.id} className="text-base font-semibold">{title}{question.required ? ' *' : ''}</Label>}
    {help && <p id={helpId} className="text-sm opacity-80">{help}</p>}
    {question.kind === 'slider' ? (
      <div className="space-y-3"><div className="flex justify-between text-sm"><span>1</span><output htmlFor={question.id} className="font-semibold">{answer || t('participant.scale_unanswered')}</output><span>10</span></div><input id={question.id} type="range" min="1" max="10" step="1" value={typeof answer === 'string' && answer ? answer : '5'} aria-label={title} aria-required={question.required} aria-invalid={invalid} aria-describedby={describedBy} aria-valuetext={typeof answer === 'string' && answer ? answer : t('participant.scale_unanswered')} className="min-h-11 w-full accent-current" onChange={event => onChange(event.target.value)} onPointerUp={event => onChange(event.currentTarget.value)} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) onChange(event.currentTarget.value) }} /></div>
    ) : question.kind === 'toggle' ? (
      <div id={question.id} role="radiogroup" tabIndex={-1} aria-label={title} aria-required={question.required} aria-invalid={invalid} aria-describedby={describedBy} className="grid grid-cols-2 gap-3">{['yes', 'no'].map(value => <label key={value} className="participant-choice"><input type="radio" name={question.id} checked={answer === value} onChange={() => onChange(value)} /><span>{t('participant.answer_' + value)}</span></label>)}</div>
    ) : question.kind === 'single_choice' ? (
      <Select value={typeof answer === 'string' && answer ? answer : '__none__'} onValueChange={value => onChange(value === '__none__' ? '' : value)}>
        <SelectTrigger id={question.id} aria-label={title} aria-required={question.required} aria-invalid={invalid} aria-describedby={describedBy}><SelectValue placeholder={t('participant.signup_choose')} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">{t('participant.signup_choose')}</SelectItem>
          {question.choices?.map(option => <SelectItem key={option.id} value={option.id}>{label(option.label)}</SelectItem>)}
        </SelectContent>
      </Select>
    ) : question.kind === 'multi_choice' ? (
      <div className="space-y-3">
        {question.choices?.map(option => {
          const selected = Array.isArray(answer) ? answer : []
          return <label key={option.id} className="participant-choice">
            <input type="checkbox" checked={selected.includes(option.id)} aria-invalid={invalid} onChange={event => onChange(event.target.checked ? [...selected, option.id] : selected.filter(id => id !== option.id))} />
            <span>{label(option.label)}</span>
          </label>
        })}
      </div>
    ) : question.kind === 'text' ? (
      <Textarea id={question.id} value={typeof answer === 'string' ? answer : ''} aria-required={question.required} aria-invalid={invalid} aria-describedby={describedBy} onChange={event => onChange(event.target.value)} />
    ) : (
      <Input id={question.id} value={typeof answer === 'string' ? answer : ''} aria-required={question.required} aria-invalid={invalid} aria-describedby={describedBy} onChange={event => onChange(event.target.value)} />
    )}
    {invalid && <p id={errorId} className="text-sm text-destructive">{t('participant.signup_field_required', { field: title })}</p>}
  </fieldset>
}
