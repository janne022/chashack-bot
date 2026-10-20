import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ParticipantFrame, type Appearance } from '@/components/participant-appearance'
import { useT } from '@/lib/i18n'

export function AppearanceControls({ value, onChange, previewTitle }: { value: Appearance; onChange: (next: Appearance) => void; previewTitle?: string }) {
  const t = useT()
  const edit = (patch: Partial<Appearance>) => onChange({ ...value, ...patch })
  const colors = [
    ['backgroundColor', 'form.background_color'],
    ['surfaceColor', 'form.surface_color'],
    ['textColor', 'form.text_color'],
  ] as const
  return <div className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-2 text-sm"><span>{t('form.theme')}</span>
        <Select value={value.themePreset} onValueChange={preset => edit({ themePreset: preset as Appearance['themePreset'], accentColor: { default: '#55bbda', halloween: '#ef793e', christmas: '#347b57' }[preset as Appearance['themePreset']] })}>
          <SelectTrigger aria-label={t('form.theme')}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="default">{t('form.default_theme')}</SelectItem><SelectItem value="halloween">{t('form.halloween')}</SelectItem><SelectItem value="christmas">{t('form.christmas')}</SelectItem></SelectContent>
        </Select>
      </label>
      <label className="space-y-2 text-sm"><span>{t('form.mode')}</span>
        <Select value={value.mode ?? 'auto'} onValueChange={mode => edit({ mode: mode === 'auto' ? undefined : mode as 'light' | 'dark' })}>
          <SelectTrigger aria-label={t('form.mode')}><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="auto">{t('form.mode_auto')}</SelectItem><SelectItem value="light">{t('form.mode_light')}</SelectItem><SelectItem value="dark">{t('form.mode_dark')}</SelectItem></SelectContent>
        </Select>
      </label>
      <label className="space-y-2 text-sm"><span>{t('form.accent_color')}</span><Input type="color" aria-label={t('form.accent_color')} value={value.accentColor} onChange={event => edit({ accentColor: event.target.value })} /></label>
      {colors.map(([key, title]) => <label key={key} className="space-y-2 text-sm"><span>{t(title)}</span><Input type="color" aria-label={t(title)} value={value[key] ?? (key === 'textColor' ? value.mode === 'dark' || (value.mode === undefined && value.themePreset !== 'default') ? '#eef2f7' : '#1a1d24' : key === 'surfaceColor' ? value.mode === 'dark' || (value.mode === undefined && value.themePreset !== 'default') ? '#11141b' : '#fffdf9' : value.mode === 'dark' || (value.mode === undefined && value.themePreset !== 'default') ? '#0a0c10' : '#f7f5f0')} onChange={event => edit({ [key]: event.target.value })} /></label>)}
      {([['bannerUrl', 'form.banner_url'], ['backgroundUrl', 'form.background_url']] as const).map(([key, title]) => <label key={key} className="space-y-2 text-sm sm:col-span-2"><span>{t(title)}</span>
        <Input type="url" inputMode="url" aria-label={t(title)} placeholder="https://example.com/image.jpg" value={value[key] ?? ''} onChange={event => edit({ [key]: event.target.value || null })} />
        <span className="block text-xs">{t('form.banner_help')}</span>
        <Button type="button" variant="outline" size="sm" disabled={!value[key]} onClick={() => edit({ [key]: null })}>{t('form.clear_banner')}</Button>
      </label>)}
    </div>
    <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ themePreset: 'default', accentColor: '#55bbda', bannerUrl: null })}>{t('form.reset_appearance')}</Button>
    <div aria-label={t('templates.theme_preview')} className="overflow-hidden rounded-xl border">
      <ParticipantFrame appearance={value}><div className="space-y-3"><h2 className="text-xl font-bold">{previewTitle || t('templates.theme_preview')}</h2><p>{t('form.appearance_help')}</p><Button type="button">{t('participant.signup_submit')}</Button></div></ParticipantFrame>
    </div>
  </div>
}
