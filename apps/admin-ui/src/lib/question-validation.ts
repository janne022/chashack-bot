import type { FormConfig } from '@/types'

// Mirror the editable definition constraints in features/form/domain.ts.
export function questionErrors(form: FormConfig): Record<string, string> {
  const errors: Record<string, string> = {}
  const mapped = new Set<string>()
  for (const q of form.customQuestions ?? []) {
    if (!q.label.en.trim()) errors[`${q.id}-label`] = 'form.label_required'
    if (q.kind !== 'text') {
      if (!q.choices?.length) errors[`${q.id}-kind`] = 'form.choice_required'
      for (const c of q.choices ?? []) {
        if (!c.label.en.trim()) errors[`${q.id}-${c.id}-label`] = 'form.label_required'
      }
    }
    if (q.mapping) {
      if (mapped.has(q.mapping.field)) errors[`${q.id}-mapping`] = 'form.mapping_duplicate'
      mapped.add(q.mapping.field)
      const targets = q.mapping.field === 'experience' ? form.experiences : q.mapping.field === 'role' ? form.roleTracks : form.skills
      for (const c of q.choices ?? []) {
        if (!targets.some(t => t.id === q.mapping!.choiceValues[c.id])) errors[`${q.id}-${c.id}-target`] = 'form.mapping_required'
      }
    }
  }
  return errors
}

export function validateQuestions(form: FormConfig): boolean {
  const first = Object.keys(questionErrors(form))[0]
  if (!first) return true
  document.getElementById(first)?.focus()
  return false
}
