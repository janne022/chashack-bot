import { useEffect, useState } from 'react'
import { Save, Settings, Send } from 'lucide-react'
import { toast } from 'sonner'
import { useAppContext } from '@/lib/app-context'
import { useT } from '@/lib/i18n'
import { api } from '@/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/textarea-label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export function ConfigPage() {
  const { state, refresh } = useAppContext()
  const t = useT()
  const gs = state.guildSettings
  const [panel, setPanel] = useState(gs.defaultPanelChannelId ?? '')
  const [announce, setAnnounce] = useState(gs.defaultAnnouncementChannelId ?? '')
  const [category, setCategory] = useState(gs.defaultCategoryId ?? gs.teamCategoryId ?? '')
  const [cleanup, setCleanup] = useState(gs.defaultCleanupDelayHours != null ? String(gs.defaultCleanupDelayHours) : '')
  const [defaultForm, setDefaultForm] = useState(gs.defaultFormTemplateId ?? '')
  const [modRoles, setModRoles] = useState<string[]>(gs.modRoleIds ?? [])
  const [busy, setBusy] = useState(false)
  const [testingPanel, setTestingPanel] = useState(false)
  const [testingAnnounce, setTestingAnnounce] = useState(false)
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([])
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [roles, setRoles] = useState<{ id: string; name: string; color: string }[]>([])

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

  // keep in sync when state reloads
  useEffect(() => {
    setPanel(gs.defaultPanelChannelId ?? '')
    setAnnounce(gs.defaultAnnouncementChannelId ?? '')
    setCategory(gs.defaultCategoryId ?? gs.teamCategoryId ?? '')
    setCleanup(gs.defaultCleanupDelayHours != null ? String(gs.defaultCleanupDelayHours) : '')
    setDefaultForm(gs.defaultFormTemplateId ?? '')
    setModRoles(gs.modRoleIds ?? [])
  }, [gs.defaultPanelChannelId, gs.defaultAnnouncementChannelId, gs.defaultCategoryId, gs.teamCategoryId, gs.defaultCleanupDelayHours, gs.defaultFormTemplateId, gs.modRoleIds])

  const dirty =
    panel !== (gs.defaultPanelChannelId ?? '') ||
    announce !== (gs.defaultAnnouncementChannelId ?? '') ||
    category !== (gs.defaultCategoryId ?? gs.teamCategoryId ?? '') ||
    cleanup !== (gs.defaultCleanupDelayHours != null ? String(gs.defaultCleanupDelayHours) : '') ||
    defaultForm !== (gs.defaultFormTemplateId ?? '') ||
    JSON.stringify([...modRoles].sort()) !== JSON.stringify([...(gs.modRoleIds ?? [])].sort())

  async function save() {
    const payload: Record<string, unknown> = {}
    payload.defaultPanelChannelId = panel.trim() === '' ? null : panel.trim()
    payload.defaultAnnouncementChannelId = announce.trim() === '' ? null : announce.trim()
    // category: keep both legacy teamCategoryId and new defaultCategoryId in sync
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

  async function testChannel(which: 'panel' | 'announce') {
    const id = which === 'panel' ? panel.trim() : announce.trim()
    if (!id) { toast.error('Pick a channel first'); return }
    const setTesting = which === 'panel' ? setTestingPanel : setTestingAnnounce
    setTesting(true)
    try {
      const res = await api.testChannel(id)
      toast.success(`✅ Sent test to #${res.name} — check Discord`)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Test failed'
      toast.error(msg, { duration: 7000 })
    } finally { setTesting(false) }
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl">{t('config.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('config.subtitle')}</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="size-4 text-accent" />
            {t('config.defaults')}
          </CardTitle>
          <CardDescription>{t('config.defaults_desc')}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>{t('config.panel_channel')}</Label>
              {channels.length > 0 ? (
                <Select value={panel || '__none'} onValueChange={(v) => setPanel(v === '__none' ? '' : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('config.pick_channel')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">{t('common.not_set')}</SelectItem>
                    {channels.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        #{c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={panel} onChange={(e) => setPanel(e.target.value)} placeholder="123456789012345678" />
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground flex-1">{t('config.panel_hint')}</span>
                <Button variant="outline" size="sm" disabled={!panel || testingPanel} onClick={() => void testChannel('panel')}>
                  <Send className="size-3.5" />
                  {testingPanel ? 'Testing…' : 'Test'}
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label>{t('config.announce_channel')}</Label>
              {channels.length > 0 ? (
                <Select value={announce || '__none'} onValueChange={(v) => setAnnounce(v === '__none' ? '' : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('config.pick_channel')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">{t('common.not_set')}</SelectItem>
                    {channels.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        #{c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={announce} onChange={(e) => setAnnounce(e.target.value)} placeholder="123456789012345678" />
              )}
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground flex-1">{t('config.announce_hint')}</span>
                <Button variant="outline" size="sm" disabled={!announce || testingAnnounce} onClick={() => void testChannel('announce')}>
                  <Send className="size-3.5" />
                  {testingAnnounce ? 'Testing…' : 'Test'}
                </Button>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>{t('config.category')}</Label>
              {categories.length > 0 ? (
                <Select value={category || '__none'} onValueChange={(v) => setCategory(v === '__none' ? '' : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('config.pick_category')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">{t('common.not_set')}</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="category id" />
              )}
              <span className="text-xs text-muted-foreground">{t('config.category_hint')}</span>
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
              <span className="text-xs text-muted-foreground">Used when you create events without picking a form. Set in Templates first.</span>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="cleanup">{t('config.cleanup')}</Label>
              <Input id="cleanup" type="number" min={0} max={720} value={cleanup} onChange={(e) => setCleanup(e.target.value)} placeholder="48" />
              <span className="text-xs text-muted-foreground">{t('config.cleanup_hint')}</span>
            </div>
          </div>

          <div className="flex justify-end">
            <Button disabled={!dirty || busy} onClick={() => void save()}>
              <Save />
              {busy ? t('common.save') + '…' : t('common.save')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="size-4 text-accent" />
            Moderator roles
          </CardTitle>
          <CardDescription>
            Who can run <code className="rounded bg-muted px-1">/hackathon admin</code> commands in Discord without <b>Manage Server</b>. ADMIN_IDS and Manage Server / Administrator always work.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {roles.length === 0 ? (
            <p className="text-sm text-muted-foreground">No roles found — is the bot in the guild and does it have access? You need to set DISCORD_GUILD_ID and restart.</p>
          ) : (
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                {roles.map(r=> {
                  const checked = modRoles.includes(r.id)
                  return (
                    <label key={r.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer transition-colors ${checked ? "border-accent bg-accent-soft" : "border-border hover:border-accent/40 bg-surface-2/40"}`}>
                      <input type="checkbox" className="sr-only" checked={checked} onChange={e=>{
                        setModRoles(prev => e.target.checked ? [...prev, r.id] : prev.filter(id=>id!==r.id))
                      }} />
                      <span className="flex size-3 shrink-0 rounded-full" style={{ backgroundColor: r.color && r.color !== "#000000" ? r.color : "#71717a" }} />
                      <span className="flex-1 truncate font-medium">{r.name}</span>
                      <span className={`flex size-4 items-center justify-center rounded border text-[10px] ${checked ? "border-accent bg-accent text-accent-foreground" : "border-input bg-background"}`}>{checked ? "✓" : ""}</span>
                    </label>
                  )
                })}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>{modRoles.length} selected</span>
                {modRoles.length>0 && <Button variant="ghost" size="sm" onClick={()=>setModRoles([])}>Clear</Button>}
                <span className="flex-1" />
                <span>Live in Discord immediately after Save.</span>
              </div>
            </>
          )}
          {modRoles.length===0 && <p className="text-xs text-muted-foreground">No extra roles selected — only Manage Server / Administrator + ADMIN_IDS can manage ChasHack.</p>}
        </CardContent>
      </Card>

      {channels.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('config.no_channels_hint')}</p>
      )}
    </div>
  )
}
