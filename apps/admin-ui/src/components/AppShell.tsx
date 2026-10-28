import { useContext, useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from '@tanstack/react-router'
import { motion, useReducedMotion } from 'framer-motion'
import {
  CalendarDays,
  History,
  Sun,
  Moon,
  Monitor,
  ChevronsUpDown,
  LogOut,
  UserRound,
  Settings,
  LayoutTemplate,
  Briefcase,
  TriangleAlert,
  Globe,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ServerSwitcher } from '@/components/ServerSwitcher'
import { ServerContext } from '@/components/ServerGate'
import { api } from '@/api'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { useAppContext } from '@/lib/app-context'
import { discordAvatarUrl } from '@/lib/discord-avatar'
import { clearSessionCache } from '@/lib/session-cache'
import { useT, useLocale, setLocale, type Locale } from '@/lib/i18n'
import type { AppState, AuthMe } from '@/types'
import brandMark from '@/assets/brand/1.png'

const NAV_KEYS = [
  { to: '/events', key: 'nav.events', icon: CalendarDays },
  { to: '/operations', key: 'nav.operations', icon: Briefcase },
  { to: '/templates', key: 'nav.templates', icon: LayoutTemplate },
  { to: '/config', key: 'nav.config', icon: Settings },
  { to: '/audit', key: 'nav.audit', icon: History },
] as const

type ThemeMode = 'light' | 'dark' | 'system'
const THEME_KEY = 'chas-theme'
const THEME_OPTIONS: { value: ThemeMode; icon: typeof Sun; labelKey: string }[] = [
  { value: 'light', icon: Sun, labelKey: 'common.theme_light_mode' },
  { value: 'dark', icon: Moon, labelKey: 'common.theme_dark_mode' },
  { value: 'system', icon: Monitor, labelKey: 'common.theme_system' },
]

/** Stored choice, defaulting to following the operating system. */
function storedTheme(): ThemeMode {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system') return stored
  } catch { /* storage unavailable */ }
  return 'system'
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * App shell — "Honeycomb playtech" world.
 * Router-aware sidebar; theme menu (light / dark / system) persists in
 * localStorage; language and account controls are available on both layouts.
 */
export function AppShell({
  state,
  children,
}: {
  state: AppState
  refresh: () => Promise<void>
  children: ReactNode
}) {
  const location = useLocation()
  const pathname = location.pathname
  const isActive = (to: string) => pathname === to || pathname.startsWith(`${to}/`)

  const t = useT()
  const reducedMotion = useReducedMotion()
  const account = useContext(ServerContext)?.user ?? null

  const [theme, setTheme] = useState<ThemeMode>(storedTheme)
  const [systemDark, setSystemDark] = useState(systemPrefersDark)

  // `system` follows the OS live — no reload needed when the device switches.
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  const effectiveTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme
    // shadcn's dark variant is class-based (@custom-variant dark) — keep the
    // class in sync with data-theme so registry components follow the choice.
    document.documentElement.classList.toggle('dark', effectiveTheme === 'dark')
  }, [effectiveTheme])

  function selectTheme(next: ThemeMode) {
    setTheme(next)
    try { localStorage.setItem(THEME_KEY, next) } catch { /* storage unavailable */ }
  }

  return (
    <div className="organizer-workspace min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col overflow-y-auto border-r border-border bg-card p-5 lg:flex">
        <div className="mb-6 flex items-center gap-3 px-1 pt-1">
          <img src={brandMark} alt="" className="hex-badge size-9 object-cover" />
          <div>
            <div className="font-display text-base leading-tight text-foreground">
              {t('common.app_name')}
            </div>
            <div className="text-xs text-muted-foreground">{t('common.organizer_console')}</div>
          </div>
        </div>
        <ServerSwitcher />
        <nav className="flex flex-col gap-1" aria-label={t('common.sections')}>
          {NAV_KEYS.map(({ to, key, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              aria-current={isActive(to) ? 'page' : undefined}
              className={cn(
                'group relative flex items-center gap-3 min-h-11 rounded-xl px-3 py-2 text-sm font-semibold transition-all',
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
        <EventSwitcher state={state} />
        <div className="mt-auto flex flex-col gap-2 pb-1">
          <div className="hex-bg rounded-xl border border-border p-3">
            <div className="font-display text-2xl text-accent">{state.stats.active}</div>
            <div className="text-xs text-muted-foreground">{t('common.active_signups')}</div>
          </div>
          {account && <AccountMenu user={account} theme={theme} onThemeChange={selectTheme} />}
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <img src={brandMark} alt="" className="hex-badge size-7 object-cover" />
          <span className="font-display text-sm">{t('common.app_name')}</span>
        </div>
        <div className="flex gap-1">
          {account && <AccountMenu user={account} compact theme={theme} onThemeChange={selectTheme} />}
        </div>
      </div>

      {/* Content */}
      <main className="min-w-0 flex-1 px-4 pb-20 pt-6 lg:px-8 lg:pb-10 lg:pt-8">
        <div className="mx-auto mb-7 flex max-w-6xl flex-wrap items-center justify-between gap-3 border-b pb-5 text-sm">
          <p className="hidden text-muted-foreground lg:block">{t('common.workspace')}</p>
          {state.selectedEventId && <p className="flex items-center gap-2"><CalendarDays size={16} aria-hidden="true" /><span className="text-muted-foreground">{t('common.event_context')}</span><strong className="font-medium">{state.events?.find(event => event.id === state.selectedEventId)?.name}</strong></p>}
          <div className="w-full lg:hidden"><ServerSwitcher compact /><EventSwitcher state={state} /></div>
        </div>
        {state.guildConfigured === false && (
          <div className="mx-auto mb-4 flex w-full max-w-6xl items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
            <div className="flex-1">
              <div className="font-semibold text-amber-600 dark:text-amber-400">
                Discord not configured — <code className="rounded bg-amber-500/20 px-1 py-0.5">DISCORD_GUILD_ID</code> is missing or invalid (got &quot;{state.guildId}&quot;).
              </div>
              <div className="mt-1 text-muted-foreground">
                Announce, panel, and guild channels will fail. Set <code>DISCORD_GUILD_ID</code> to your guild&apos;s snowflake (right-click server → Copy ID) in <code>.env</code> and restart the bot. Invite link is in <Link to="/config" className="underline decoration-dotted underline-offset-2">Config</Link>.
              </div>
            </div>
            <Link to="/config">
              <Button size="sm" variant="outline" className="shrink-0 border-amber-500/40">
                Open Config
              </Button>
            </Link>
          </div>
        )}
        <motion.div
          key={pathname}
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.12, ease: 'easeOut' }}
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

function AccountAvatar({ user }: { user: NonNullable<AuthMe['user']> }) {
  const [failed, setFailed] = useState(false)
  const avatarUrl = discordAvatarUrl(user)
  return <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-full bg-surface-2 text-sm font-semibold text-foreground" aria-hidden="true">
    {avatarUrl && !failed ? <img src={avatarUrl} alt="" className="size-full object-cover" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : user.username.trim() ? Array.from(user.username.trim())[0]?.toLocaleUpperCase() : <UserRound className="size-4" />}
  </span>
}

function AccountMenu({ user, compact = false, theme, onThemeChange }: { user: NonNullable<AuthMe['user']>; compact?: boolean; theme: ThemeMode; onThemeChange: (value: ThemeMode) => void }) {
  const t = useT()
  const queryClient = useQueryClient()
  const locale = useLocale()
  const signOut = async () => {
    try { await api.logout(); await clearSessionCache(queryClient); window.location.assign('/') }
    catch { toast.error(t('common.sign_out_failed')) }
  }
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" className={compact ? 'size-11 p-1' : 'min-h-12 w-full justify-start gap-3 rounded-xl px-2'} aria-label={t('common.account_menu', { name: user.username })}>
        <AccountAvatar key={`${user.id}:${user.avatar}`} user={user} />
        {!compact && <><span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left text-sm font-medium">{user.username}</span><ChevronsUpDown className="size-4 text-muted-foreground" /></>}
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align={compact ? 'end' : 'start'} side={compact ? 'bottom' : 'top'} className="w-48">
      <DropdownMenuSub>
        <DropdownMenuSubTrigger><Monitor />{t('common.theme_mode')}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-48">
          <DropdownMenuRadioGroup value={theme} onValueChange={value => onThemeChange(value as ThemeMode)}>
            {THEME_OPTIONS.map(({ value, icon: Icon, labelKey }) => <DropdownMenuRadioItem key={value} value={value}><Icon className="mr-1.5 size-4" />{t(labelKey)}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger><Globe />{t('common.choose_language')}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-40">
          <DropdownMenuRadioGroup value={locale} onValueChange={value => setLocale(value as Locale)}>
            <DropdownMenuRadioItem value="en" lang="en">English</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="sv" lang="sv">Svenska</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onSelect={() => void signOut()}><LogOut />{t('server.sign_out')}</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
}

/**
 * Lets the organizer pick which event the participant/team/matching views show.
 * Only rendered when more than one event is live — in a single-event setup it
 * would be noise, so it renders nothing.
 */
function EventSwitcher({ state }: { state: AppState }) {
  const t = useT()
  const { selectEvent } = useAppContext()
  const events = state.events ?? []
  const live = events.filter((e) => e.status === 'active')

  if (live.length < 2) return null

  const currentId = state.selectedEventId ?? live[0]?.id ?? ''

  return (
    <div className="mt-4 flex flex-col gap-1.5 rounded-xl border border-border bg-surface-2/40 p-2.5">
      <span className="px-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t('common.event_context')}
      </span>
      <Select value={currentId} onValueChange={selectEvent}>
        <SelectTrigger aria-label={t('common.event_context')} className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {live.map((e) => (
            <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
