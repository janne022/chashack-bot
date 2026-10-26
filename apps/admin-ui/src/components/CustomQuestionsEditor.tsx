import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/textarea-label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { CustomQuestion, FormConfig } from '@/types'
import { useT } from '@/lib/i18n'
import { questionErrors } from '@/lib/question-validation'
import { secureId } from '@/lib/secure-id'

export function CustomQuestionsEditor({ value, onChange, form }: { value: CustomQuestion[]; onChange: (next: CustomQuestion[]) => void; form: FormConfig }) {
  const t = useT()
  const errors = questionErrors(form)
  const invalid = (id: string) => ({ id, 'aria-invalid': !!errors[id], 'aria-describedby': errors[id] ? `${id}-error` : undefined })
  const error = (id: string) => errors[id] ? <span id={`${id}-error`} className="text-sm text-danger">{t(errors[id])}</span> : null
  const update = (id: string, patch: Partial<CustomQuestion>) => onChange(value.map(q => {
    if (q.id !== id) return q
    const next = { ...q, ...patch }
    if (next.mapping) {
      if (!['single_choice', 'multi_choice'].includes(next.kind) || next.visibility === 'organizer_only' || (next.kind === 'multi_choice' && next.mapping.field !== 'skills')) next.mapping = undefined
      else next.mapping = { ...next.mapping, choiceValues: Object.fromEntries((next.choices ?? []).map(c => [c.id, next.mapping!.choiceValues[c.id] ?? ''])) }
    }
    return next
  }))
  const add = () => onChange([...value, { id: secureId(), kind: 'text', label: { en: '', sv: '' }, help: { en: '', sv: '' }, required: false, presentation: 'web', visibility: 'self_and_organizer' }])
  const targets = { experience: form.experiences, role: form.roleTracks, skills: form.skills }
  return <section className="flex flex-col gap-3" aria-labelledby="custom-questions-title">
    <div><h3 id="custom-questions-title" className="text-base font-semibold">{t('form.custom_questions')}</h3><p className="text-sm text-muted-foreground">{t('form.custom_questions_hint')}</p></div>
    {value.some(q => q.visibility !== 'organizer_only') && <p className="rounded-lg border border-border bg-surface-2 p-3 text-sm">{t('form.discord_limit')}</p>}
    {value.map((q, index) => <fieldset key={q.id} className="flex flex-col gap-3 rounded-lg border border-border p-3"><legend className="px-1 text-sm font-medium">{t('form.question_number', { count: index + 1 })} · <code>{q.id}</code></legend>
      <div className="grid gap-3 sm:grid-cols-2">{(['en', 'sv'] as const).map(lang => <label key={lang} className="flex flex-col gap-1.5 text-sm"><Label>{t(lang === 'en' ? 'form.english_label' : 'form.swedish_label')}</Label><Input {...(lang === 'en' ? invalid(`${q.id}-label`) : {})} value={q.label[lang] ?? ''} maxLength={200} onChange={e => update(q.id, { label: { ...q.label, [lang]: e.target.value } })} />{lang === 'en' && error(`${q.id}-label`)}</label>)}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm"><Label>{t('form.answer_type')}</Label><Select value={q.kind} onValueChange={kind => update(q.id, { kind: kind as CustomQuestion['kind'], choices: !['single_choice', 'multi_choice'].includes(kind) ? undefined : q.choices ?? [{ id: secureId(), label: { en: '', sv: '' } }] })}><SelectTrigger {...invalid(`${q.id}-kind`)}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="slider">{t('form.slider')}</SelectItem><SelectItem value="toggle">{t('form.toggle')}</SelectItem><SelectItem value="text">{t('form.text')}</SelectItem><SelectItem value="single_choice">{t('form.single_choice')}</SelectItem><SelectItem value="multi_choice">{t('form.multi_choice')}</SelectItem></SelectContent></Select>{error(`${q.id}-kind`)}</label>
        <label className="flex flex-col gap-1.5 text-sm"><Label>{t('form.visibility')}</Label><Select value={q.visibility} onValueChange={visibility => update(q.id, { visibility: visibility as CustomQuestion['visibility'], mapping: visibility === 'organizer_only' ? undefined : q.mapping })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="self_and_organizer">{t('form.shared')}</SelectItem><SelectItem value="organizer_only">{t('form.private')}</SelectItem></SelectContent></Select></label>
      </div>
      <div className="flex flex-wrap gap-5 text-sm"><Checkbox checked={q.required} onCheckedChange={checked => update(q.id, { required: checked === true })}>{t('form.required')}</Checkbox></div>
      {['single_choice', 'multi_choice'].includes(q.kind) && <div className="flex flex-col gap-2"><h4 className="text-sm font-medium">{t('form.choices')}</h4>{(q.choices ?? []).map(choice => <div key={choice.id} className="grid grid-cols-[1fr_1fr_auto] gap-2"><div><Input {...invalid(`${q.id}-${choice.id}-label`)} aria-label={`${t('form.english_label')} ${choice.id}`} value={choice.label.en} maxLength={200} onChange={e => update(q.id, { choices: q.choices?.map(c => c.id === choice.id ? { ...c, label: { ...c.label, en: e.target.value } } : c) })} />{error(`${q.id}-${choice.id}-label`)}</div><Input aria-label={`${t('form.swedish_label')} ${choice.id}`} value={choice.label.sv ?? ''} maxLength={200} onChange={e => update(q.id, { choices: q.choices?.map(c => c.id === choice.id ? { ...c, label: { ...c.label, sv: e.target.value } } : c) })} /><Button type="button" variant="ghost" aria-label={`${t('common.delete')} ${choice.id}`} onClick={() => update(q.id, { choices: q.choices?.filter(c => c.id !== choice.id) })}><Trash2 className="size-4" /></Button></div>)}
        <Button type="button" variant="outline" className="w-fit" disabled={(q.choices?.length ?? 0) >= 25} onClick={() => update(q.id, { choices: [...(q.choices ?? []), { id: secureId(), label: { en: '', sv: '' } }] })}><Plus className="size-4" /> {t('form.add_choice')}</Button>
        <label className="flex flex-col gap-1.5 text-sm"><Label>{t('form.matching_field')}</Label><Select disabled={q.visibility === 'organizer_only'} value={q.mapping?.field ?? 'none'} onValueChange={field => { if (field === 'none') update(q.id, { mapping: undefined }); else { const key = field as keyof typeof targets; update(q.id, { mapping: { field: key, importance: 'normal', choiceValues: Object.fromEntries((q.choices ?? []).map(c => [c.id, ''])) } }) } }}><SelectTrigger {...invalid(`${q.id}-mapping`)}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t('form.no_effect')}</SelectItem>{q.kind === 'single_choice' && <><SelectItem value="experience">{t('form.experience')}</SelectItem><SelectItem value="role">{t('form.role')}</SelectItem></>}{(q.kind === 'single_choice' || q.kind === 'multi_choice') && <SelectItem value="skills">{t('form.skills')}</SelectItem>}</SelectContent></Select>{error(`${q.id}-mapping`)}</label>
        {q.mapping && <div className="flex flex-col gap-2 rounded-md bg-surface-2/50 p-3"><label className="flex items-center gap-2 text-sm">{t('form.importance')} <Select value={q.mapping.importance} onValueChange={importance => update(q.id, { mapping: { ...q.mapping!, importance: importance as NonNullable<CustomQuestion['mapping']>['importance'] } })}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">{t('form.low')}</SelectItem><SelectItem value="normal">{t('form.normal')}</SelectItem><SelectItem value="high">{t('form.high')}</SelectItem></SelectContent></Select></label>{(q.choices ?? []).map(c => <label key={c.id} className="grid grid-cols-[1fr_minmax(9rem,1fr)] items-center gap-2 text-sm"><span>{c.label.en || c.id}</span><Select value={q.mapping?.choiceValues[c.id] || 'unmapped'} onValueChange={target => update(q.id, { mapping: { ...q.mapping!, choiceValues: { ...q.mapping!.choiceValues, [c.id]: target === 'unmapped' ? '' : target } } })}><SelectTrigger {...invalid(`${q.id}-${c.id}-target`)}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unmapped">{t('form.unmapped')}</SelectItem>{targets[q.mapping!.field].map(option => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent></Select>{error(`${q.id}-${c.id}-target`)}</label>)}</div>}
      </div>}
      <Button type="button" variant="ghost" className="w-fit text-danger" onClick={() => onChange(value.filter(item => item.id !== q.id))}><Trash2 className="size-4" /> {t('form.remove_question')}</Button>
    </fieldset>)}
    <Button type="button" variant="outline" className="w-fit" disabled={value.length >= 25} onClick={add}><Plus className="size-4" /> {t('form.add_question')}</Button>
  </section>
}
