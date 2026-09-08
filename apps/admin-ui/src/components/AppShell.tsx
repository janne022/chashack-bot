import { useState, type ReactNode } from 'react'
import {
  LayoutDashboard,
  Users,
  UsersRound,
  Sparkles,
  ClipboardList,
  History,
  RefreshCw,
  Sun,
  Moon,
  CalendarDays,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { AppState } from '@/types'
import type { TabId } from '@/types-dashboard'
import brandMark from '@/assets/brand/1.png'

const NAV: { id: TabId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Events', icon: CalendarDays },
  { id: 'participants', label: 'Participants', icon: Users },
  { id: 'teams', label: 'Teams', icon: UsersRound },
  { id: 'matching', label: 'Matching', icon: Sparkles },
  { id: 'form', label: 'Form', icon: ClipboardList },
  { id: 'audit', label: 'Audit log', icon: History },
]

/**
 * App shell — "Honeycomb playtech" world.
 * Sidebar with the brand mark, theme toggle, mobile bottom tabs.
 */
export function AppShell({
  state,
  refresh,
  children,
}: {
  state: AppState
  refresh: () => Promise<void>
  children: (tab: TabId, go: (t: TabId) => void) => ReactNode
}) {
  const [tab, setTab] = useState<TabId>('overview')
  const [theme, setTheme] = useState<'dark' | 'light'>(
    () => (localStorage.getItem('chas-theme') as 'dark' | 'light') ?? 'dark',
  )

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    localStorage.setItem('chas-theme', next)
    document.documentElement.dataset.theme = next
  }

  // Apply on first paint
  if (document.documentElement.dataset.theme !== theme) {
    document.documentElement.dataset.theme = theme
  }

  const nav = (compact: boolean) => (
    <>
      {NAV.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => setTab(id)}
          aria-current={tab === id ? 'page' : undefined}
          className={cn(
            'group flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-semibold transition-all',
            'relative',
            tab === id
              ? 'bg-accent-soft text-accent'
              : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
          )}
        >
          {tab === id && (
            <span className="hex-badge absolute -left-2 size-2.5 bg-accent" aria-hidden />
          )}
          <Icon className="size-4 shrink-0" />
          <span className={compact ? 'hidden lg:inline' : ''}>{label}</span>
        </button>
      ))}
    </>
  )

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-surface p-4 lg:flex">
        <div className="mb-6 flex items-center gap-3 px-1 pt-1">
          <img src={brandMark} alt="" className="hex-badge size-9 object-cover" />
          <div>
            <div className="font-display text-base leading-tight">ChasHack</div>
            <div className="text-xs text-muted-foreground">Organizer console</div>
          </div>
        </div>
        <nav className="flex flex-col gap-1" aria-label="Sections">
          {nav(true)}
        </nav>
        <div className="mt-auto flex flex-col gap-2 pb-1">
          <div className="hex-bg rounded-xl border border-border p-3">
            <div className="font-display text-2xl text-accent">{state.stats.active}</div>
            <div className="text-xs text-muted-foreground">active signups</div>
          </div>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" onClick={() => void refresh()} aria-label="Refresh data">
              <RefreshCw />
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
              {theme === 'dark' ? <Sun /> : <Moon />}
            </Button>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <img src={brandMark} alt="" className="hex-badge size-7 object-cover" />
          <span className="font-display text-sm">ChasHack</span>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={() => void refresh()} aria-label="Refresh data">
            <RefreshCw />
          </Button>
          <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
            {theme === 'dark' ? <Sun /> : <Moon />}
          </Button>
        </div>
      </div>

      {/* Content */}
      <main className="min-w-0 flex-1 pb-20 lg:pb-0">
        <div key={tab} className="mx-auto max-w-5xl animate-fade-in p-4 sm:p-6">
          {children(tab, setTab)}
        </div>
      </main>

      {/* Mobile bottom tabs */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur lg:hidden"
        aria-label="Sections"
      >
        <div className="mx-auto flex max-w-lg items-stretch justify-around">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              aria-current={tab === id ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold',
                tab === id ? 'text-accent' : 'text-muted-foreground',
              )}
            >
              <Icon className="size-5" />
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
