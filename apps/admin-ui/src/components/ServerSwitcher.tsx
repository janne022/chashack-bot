import { useContext } from 'react'
import { ServerContext } from './ServerGate'
import { ArrowLeft, Server } from 'lucide-react'
import { useT } from '@/lib/i18n'

export function ServerSwitcher({ compact = false }: { compact?: boolean }) {
  const t = useT()
  const me = useContext(ServerContext)
  if (compact) return <div className="flex items-center justify-between gap-4 text-sm">
    <a href="/?servers=1" className="flex min-h-10 shrink-0 items-center gap-2 text-muted-foreground"><ArrowLeft size={16} />{t('servers.back')}</a>
    <strong className="truncate font-medium">{me?.guild.name ?? t('server.label')}</strong>
  </div>
  return <div className="mb-5 space-y-4 border-b pb-5">
    <a href="/?servers=1" className="flex min-h-10 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft size={16} />{t('servers.back')}</a>
    <div className="flex min-w-0 items-center gap-3"><span className="rounded-xl bg-accent-soft p-2 text-accent"><Server size={20} /></span><strong className="truncate text-sm font-medium">{me?.guild.name ?? me?.guilds.find(g => g.id === me.guild.id)?.name ?? t('server.label')}</strong></div>
  </div>
}
