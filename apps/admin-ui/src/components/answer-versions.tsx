import type { AnswerVersion } from '@/types'
import { useLocale, useT } from '@/lib/i18n'

export function AnswerVersions({ versions }: { versions: AnswerVersion[] }) {
  const locale = useLocale()
  const t = useT()
  if (!versions.length) return <p className="text-sm text-muted-foreground">{t('answers.empty')}</p>
  return <div className="space-y-5">{versions.map((version, index) => <section key={`${version.formVersion}-${index}`} className="space-y-2">
    <h3 className="font-semibold">{t('answers.version', { version: version.formVersion })}</h3>
    {version.values && Object.keys(version.values).length > 0 && <details><summary className="cursor-pointer text-sm font-medium">{t('answers.imported_values')}</summary><dl className="mt-2 space-y-2">{Object.entries(version.values).map(([key, value]) => <div key={key}><dt className="text-sm font-medium">{key.startsWith('source:') ? key.slice(7) : key}</dt><dd className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{value}</dd></div>)}</dl></details>}
    {version.historicalDefinitionUnavailable && <p className="text-sm text-muted-foreground">{t('answers.definition_unavailable')}</p>}
    {Object.keys(version.answers).length === 0 ? <p className="text-sm text-muted-foreground">{t('answers.empty')}</p> : <dl className="space-y-3">{Object.entries(version.answers).map(([id, answer]) => {
      const question = version.questions.find(q => q.id === id)
      const local = (text: { en: string; sv?: string }) => text[locale] || text.en
      const format = (value: string) => { const choice = question?.choices?.find(item => item.id === value); return choice ? local(choice.label) : value }
      return <div key={id} className="min-w-0"><dt className="text-sm font-medium">{question ? local(question.label) : id}</dt><dd className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{Array.isArray(answer) ? answer.map(format).join(', ') : format(answer)}</dd></div>
    })}</dl>}
  </section>)}</div>
}
