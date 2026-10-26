import { useT } from '@/lib/i18n'

export function PageSkeleton() {
  const t = useT()
  return <div className="mx-auto w-full max-w-5xl space-y-6 p-6" role="status" aria-busy="true">
    <span className="sr-only">{t('common.loading')}</span>
    <div aria-hidden="true" className="space-y-6 motion-safe:animate-pulse">
      <div className="h-6 w-32 rounded bg-current/10" />
      <div className="h-12 w-2/3 rounded bg-current/10" />
      <div className="h-5 w-1/2 rounded bg-current/10" />
      <div className="grid gap-5 sm:grid-cols-2">{[0, 1, 2, 3].map(i => <div key={i} className="h-40 rounded-2xl border border-current/10 bg-current/5" />)}</div>
    </div>
  </div>
}
