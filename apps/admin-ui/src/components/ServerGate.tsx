import { createContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, LogOut, Server } from 'lucide-react'
import { api, ApiError } from '@/api'
import type { AuthMe } from '@/types'
import { useT } from '@/lib/i18n'
import { LanguageMenu } from '@/components/LanguageMenu'
import { Button } from '@/components/ui/button'
import { PageSkeleton } from '@/components/ui/skeleton'
import { LoginView } from '@/views/LoginView'
import { AUTH_QUERY_KEY, clearServerCache, clearSessionCache } from '@/lib/session-cache'

export const ServerContext = createContext<AuthMe | null>(null)
export const rememberedServerKey = (userId: string) => `chas-server:${userId}`

/** Account-level navigation. Server authority always comes from the API. */
export function ServerGate({ children }: { children: ReactNode }) {
  const t = useT()
  const queryClient = useQueryClient()
  const account = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: ({ signal }) => api.authMe(signal),
    staleTime: 15_000,
    refetchOnWindowFocus: 'always',
    refetchInterval: 60_000,
    retry: false,
  })
  const me = account.data ?? null
  const lastAccount = useRef<AuthMe | null>(null)
  if (me?.kind === 'discord' && me.user) lastAccount.current = me
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [initialized, setInitialized] = useState(false)
  const started = useRef(false)
  const clearedExpired = useRef(false)
  const shownSession = useRef<{ userId: string; guildId: string | null } | null>(null)
  const showPicker = new URLSearchParams(window.location.search).has('servers')
  const signedOut = (account.error instanceof ApiError && account.error.unauthorized) || (me !== null && (me.kind !== 'discord' || !me.user))
  const sessionAlive = useRef(true)
  sessionAlive.current = !signedOut
  const changedSession = ready && !!me?.user && !!shownSession.current && (me.user.id !== shownSession.current.userId || me.guild.id !== shownSession.current.guildId)

  useEffect(() => {
    if (signedOut) {
      if (!clearedExpired.current) { clearedExpired.current = true; void clearServerCache(queryClient) }
      started.current = false
      return
    }
    if (changedSession) {
      started.current = true
      setReady(false)
      setInitialized(true)
      try { localStorage.removeItem('chas-event') } catch { /* storage unavailable */ }
      void clearServerCache(queryClient)
      return
    }
    if (!me?.user || started.current) return
    clearedExpired.current = false
    started.current = true
    void (async () => {
      try {
        const remembered = localStorage.getItem(rememberedServerKey(me.user!.id))
        if (!showPicker && remembered && me.guilds.some(g => g.id === remembered)) {
          if (me.guild.id !== remembered) {
            await api.switchGuild(remembered)
            await clearServerCache(queryClient)
            if (!sessionAlive.current || queryClient.getQueryData<AuthMe>(AUTH_QUERY_KEY)?.user?.id !== me.user!.id) return
            localStorage.removeItem('chas-event')
            queryClient.setQueryData<AuthMe>(AUTH_QUERY_KEY, { ...me, guild: { id: remembered, name: me.guilds.find(g => g.id === remembered)?.name ?? null } })
          }
          shownSession.current = { userId: me.user!.id, guildId: remembered }
          setReady(true)
        }
      } catch { setError(t('servers.load_error')) }
      finally { setInitialized(true) }
    })()
  }, [changedSession, me, queryClient, showPicker, signedOut, t])

  async function enter(id: string) {
    if (!me?.user || busy) return
    setBusy(id); setError('')
    try {
      await api.switchGuild(id)
      localStorage.setItem(rememberedServerKey(me.user.id), id)
      if (me.guild.id !== id) localStorage.removeItem('chas-event')
      await clearSessionCache(queryClient)
      window.location.assign('/events')
    } catch { setError(t('servers.enter_error')); setBusy(null); void account.refetch() }
  }

  if (signedOut && !ready) return <LoginView />
  if (changedSession) return <div className="p-8"><PageSkeleton /></div>
  if (ready) return <ServerContext.Provider value={signedOut ? lastAccount.current : me}>{children}</ServerContext.Provider>
  if (account.isPending || (!initialized && !account.isError)) return <div className="p-8"><PageSkeleton /></div>
  return <main className="min-h-screen bg-background px-5 py-8 text-foreground sm:px-10 sm:py-14">
    <div className="mx-auto max-w-4xl">
      <header className="mb-14 flex items-center justify-between gap-4">
        <span className="text-lg font-semibold tracking-tight">ChasHack</span>
        <div className="flex gap-2">
          <LanguageMenu compact />
          <Button variant="ghost" onClick={async () => { try { await api.logout(); await clearSessionCache(queryClient); window.location.assign('/') } catch { setError(t('common.sign_out_failed')) } }}><LogOut size={16} />{t('server.sign_out')}</Button>
        </div>
      </header>
      <p className="mb-3 text-sm text-muted-foreground">{me?.user?.username}</p>
      <h1 className="text-4xl font-semibold tracking-tight">{t('servers.title')}</h1>
      <p className="mt-4 max-w-xl text-muted-foreground">{t('servers.description')}</p>
      {(error || account.isError) && <div role="alert" className="mt-6 rounded-xl border p-4"><p>{error || t('servers.load_error')}</p><Button variant="outline" className="mt-3" onClick={() => { setError(''); void account.refetch() }}>{t('common.retry')}</Button></div>}
      <div className="mt-9 grid gap-4 sm:grid-cols-2">
        {me?.guilds.map(guild => <button key={guild.id} disabled={busy !== null} onClick={() => void enter(guild.id)} className="group flex min-h-28 items-center gap-4 rounded-2xl border bg-card p-6 text-left transition-colors hover:border-accent focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-60">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"><Server size={24} /></span>
          <span className="min-w-0 flex-1"><strong className="block break-words text-lg font-medium">{guild.name}</strong><span className="mt-1 block text-sm text-muted-foreground">{t('servers.manage')}</span></span>
          <ArrowRight className="shrink-0 text-muted-foreground group-hover:text-accent" size={20} />
        </button>)}
      </div>
      {me?.guilds.length === 0 && <p className="mt-8 rounded-xl border p-6">{t('servers.empty')}</p>}
    </div>
  </main>
}
