import { lazy, Suspense, useState } from 'react'
import { LogIn } from 'lucide-react'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/textarea-label'
import { useLocale, useT, setLocale } from '@/lib/i18n'
import brandMark from '@/assets/brand/1.png'
import wordmark from '@/assets/brand/4.png'

// Three.js is ~1MB — keep it out of the main bundle; only the login needs it.
const HexHero = lazy(() =>
  import('@/components/HexHero').then((m) => ({ default: m.HexHero })),
)

export function LoginView({ onLogin }: { onLogin: (password: string) => Promise<void> }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const t = useT()
  const locale = useLocale()

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
          <img src={brandMark} alt="ChasHack" className="size-20 drop-shadow-[0_0_24px_rgba(85,187,218,0.35)]" />
          <img src={wordmark} alt="ChasHack" className="-mt-2 max-w-56 mix-blend-screen" />
          <p className="mt-3 text-sm text-muted-foreground">{t('login.tagline')}</p>
        </div>
        <motion.form
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          onSubmit={submit}
          className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-6 shadow-2xl"
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="password">{t('login.password')}</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoFocus
              required
            />
          </div>
          {error !== null && <p className="text-sm text-danger">{error}</p>}
          <Button type="submit" disabled={busy || password === ''} className="font-display">
            <LogIn />
            {busy ? t('login.signing_in') : t('login.enter')}
          </Button>
        </motion.form>
      </div>
    </div>
  )
}
