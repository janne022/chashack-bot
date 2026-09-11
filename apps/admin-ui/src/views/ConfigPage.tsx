import { useEffect, useMemo, useState } from 'react'
import { Save, Settings, Search, X, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { useAppContext } from '@/lib/app-context'
import { useT } from '@/lib/i18n'
import { api } from '@/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/textarea-label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

export function ConfigPage() {
  const { state, refresh } = useAppContext()
  const t = useT()
  const gs = state.guildSettings
  const [panel, setPanel] = useState(gs.defaultPanelChannelId ?? '')
  const [announce, setAnnounce] = useState(gs.defaultAnnouncementChannelId ?? '')
  const [scheduleChannel, setScheduleChannel] = useState((gs as unknown as { defaultScheduleChannelId?: string | null }).defaultScheduleChannelId ?? '')
  const [category, setCategory] = useState(gs.defaultCategoryId ?? gs.teamCategoryId ?? '')
  const [cleanup, setCleanup] = useState(gs.defaultCleanupDelayHours != null ? String(gs.defaultCleanupDelayHours) : '')
  const [defaultForm, setDefaultForm] = useState(gs.defaultFormTemplateId ?? '')
  const [modRoles, setModRoles] = useState<string[]>(gs.modRoleIds ?? [])
  const [busy, setBusy] = useState(false)
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([])
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [roles, setRoles] = useState<{ id: string; name: string; color: string }[]>([])
  const [roleQuery, setRoleQuery] = useState('')

  useEffect(() => {
    fetch('/api/guild/channels')
      .then((r) => r.json())
      .then((j: { channels: { id: string; name: string }[]; categories: { id: string; name: string }[]; roles?: { id: string; name: string; color: string }[] }) => {
        setChannels(j.channels ?? [])
        setCategories(j.categories ?? [])
        setRoles(j.roles ?? [])
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    setPanel(gs.defaultPanelChannelId ?? '')
    setAnnounce(gs.defaultAnnouncementChannelId ?? '')
    setScheduleChannel((gs as unknown as { defaultScheduleChannelId?: string | null }).defaultScheduleChannelId ?? '')
    setCategory(gs.defaultCategoryId ?? gs.teamCategoryId ?? '')
    setCleanup(gs.defaultCleanupDelayHours != null ? String(gs.defaultCleanupDelayHours) : '')
    setDefaultForm(gs.defaultFormTemplateId ?? '')
    setModRoles(gs.modRoleIds ?? [])
  }, [gs.defaultPanelChannelId, gs.defaultAnnouncementChannelId, (gs as unknown as { defaultScheduleChannelId?: string | null }).defaultScheduleChannelId, gs.defaultCategoryId, gs.teamCategoryId, gs.defaultCleanupDelayHours, gs.defaultFormTemplateId, gs.modRoleIds])

  const dirty =
    panel !== (gs.defaultPanelChannelId ?? '') ||
    announce !== (gs.defaultAnnouncementChannelId ?? '') ||
    scheduleChannel !== ((gs as unknown as { defaultScheduleChannelId?: string | null }).defaultScheduleChannelId ?? '') ||
    category !== (gs.defaultCategoryId ?? gs.teamCategoryId ?? '') ||
    cleanup !== (gs.defaultCleanupDelayHours != null ? String(gs.defaultCleanupDelayHours) : '') ||
    defaultForm !== (gs.defaultFormTemplateId ?? '') ||
    JSON.stringify([...modRoles].sort()) !== JSON.stringify([...(gs.modRoleIds ?? [])].sort())

  async function save() {
    const payload: Record<string, unknown> = {}
    payload.defaultPanelChannelId = panel.trim() === '' ? null : panel.trim()
    payload.defaultAnnouncementChannelId = announce.trim() === '' ? null : announce.trim()
    payload.defaultScheduleChannelId = scheduleChannel.trim() === '' ? null : scheduleChannel.trim()
    const catVal = category.trim() === '' ? null : category.trim()
    payload.defaultCategoryId = catVal
    payload.teamCategoryId = catVal
    payload.defaultFormTemplateId = defaultForm.trim() === '' ? null : defaultForm.trim()
    payload.modRoleIds = modRoles
    payload.defaultCleanupDelayHours = cleanup.trim() === '' ? null : Number(cleanup)

    if (payload.defaultCleanupDelayHours !== null && (Number.isNaN(payload.defaultCleanupDelayHours as number) || (payload.defaultCleanupDelayHours as number) < 0 || (payload.defaultCleanupDelayHours as number) > 720)) {
      toast.error(t('config.cleanup_invalid'))
      return
    }

    setBusy(true)
    try {
      await api.updateGuildSettings(payload as never)
      toast.success(t('config.saved'))
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('config.save_failed'))
    } finally { setBusy(false) }
  }

  const filteredRoles = useMemo(() => {
    const q = roleQuery.trim().toLowerCase()
    if (!q) return roles
    return roles.filter(r => r.name.toLowerCase().includes(q))
  }, [roles, roleQuery])

  const selectedRoles = useMemo(() => roles.filter(r => modRoles.includes(r.id)), [roles, modRoles])

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl">{t('config.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('config.subtitle')}</p>
      </header>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <Settings className="size-4 text-accent" />
            {t('config.defaults')}
          </CardTitle>
          <CardDescription>{t('config.defaults_desc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {/* Channels — 3 equal columns, same height, no extra buttons */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label>{t('config.panel_channel')}</Label>
              {channels.length > 0 ? (
                <Select value={panel || '__none'} onValueChange={(v) => setPanel(v === '__none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder={t('config.pick_channel')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">{t('common.not_set')}</SelectItem>
                    {channels.map((c) => <SelectItem key={c.id} value={c.id}>#{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={panel} onChange={(e) => setPanel(e.target.value)} placeholder="123456789012345678" />
              )}
              <span className="text-xs leading-snug text-muted-foreground">{t('config.panel_hint')}</span>
            </div>

            <div className="flex flex-col gap-2">
              <Label>{t('config.announce_channel')}</Label>
              {channels.length > 0 ? (
                <Select value={announce || '__none'} onValueChange={(v) => setAnnounce(v === '__none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder={t('config.pick_channel')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">{t('common.not_set')}</SelectItem>
                    {channels.map((c) => <SelectItem key={c.id} value={c.id}>#{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={announce} onChange={(e) => setAnnounce(e.target.value)} placeholder="123456789012345678" />
              )}
              <span className="text-xs leading-snug text-muted-foreground">{t('config.announce_hint')}</span>
            </div>

            <div className="flex flex-col gap-2">
              <Label>{t('config.default_schedule_channel')}</Label>
              {channels.length > 0 ? (
                <Select value={scheduleChannel || '__none'} onValueChange={(v) => setScheduleChannel(v === '__none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder={t('config.pick_channel')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">{t('common.not_set')}</SelectItem>
                    {channels.map((c) => <SelectItem key={c.id} value={c.id}>#{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={scheduleChannel} onChange={(e) => setScheduleChannel(e.target.value)} placeholder="123456789012345678" />
              )}
              <span className="text-xs leading-snug text-muted-foreground">{t('config.default_schedule_hint')}</span>
            </div>
          </div>

          {/* Category / Form / Cleanup — also 3 equal columns */}
          <div className="grid gap-4 md:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label>{t('config.category')}</Label>
              {categories.length > 0 ? (
                <Select value={category || '__none'} onValueChange={(v) => setCategory(v === '__none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder={t('config.pick_category')} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">{t('common.not_set')}</SelectItem>
                    {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="category id" />
              )}
              <span className="text-xs leading-snug text-muted-foreground">{t('config.category_hint')}</span>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Default signup form</Label>
              {(state.templates ?? []).filter(t=>t.kind==='form').length > 0 ? (
                <Select value={defaultForm || '__none'} onValueChange={(v)=>setDefaultForm(v==='__none' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Default form (fallback to built-in)" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">Built-in default</SelectItem>
                    {(state.templates ?? []).filter(t=>t.kind==='form').map(f=> <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={defaultForm} onChange={e=>setDefaultForm(e.target.value)} placeholder="form template id (create one in Templates)" />
              )}
              <span className="text-xs leading-snug text-muted-foreground">Used when you create events without picking a form.</span>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="cleanup">{t('config.cleanup')}</Label>
              <Input id="cleanup" type="number" min={0} max={720} value={cleanup} onChange={(e) => setCleanup(e.target.value)} placeholder="48" />
              <span className="text-xs leading-snug text-muted-foreground">{t('config.cleanup_hint')}</span>
            </div>
          </div>

          <div className="flex justify-end border-t border-border pt-4">
            <Button disabled={!dirty || busy} onClick={() => void save()}>
              <Save className="size-4" />
              {busy ? t('common.save') + '…' : t('common.save')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-accent" />
            {t('config.moderator_roles')}
            <Badge variant="secondary" className="ml-2 font-mono text-xs">{modRoles.length} selected</Badge>
            {roles.length > 0 && <span className="text-xs font-normal text-muted-foreground">· {roles.length} total</span>}
          </CardTitle>
          <CardDescription>
            {t('config.moderator_desc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {roles.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('config.moderator_no_roles')}</p>
          ) : (
            <>
              {/* Selected pills — always visible */}
              {selectedRoles.length > 0 && (
                <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-surface-2/40 p-2">
                  {selectedRoles.map(r=>(
                    <span key={r.id} className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent-soft px-2.5 py-1 text-xs font-medium">
                      <span className="size-2 rounded-full" style={{ backgroundColor: r.color && r.color !== "#000000" ? r.color : "#71717a" }} />
                      {r.name}
                      <button onClick={()=>setModRoles(prev=>prev.filter(id=>id!==r.id))} className="ml-0.5 rounded-full p-0.5 hover:bg-accent/20"><X className="size-3" /></button>
                    </span>
                  ))}
                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={()=>setModRoles([])}>{t('config.moderator_clear_all')}</Button>
                </div>
              )}

              {/* Search + count */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px]">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={roleQuery}
                    onChange={e=>setRoleQuery(e.target.value)}
                    placeholder={t('config.moderator_search_placeholder', { count: roles.length })}
                    className="h-8 pl-8"
                  />
                  {roleQuery && (
                    <button onClick={()=>setRoleQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 hover:bg-muted"><X className="size-3.5" /></button>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {filteredRoles.length === roles.length ? `${roles.length} roles` : `${filteredRoles.length} / ${roles.length} match`}
                </span>
                {roleQuery && filteredRoles.length > 0 && (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={()=>setModRoles(prev=>Array.from(new Set([...prev, ...filteredRoles.map(r=>r.id)])))}>
                    Select {filteredRoles.length} filtered
                  </Button>
                )}
              </div>

              {/* Scrollable list — handles 100s */}
              <div className="max-h-72 overflow-y-auto rounded-lg border border-border bg-background">
                {filteredRoles.length === 0 ? (
                  <p className="p-4 text-center text-sm text-muted-foreground">{t('config.moderator_no_match', { query: roleQuery })}</p>
                ) : (
                  <div className="divide-y divide-border">
                    {filteredRoles.map(r=> {
                      const checked = modRoles.includes(r.id)
                      return (
                        <label key={r.id} className={`flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/50 ${checked ? "bg-accent-soft" : ""}`}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={e=>{
                              setModRoles(prev => e.target.checked ? [...prev, r.id] : prev.filter(id=>id!==r.id))
                            }}
                            className="size-4 rounded border-input accent-accent"
                          />
                          <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: r.color && r.color !== "#000000" ? r.color : "#71717a" }} />
                          <span className={`flex-1 truncate text-sm ${checked ? "font-medium" : ""}`}>{r.name}</span>
                          {checked && <Badge variant="secondary" className="text-[10px]">selected</Badge>}
                        </label>
                      )
                    })}
                  </div>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                {modRoles.length===0
                  ? "No extra roles selected — only Manage Server / Administrator + ADMIN_IDS can manage ChasHack."
                  : `Live in Discord immediately after Save — ${modRoles.length} role${modRoles.length>1?'s':''} can use /hackathon admin.`}
              </p>
            </>
          )}
        </CardContent>
      </Card>

      {channels.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('config.no_channels_hint')}</p>
      )}
    </div>
  )
}
