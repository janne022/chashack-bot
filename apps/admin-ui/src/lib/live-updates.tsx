import { useEffect, useRef, useState } from 'react'
import { useT } from './i18n'
import { Button } from '@/components/ui/button'

/** Invalidation only: the audience's existing loader remains authoritative. */
export function useLiveUpdates(url: string | null, refresh: (signal?: AbortSignal) => Promise<void>) {
  const callback = useRef(refresh)
  callback.current = refresh
  const [status, setStatus] = useState<'connecting' | 'live' | 'reconnecting' | 'disconnected'>('connecting')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    let source: EventSource | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let refreshTimer: ReturnType<typeof setTimeout> | undefined
    let failures = 0
    let loading = false
    let dirty = false
    let terminal = false
    const refreshNow = async () => {
      if (controller.signal.aborted) return
      if (loading) { dirty = true; return }
      loading = true
      try { await callback.current(controller.signal) }
      catch { /* The existing loader owns read errors and usable stale state. */ }
      finally {
        loading = false
        if (dirty && !controller.signal.aborted) { dirty = false; schedule() }
      }
    }
    const schedule = () => {
      if (refreshTimer || controller.signal.aborted) return
      refreshTimer = setTimeout(() => { refreshTimer = undefined; void refreshNow() }, 75)
    }
    const connect = async () => {
      if (controller.signal.aborted) return
      try {
        const probe = await fetch(`${url}${url.includes('?') ? '&' : '?'}probe=1`, { signal: controller.signal, cache: 'no-store' })
        if ([401, 403, 404, 429].includes(probe.status)) {
          terminal = true; setStatus('disconnected'); schedule(); return
        }
        if (!probe.ok) throw new Error('Live updates unavailable')
        if (controller.signal.aborted) return
        source = new EventSource(url)
        source.addEventListener('ready', () => { if (!controller.signal.aborted) { setStatus('live'); schedule() } })
        source.addEventListener('heartbeat', () => { failures = 0 })
        source.addEventListener('dirty', schedule)
        source.addEventListener('denied', () => {
          source?.close(); terminal = true
          if (!controller.signal.aborted) { setStatus('disconnected'); schedule() }
        })
        source.onerror = retryConnection
      } catch { retryConnection() }
    }
    const retryConnection = () => {
      source?.close()
      if (controller.signal.aborted || terminal) return
      if (++failures > 5) { terminal = true; setStatus('disconnected'); return }
      setStatus('reconnecting')
      clearTimeout(timer)
      timer = setTimeout(() => { void connect() }, Math.min(1000 * 2 ** (failures - 1), 16000))
    }
    const focus = () => { if (document.visibilityState !== 'hidden') schedule() }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', focus)
    setStatus('connecting')
    void connect()
    return () => {
      controller.abort(); source?.close(); clearTimeout(timer); clearTimeout(refreshTimer)
      window.removeEventListener('focus', focus)
      document.removeEventListener('visibilitychange', focus)
    }
  }, [url, attempt])
  return { status, retry: () => setAttempt(value => value + 1) }
}

export function LiveStatus({ status, retry }: ReturnType<typeof useLiveUpdates>) {
  const t = useT()
  if (status === 'live') return null
  return <div role="status" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" data-live-status={status}>
    <span>{t(status === 'disconnected' ? 'live.disconnected' : 'live.reconnecting')}</span>
    {status === 'disconnected' && <Button variant="outline" size="sm" onClick={retry}>{t('participant.retry')}</Button>}
  </div>
}
