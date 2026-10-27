import { ServerGate } from './components/ServerGate'
import { PageSkeleton } from './components/ui/skeleton'
import { Button } from './components/ui/button'
import { useT } from './lib/i18n'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, ApiError } from './api'
import type { AppState } from './types'
import { LoginView } from './views/LoginView'
import { AppShell } from './components/AppShell'
import { AppContextProvider } from './lib/app-context'
import { LiveStatus, useLiveUpdates } from './lib/live-updates'

/**
 * App is now the auth + data provider; routing is TanStack Router's job
 * (routes/ folder). Children render inside the shell when authenticated.
 */
export default function App({ children }: { children: ReactNode }) {
  // Participant journeys use their isolated Discord audience; do not gate them
  // behind organizer state or render the organizer shell.
  if (window.location.pathname.startsWith('/events/') || window.location.pathname === '/my-hackathons' || window.location.pathname === '/team') {
    return <>{children}</>
  }
  return <ServerGate><OrganizerApp>{children}</OrganizerApp></ServerGate>
}

function OrganizerApp({ children }: { children: ReactNode }) {
  const t = useT()
  const [state, setState] = useState<AppState | null>(null)
  const [authed, setAuthed] = useState<boolean | null>(null) // null = checking
  const [error, setError] = useState<string | null>(null)
  // Which event the data views are scoped to. Persisted so a reload keeps the
  // organizer on the event they were working on. Null = server default.
  const [selectedEventId, setSelectedEventId] = useState<string | null>(
    () => localStorage.getItem('chas-event') || null,
  )

  const selection = useRef(selectedEventId)
  selection.current = selectedEventId
  const sequence = useRef(0)
  const hasLoaded = useRef(false)
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const request = ++sequence.current
    try {
      const s = await api.state(selectedEventId, signal)
      if (signal?.aborted || selection.current !== selectedEventId || request !== sequence.current) return
      hasLoaded.current = true
      setState(s)
      setAuthed(true)
      setError(null)
    } catch (e) {
      if (signal?.aborted || selection.current !== selectedEventId || request !== sequence.current) return
      if (e instanceof ApiError && e.unauthorized) {
        if (hasLoaded.current) setError('session_expired')
        else setAuthed(false)
      } else if (e instanceof ApiError && e.code === 'access_refused') {
        setAuthed(false)
        setError('access_refused')
        window.location.assign('/?servers=1')
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load')
      }
    }
  }, [selectedEventId])
  const live = useLiveUpdates(authed ? `/api/live${selectedEventId ? `?eventId=${encodeURIComponent(selectedEventId)}` : ''}` : null, refresh)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const selectEvent = useCallback((eventId: string | null) => {
    if (eventId === null) localStorage.removeItem('chas-event')
    else localStorage.setItem('chas-event', eventId)
    setSelectedEventId(eventId)
  }, [])


  if (authed === null) {
    return <div className="min-h-screen p-4 pt-12">{error ? <div role="alert" className="mx-auto max-w-lg space-y-4 rounded-2xl border bg-card p-8"><h1 className="text-xl font-semibold">{t('common.load_failed')}</h1><p className="text-sm text-muted-foreground">{error}</p><Button onClick={() => void refresh()}>{t('participant.retry')}</Button></div> : <PageSkeleton />}</div>
  }

  if (!authed) {
    return <LoginView notice={error} />
  }

  if (state === null) return <PageSkeleton />

  return (
    <AppContextProvider value={{ state, refresh, selectEvent }}>
      <AppShell state={state} refresh={refresh}>
        <LiveStatus {...live} />
        {error === 'session_expired' && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 text-sm">
          <p className="flex-1">{t('common.session_expired')}</p>
          <a href="/?reauth=1" target="_blank" rel="noreferrer" className="underline underline-offset-4">{t('common.sign_in_again')}</a>
          <Button variant="outline" onClick={() => void refresh()}>{t('common.retry')}</Button>
        </div>}
        {error && error !== 'session_expired' && <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 text-sm">
          <p className="flex-1">{t('common.refresh_failed')}</p>
          <Button variant="outline" onClick={() => void refresh()}>{t('common.retry')}</Button>
        </div>}
        {children}
      </AppShell>
    </AppContextProvider>
  )
}
