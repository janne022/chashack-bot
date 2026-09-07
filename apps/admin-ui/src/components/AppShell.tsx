import { useState, type ReactNode } from 'react'
import {
  LayoutDashboard,
  Users,
  UsersRound,
  Sparkles,
  ClipboardList,
  History,
  RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import type { AppState } from '@/types'
import type { TabId } from '@/types-dashboard'

const NAV: { id: TabId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'participants', label: 'Participants', icon: Users },
  { id: 'teams', label: 'Teams', icon: UsersRound },
  { id: 'matching', label: 'Matching', icon: Sparkles },
  { id: 'form', label: 'Form', icon: ClipboardList },
  { id: 'audit', label: 'Audit log', icon: History },
]

/**
 * Responsive shell: sidebar on desktop, bottom tab bar on mobile.
 * Single-page tabs — Dashboard renders all panels and the shell
 * switches visibility, keeping state alive between tab switches.
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

  const nav = (
    <>
      {NAV.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => setTab(id)}
          aria-current={tab === id ? 'page' : undefined}
          className={cn(
            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
            'lg:w-full lg:justify-start',
            tab === id
              ? 'bg-accent-soft text-accent'
              : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
          )}
        >
          <Icon className="size-4 shrink-0" />
          <span className="hidden lg:inline">{label}</span>
          <span className="lg:hidden text-[11px]">{label}</span>
        </button>
      ))}
    </>
  )

  return (
    <div className="min-h-screen lg:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 flex-col gap-1 border-r border-border bg-surface p-3 lg:flex">
        <div className="mb-4 flex items-center gap-2 px-2 pt-2">
          <div className="flex size-8 items-center justify-center rounded-lg bg-accent text-white">
            <ZapMark />
          </div>
          <div>
            <div className="text-sm font-semibold leading-tight">Hackathon</div>
            <div className="text-xs text-muted-foreground">Admin panel</div>
          </div>
        </div>
        {nav}
        <div className="mt-auto flex flex-col gap-2 px-1 pb-1">
          <Button variant="ghost" size="sm" onClick={() => void refresh()} aria-label="Refresh data">
            <RefreshCw />
            Refresh
          </Button>
          <div className="text-xs text-muted-foreground">
            {state.stats.active} active · {state.stats.teams} teams
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-surface px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-md bg-accent text-white">
            <ZapMark />
          </div>
          <span className="text-sm font-semibold">Hackathon Admin</span>
        </div>
        <Button variant="ghost" size="icon" onClick={() => void refresh()} aria-label="Refresh data">
          <RefreshCw />
        </Button>
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
                'flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium',
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

function ZapMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden>
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
    </svg>
  )
}
