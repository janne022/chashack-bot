import { useEffect, useState } from 'react'
import { Info, Hexagon, ArrowUpRight } from 'lucide-react'

import { useLocale, useT, setLocale } from '@/lib/i18n'

/** Reasons the OAuth callback can bounce back with (`/?auth=…`). */
const AUTH_ERRORS: Record<string, string> = {
  cancelled: 'login.auth_cancelled',
  bad_state: 'login.auth_failed',
  no_code: 'login.auth_failed',
  exchange_failed: 'login.auth_failed',
  identity_failed: 'login.auth_failed',
  redirect_uri_unconfigured: 'login.auth_misconfigured',
  error: 'login.auth_failed',
  no_guild: 'login.auth_no_guild',
}

export function LoginView({ notice }: { notice?: string | null }) {
  const [bounced, setBounced] = useState<string | null>(null)

  const t = useT()
  const locale = useLocale()

  useEffect(() => {
    // Bounced login attempt: the callback redirects here with a reason.
    const reason = new URLSearchParams(window.location.search).get('auth')
    setBounced(reason)
  }, [])

  const bounceKey = bounced !== null ? AUTH_ERRORS[bounced] : undefined

  return <main className="login-workspace min-h-screen bg-background text-foreground">
    <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-7"><a href="/" className="inline-flex items-center gap-3 text-xl font-semibold"><Hexagon className="size-7 text-accent" aria-hidden="true" />ChasHack</a><button type="button" onClick={() => setLocale(locale === 'en' ? 'sv' : 'en')} aria-label={t('common.language', { locale: locale.toUpperCase() })} className="min-h-11 min-w-11 rounded-lg border px-3 text-sm">{locale.toUpperCase()}</button></header>
    <div className="mx-auto grid max-w-6xl gap-12 px-6 py-16 lg:grid-cols-[1.25fr_1fr] lg:items-center lg:gap-24 lg:py-28">
      <section><p className="mb-6 text-sm font-medium text-accent">{t('login.organizer')}</p><h1 className="max-w-xl text-5xl font-semibold leading-[1.05] tracking-[-.05em] sm:text-6xl">{t('login.headline')}</h1><p className="mt-7 max-w-md text-lg leading-relaxed text-muted-foreground">{t('login.intro')}</p><div className="mt-12 flex items-center gap-4 border-t pt-6"><span className="flex -space-x-2" aria-hidden="true">{['C', 'H', '+'].map(letter => <span key={letter} className="grid size-10 place-items-center rounded-full border-2 border-background bg-surface-2 text-xs font-semibold">{letter}</span>)}</span><p className="max-w-60 text-sm text-muted-foreground">{t('login.community')}</p></div></section>
      <section className="rounded-2xl border bg-card p-7 sm:p-9"><h2 className="text-2xl font-semibold tracking-tight">{t('common.workspace')}</h2><p className="mb-8 mt-3 text-sm leading-relaxed text-muted-foreground">{t('login.tagline')}</p>
        {notice && <p role="alert" className="mb-5 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm">{notice === 'access_refused' ? t('login.access_refused') : notice}</p>}
        {bounceKey && <p role="alert" className="mb-5 rounded-lg border border-danger/40 bg-danger/10 p-3 text-sm">{t(bounceKey)}</p>}
        <a href="/auth/discord" className="flex min-h-12 items-center justify-center gap-3 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90"><DiscordGlyph />{t('login.with_discord')}<ArrowUpRight size={17} aria-hidden="true" /></a>
        <p className="mt-5 flex items-start gap-2 text-sm leading-relaxed text-muted-foreground"><Info className="mt-1 size-4 shrink-0" aria-hidden="true" />{t('login.discord_hint')}</p>
      </section>
    </div>
  </main>
}

/** Discord's mark, inline — one icon does not justify pulling in an icon set. */
function DiscordGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-current">
      <path d="M20.32 4.57A19.8 19.8 0 0 0 15.4 3c-.2.36-.44.85-.6 1.24a18.3 18.3 0 0 0-5.6 0C9.03 3.85 8.79 3.36 8.6 3a19.7 19.7 0 0 0-4.93 1.57C.6 9.06-.28 13.45.16 17.78a19.9 19.9 0 0 0 6.03 3.05c.49-.67.92-1.38 1.3-2.13-.71-.27-1.4-.6-2.04-1 .17-.12.34-.25.5-.38a14.2 14.2 0 0 0 12.1 0c.16.14.33.26.5.38-.65.4-1.34.73-2.05 1 .37.75.81 1.46 1.3 2.13a19.8 19.8 0 0 0 6.04-3.05c.52-5.02-.87-9.37-3.52-13.21ZM8.02 15.1c-1.18 0-2.15-1.08-2.15-2.4 0-1.33.95-2.41 2.15-2.41 1.2 0 2.17 1.09 2.15 2.4 0 1.33-.95 2.41-2.15 2.41Zm7.96 0c-1.18 0-2.15-1.08-2.15-2.4 0-1.33.95-2.41 2.15-2.41 1.2 0 2.17 1.09 2.15 2.4 0 1.33-.95 2.41-2.15 2.41Z" />
    </svg>
  )
}
