import { useState, type ReactNode } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { motion } from 'framer-motion'
import {
  CalendarDays,
  Users,
  UsersRound,
  Sparkles,
  ClipboardList,
  History,
  RefreshCw,
  Sun,
  Moon,
  Globe,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useLocale, useT, setLocale } from '@/lib/i18n'
import type { AppState } from '@/types'
import brandMark from '@/assets/brand/1.png'

const NAV_KEYS = [
  { to: '/events', key: 'nav.events', icon: CalendarDays },
  { to: '/participants', key: 'nav.participants', icon: Users },
  { to: '/teams', key: 'nav.teams', icon: UsersRound },
  { to: '/matching', key: 'nav.matching', icon: Sparkles },
  { to: '/form', key: 'nav.form', icon: ClipboardList },
  { to: '/audit', key: 'nav.audit', icon: History },
] as const

/**
 * App shell — "Honeycomb playtech" world.
 * Router-aware sidebar; theme toggle persists in localStorage;
 * language toggle cycles en/sv and persists in localStorage.
 */
export function AppShell({
  state,
  refresh,
  children,
}: {
  state: AppState
  refresh: () => Promise<void>
  children: ReactNode
}) {
  const router = useRouter()
  const pathname = router.state.location.pathname
  const isActive = (to: string) => pathname === to || pathname.startsWith(`${to}/`)

  const t = useT()
  const locale = useLocale()

  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('chas-theme') as 'dark' | 'light') ?? 'dark',
  )

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('chas-theme', next)
    document.documentElement.dataset.theme = next
  }

  function toggleLocale() {
    setLocale(locale === 'en' ? 'sv' : 'en')
  }

  if (document.documentElement.dataset.theme !== theme) {
    document.documentElement.dataset.theme = theme
  }
  // shadcn's dark variant is class-based (@custom-variant dark) — keep the
  // class in sync with data-theme so registry components follow the toggle.
  if (theme === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-hidden border-r border-border bg-surface p-4 pl-6 lg:flex">
        <div className="mb-6 flex items-center gap-3 px-1 pt-1">
          <img src={brandMark} alt="" className="hex-badge size-9 object-cover" />
          <div>
            <div className="font-display text-base leading-tight text-foreground">
              {t('common.app_name')}
            </div>
            <div className="text-xs text-muted-foreground">{t('common.organizer_console')}</div>
          </div>
        </div>
        <nav className="flex flex-col gap-1" aria-label={t('common.sections')}>
          {NAV_KEYS.map(({ to, key, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              aria-current={isActive(to) ? 'page' : undefined}
              className={cn(
                'group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition-all',
                isActive(to)
                  ? 'bg-accent-soft text-accent'
                  : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
              )}
            >
              {isActive(to) && (
                <span
                  className="hex-badge absolute top-1/2 -left-4 size-2.5 -translate-y-1/2 bg-accent"
                  aria-hidden
                />
              )}
              <Icon className="size-4 shrink-0" />
              {t(key)}
            </Link>
          ))}
        </nav>
        <div className="mt-auto flex flex-col gap-2 pb-1">
          <div className="hex-bg rounded-xl border border-border p-3">
            <div className="font-display text-2xl text-accent">{state.stats.active}</div>
            <div className="text-xs text-muted-foreground">{t('common.active_signups')}</div>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={() => void refresh()} aria-label={t('common.refresh_data')}>
              <RefreshCw />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleTheme}
              aria-label={t('common.switch_theme', { mode: theme === 'dark' ? t('common.theme_light') : t('common.theme_dark') })}
            >
              {theme === 'dark' ? <Sun /> : <Moon />}
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleLocale} aria-label={t('common.language', { locale: locale.toUpperCase() })}>
              <span className="flex items-center gap-0.5 text-[10px] font-bold">
                <Globe className="size-4" />
                {locale.toUpperCase()}
              </span>
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <img src={brandMark} alt="" className="hex-badge size-7 object-cover" />
          <span className="font-display text-sm">{t('common.app_name')}</span>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => void refresh()} aria-label={t('common.refresh_data')}>
            <RefreshCw />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            aria-label={t('common.switch_theme', { mode: theme === 'dark' ? t('common.theme_light') : t('common.theme_dark') })}
          >
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
          <Button variant="ghost" size="icon" onClick={toggleLocale} aria-label={t('common.language', { locale: locale.toUpperCase() })}>
            <span className="flex items-center gap-0.5 text-[10px] font-bold">
              <Globe className="size-4" />
              {locale.toUpperCase()}
            </span>
          </Button>
        </div>
      </div>

      {/* Content */}
      <main className="min-w-0 flex-1 px-4 pb-20 pt-6 lg:px-8 lg:pb-10 lg:pt-8">
        <motion.div
          key={pathname}
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="mx-auto flex w-full max-w-6xl flex-col gap-6"
        >
          {children}
        </motion.div>
      </main>

      {/* Mobile bottom tabs */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur lg:hidden"
        aria-label={t('common.sections')}
      >
        <div className="mx-auto flex max-w-lg items-stretch justify-around">
          {NAV_KEYS.map(({ to, key, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              aria-current={isActive(to) ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold',
                isActive(to) ? 'text-accent' : 'text-muted-foreground',
              )}
            >
              <Icon className="size-5" />
              {t(key)}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  )
}
