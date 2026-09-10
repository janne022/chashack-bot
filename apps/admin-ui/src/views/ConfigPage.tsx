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
  const [busy, setBusy] = useState(false)
  const [testingPanel, setTestingPanel] = useState(false)
  const [testingAnnounce, setTestingAnnounce] = useState(false)
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([])
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    fetch('/api/guild/channels')
      .then((r) => r.json())
      .then((j: { channels: { id: string; name: string }[]; categories: { id: string; name: string }[] }) => {
        setChannels(j.channels ?? [])
        setCategories(j.categories ?? [])
      })
      .catch(() => undefined)
  }, [])

  // keep in sync when state reloads
  useEffect(() => {
    setPanel(gs.defaultPanelChannelId ?? '')
    setAnnounce(gs.defaultAnnouncementChannelId ?? '')
    setCategory(gs.defaultCategoryId ?? gs.teamCategoryId ?? '')
    setCleanup(gs.defaultCleanupDelayHours != null ? String(gs.defaultCleanupDelayHours) : '')
  }, [gs.defaultPanelChannelId, gs.defaultAnnouncementChannelId, gs.defaultCategoryId, gs.teamCategoryId, gs.defaultCleanupDelayHours])

  const dirty =
    panel !== (gs.defaultPanelChannelId ?? '') ||
    announce !== (gs.defaultAnnouncementChannelId ?? '') ||
    category !== (gs.defaultCategoryId ?? gs.teamCategoryId ?? '') ||
    cleanup !== (gs.defaultCleanupDelayHours != null ? String(gs.defaultCleanupDelayHours) : '')

  async function save() {
    const payload: Record<string, unknown> = {}
    payload.defaultPanelChannelId = panel.trim() === '' ? null : panel.trim()
    payload.defaultAnnouncementChannelId = announce.trim() === '' ? null : announce.trim()
    // category: keep both legacy teamCategoryId and new defaultCategoryId in sync
    const catVal = category.trim() === '' ? null : category.trim()
    payload.defaultCategoryId = catVal
    payload.teamCategoryId = catVal
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

      {channels.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('config.no_channels_hint')}</p>
      )}
    </div>
  )
}
