import { createContext, useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, Globe, LogOut, Server } from 'lucide-react'
import { api, ApiError } from '@/api'
import type { AuthMe } from '@/types'
import { useT, useLocale, setLocale } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { PageSkeleton } from '@/components/ui/skeleton'
import { LoginView } from '@/views/LoginView'

export const ServerContext = createContext<AuthMe | null>(null)
export const rememberedServerKey = (userId: string) => `chas-server:${userId}`

/** Account-level navigation. Server authority always comes from the API. */
export function ServerGate({ children }: { children: ReactNode }) {
  const t = useT()
  const locale = useLocale()
  const [me, setMe] = useState<AuthMe | null>(null)
  const [ready, setReady] = useState(false)
  const [signedOut, setSignedOut] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(true)
  const showPicker = new URLSearchParams(window.location.search).has('servers')

  async function load(initial = false) {
    setError('')
    try {
      const next = await api.authMe()
      setMe(next)
      if (next.kind !== 'discord' || !next.user) { setSignedOut(true); return }
      const remembered = localStorage.getItem(rememberedServerKey(next.user.id))
      if (initial && !showPicker && remembered && next.guilds.some(g => g.id === remembered)) {
        if (next.guild.id !== remembered) {
          await api.switchGuild(remembered)
          localStorage.removeItem('chas-event')
          setMe({ ...next, guild: { id: remembered, name: next.guilds.find(g => g.id === remembered)?.name ?? null } })
        }
        setReady(true)
      }
    } catch (e) {
      if (e instanceof ApiError && e.unauthorized) setSignedOut(true)
      else setError(t('servers.load_error'))
    } finally { setChecking(false) }
  }

  useEffect(() => { void load(true) }, [])
  useEffect(() => {
    if (ready) return
    const refresh = () => { if (document.visibilityState === 'visible') void load() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    const interval = window.setInterval(refresh, 60_000)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); window.clearInterval(interval) }
  }, [ready])

  async function enter(id: string) {
    if (!me?.user || busy) return
    setBusy(id); setError('')
    try {
      await api.switchGuild(id)
      localStorage.setItem(rememberedServerKey(me.user.id), id)
      if (me.guild.id !== id) localStorage.removeItem('chas-event')
      window.location.assign('/events')
    } catch { setError(t('servers.enter_error')); setBusy(null); void load() }
  }

  if (signedOut) return <LoginView />
  if (ready) return <ServerContext.Provider value={me}>{children}</ServerContext.Provider>
  if (checking) return <div className="p-8"><PageSkeleton /></div>
  return <main className="min-h-screen bg-background px-5 py-8 text-foreground sm:px-10 sm:py-14">
    <div className="mx-auto max-w-4xl">
      <header className="mb-14 flex items-center justify-between gap-4">
        <span className="text-lg font-semibold tracking-tight">ChasHack</span>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={() => setLocale(locale === 'en' ? 'sv' : 'en')}><Globe size={16} />{locale.toUpperCase()}</Button>
          <Button variant="ghost" onClick={async () => { await api.logout(); window.location.assign('/') }}><LogOut size={16} />{t('server.sign_out')}</Button>
        </div>
      </header>
      <p className="mb-3 text-sm text-muted-foreground">{me?.user?.username}</p>
      <h1 className="text-4xl font-semibold tracking-tight">{t('servers.title')}</h1>
      <p className="mt-4 max-w-xl text-muted-foreground">{t('servers.description')}</p>
      {error && <div role="alert" className="mt-6 rounded-xl border p-4"><p>{error}</p><Button variant="outline" className="mt-3" onClick={() => void load()}>{t('common.retry')}</Button></div>}
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
