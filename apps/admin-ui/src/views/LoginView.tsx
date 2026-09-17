import { lazy, Suspense, useEffect, useState } from 'react'
import { Info, LogIn } from 'lucide-react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/textarea-label'
import { api } from '@/api'
import { useLocale, useT, setLocale } from '@/lib/i18n'
import brandMark from '@/assets/brand/1.png'
import wordmark from '@/assets/brand/4.png'

// Three.js is ~1MB — keep it out of the main bundle; only the login needs it.
const HexHero = lazy(() =>
  import('@/components/HexHero').then((m) => ({ default: m.HexHero })),
)

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

export function LoginView({ onLogin }: { onLogin: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [oauthEnabled, setOauthEnabled] = useState<boolean | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const [bounced, setBounced] = useState<string | null>(null)

  const t = useT()
  const locale = useLocale()

  useEffect(() => {
    // Bounced login attempt: the callback redirects here with a reason.
    const reason = new URLSearchParams(window.location.search).get('auth')
    setBounced(reason)
    setShowPassword(reason !== null)
    void api
      .authMode()
      .then((mode) => {
        setOauthEnabled(mode.oauth)
        // With Discord available the password form is the fallback, not the default.
        if (!mode.oauth) setShowPassword(true)
      })
      .catch(() => {
        setOauthEnabled(false)
        setShowPassword(true)
      })
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await onLogin(password)
    } catch {
      setError(t('login.wrong_password'))
    } finally {
      setBusy(false)
    }
  }

  const bounceKey = bounced !== null ? AUTH_ERRORS[bounced] : undefined

  return (
    <div className="hex-bg relative grid min-h-screen place-items-center overflow-hidden p-6">
      <Suspense fallback={null}>
        <HexHero />
      </Suspense>
      <button
        type="button"
        onClick={() => setLocale(locale === 'en' ? 'sv' : 'en')}
        aria-label={t('common.language', { locale: locale.toUpperCase() })}
        className="absolute right-4 top-4 z-20 flex items-center gap-1 rounded-lg border border-border bg-surface/80 px-2.5 py-1.5 text-xs font-semibold text-muted-foreground backdrop-blur transition-colors hover:text-foreground"
      >
        🌐 {locale.toUpperCase()}
      </button>
      <div className="relative z-10 w-full max-w-sm animate-pop-in">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src={brandMark} alt="ChasHack" className="size-20 drop-shadow-[0_0_24px_var(--color-sky)]" />
          <img src={wordmark} alt="ChasHack" className="-mt-2 max-w-56 mix-blend-screen" />
          <p className="mt-3 text-sm text-muted-foreground">{t('login.tagline')}</p>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6 shadow-2xl"
        >
          {bounceKey !== undefined && (
            <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {t(bounceKey)}
            </p>
          )}

          {oauthEnabled === true && (
            <>
              <a
                href="/auth/discord"
                className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#5865F2] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#4752C4] focus-visible:ring-3 focus-visible:ring-accent/50 focus-visible:outline-none"
              >
                <DiscordGlyph />
                {t('login.with_discord')}
              </a>
              <p className="flex items-start gap-1.5 text-left text-xs text-muted-foreground">
                <Info className="mt-0.5 size-3.5 shrink-0" />
                {t('login.discord_hint')}
              </p>
              {!showPassword && (
                <button
                  type="button"
                  onClick={() => setShowPassword(true)}
                  className="self-center text-xs text-muted-foreground underline decoration-muted-foreground/50 underline-offset-4 transition-colors hover:text-foreground"
                >
                  {t('login.use_password')}
                </button>
              )}
            </>
          )}

          {showPassword && (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="password">{t('login.password')}</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoFocus={oauthEnabled !== true}
                  required
                />
              </div>
              {error !== null && <p className="text-sm text-danger">{error}</p>}
              <Button type="submit" disabled={busy || password === ''} className="font-display">
                <LogIn />
                {busy ? t('login.signing_in') : t('login.enter')}
              </Button>
            </form>
          )}

          {oauthEnabled === null && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="size-2 animate-pulse rounded-full bg-accent" />
              {t('login.checking')}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  )
}

/** Discord's mark, inline — one icon does not justify pulling in an icon set. */
function DiscordGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-current">
      <path d="M20.32 4.57A19.8 19.8 0 0 0 15.4 3c-.2.36-.44.85-.6 1.24a18.3 18.3 0 0 0-5.6 0C9.03 3.85 8.79 3.36 8.6 3a19.7 19.7 0 0 0-4.93 1.57C.6 9.06-.28 13.45.16 17.78a19.9 19.9 0 0 0 6.03 3.05c.49-.67.92-1.38 1.3-2.13-.71-.27-1.4-.6-2.04-1 .17-.12.34-.25.5-.38a14.2 14.2 0 0 0 12.1 0c.16.14.33.26.5.38-.65.4-1.34.73-2.05 1 .37.75.81 1.46 1.3 2.13a19.8 19.8 0 0 0 6.04-3.05c.52-5.02-.87-9.37-3.52-13.21ZM8.02 15.1c-1.18 0-2.15-1.08-2.15-2.4 0-1.33.95-2.41 2.15-2.41 1.2 0 2.17 1.09 2.15 2.4 0 1.33-.95 2.41-2.15 2.41Zm7.96 0c-1.18 0-2.15-1.08-2.15-2.4 0-1.33.95-2.41 2.15-2.41 1.2 0 2.17 1.09 2.15 2.4 0 1.33-.95 2.41-2.15 2.41Z" />
    </svg>
  )
}
