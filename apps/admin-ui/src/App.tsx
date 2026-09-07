import { useCallback, useEffect, useState } from 'react'
import { api, ApiError } from './api'
import type { AppState } from './types'
import { LoginView } from './views/LoginView'
import { Dashboard } from './views/Dashboard'
import { AppShell } from './components/AppShell'

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [authed, setAuthed] = useState<boolean | null>(null) // null = checking
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const s = await api.state()
      setState(s)
      setAuthed(true)
      setError(null)
    } catch (e) {
      if (e instanceof ApiError && e.unauthorized) {
        setAuthed(false)
      } else {
        setError(e instanceof Error ? e.message : 'Failed to load')
      }
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleLogin = useCallback(
    async (password: string) => {
      await api.login(password)
      await refresh()
    },
    [refresh],
  )

  if (authed === null) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span className="size-2 animate-pulse rounded-full bg-accent" />
          {error ?? 'Loading…'}
        </div>
      </div>
    )
  }

  if (!authed) {
    return <LoginView onLogin={handleLogin} />
  }

  if (state === null) {
    return (
      <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">
        {error ?? 'Loading…'}
      </div>
    )
  }

  return (
    <AppShell state={state} refresh={refresh}>
      {(tab, go) => <Dashboard state={state} refresh={refresh} tab={tab} go={go} />}
    </AppShell>
  )
}
