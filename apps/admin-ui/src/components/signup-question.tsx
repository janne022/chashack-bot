import { Checkbox } from '@/components/ui/checkbox'
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
  const help = question.help ? label(question.help) : ''
  return <fieldset id={question.kind === 'multi_choice' ? question.id : undefined} tabIndex={question.kind === 'multi_choice' ? -1 : undefined} className="space-y-3 rounded-lg border bg-card p-5" aria-describedby={invalid ? errorId : undefined}>
    {question.kind === 'multi_choice' ? <legend className="px-1 text-base font-semibold">{title}{question.required ? ' *' : ''}</legend> : <Label htmlFor={question.id} className="text-base font-semibold">{title}{question.required ? ' *' : ''}</Label>}
    {help && <p className="text-sm opacity-80">{help}</p>}
    {question.kind === 'single_choice' ? (
      <Select value={typeof answer === 'string' && answer ? answer : '__none__'} onValueChange={value => onChange(value === '__none__' ? '' : value)}>
        <SelectTrigger id={question.id} aria-label={title} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined}><SelectValue placeholder={t('participant.signup_choose')} /></SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">{t('participant.signup_choose')}</SelectItem>
          {question.choices?.map(option => <SelectItem key={option.id} value={option.id}>{label(option.label)}</SelectItem>)}
        </SelectContent>
      </Select>
    ) : question.kind === 'multi_choice' ? (
      <div className="space-y-3">
        {question.choices?.map(option => {
          const selected = Array.isArray(answer) ? answer : []
          return <label key={option.id} className="flex min-h-10 items-center gap-3">
            <Checkbox checked={selected.includes(option.id)} aria-invalid={invalid} onCheckedChange={checked => onChange(checked ? [...selected, option.id] : selected.filter(id => id !== option.id))} />
            <span>{label(option.label)}</span>
          </label>
        })}
      </div>
    ) : question.kind === 'text' ? (
      <Textarea id={question.id} value={typeof answer === 'string' ? answer : ''} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} onChange={event => onChange(event.target.value)} />
    ) : (
      <Input id={question.id} value={typeof answer === 'string' ? answer : ''} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} onChange={event => onChange(event.target.value)} />
    )}
    {invalid && <p id={errorId} className="text-sm text-destructive">{t('participant.signup_field_required', { field: title })}</p>}
  </fieldset>
}
