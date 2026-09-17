import { useEffect, useState } from 'react'
import { Check, ChevronsUpDown, LogOut, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { api } from '@/api'
import { useT } from '@/lib/i18n'
import type { AuthMe } from '@/types'

/**
 * Which Discord server this console is managing.
 *
 * A Discord session may administer several servers the bot is in — the picker
 * switches between them. The switch is validated server-side and then reloads so
 * every guild-scoped query is refetched against the new server; the client never
 * gets to name a guild the session is not authorised for.
 *
 * Password sessions are pinned to the configured server, so they only see the
 * session footer.
 */
export function ServerSwitcher() {
  const t = useT()
  const [me, setMe] = useState<AuthMe | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void api
      .authMe()
      .then(setMe)
      .catch(() => setMe(null))
  }, [])

  if (me === null) return null

  const current = me.guilds.find((g) => g.id === me.guild.id) ?? null
  const label = current?.name ?? me.guild.name ?? current?.id ?? t('server.none')

  async function switchTo(guildId: string) {
    setBusy(true)
    try {
      await api.switchGuild(guildId)
      window.location.assign('/')
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    await api.logout().catch(() => undefined)
    window.location.assign('/')
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <span className="px-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {t('server.label')}
      </span>
      {me.kind === 'discord' && me.guilds.length > 1 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="w-full justify-between gap-2 font-normal"
              disabled={busy}
            >
              <span className="flex min-w-0 items-center gap-2">
                <Server className="size-4 shrink-0 text-accent" />
                <span className="truncate">{label}</span>
              </span>
              <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
            <DropdownMenuLabel>{t('server.switch')}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {me.guilds.map((g) => (
              <DropdownMenuItem key={g.id} onSelect={() => void switchTo(g.id)}>
                {g.id === me.guild.id ? (
                  <Check className="text-accent" />
                ) : (
                  <span className="size-4" aria-hidden />
                )}
                <span className="truncate">{g.name ?? g.id}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-sm">
          <Server className="size-4 shrink-0 text-accent" />
          <span className="truncate">{label}</span>
        </div>
      )}
      <button
        type="button"
        onClick={() => void signOut()}
        className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <LogOut className="size-3" />
        {me.kind === 'discord' && me.user !== null
          ? t('server.signed_in_as', { name: me.user.username })
          : t('server.sign_out')}
      </button>
    </div>
  )
}
