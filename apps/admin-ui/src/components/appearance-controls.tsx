import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ColorPicker } from '@/components/color-picker'
import { ParticipantFrame, frameColors, type Appearance } from '@/components/participant-appearance'
import { PRESET_ACCENTS } from '@/lib/color'
import { useT } from '@/lib/i18n'

/**
 * The frame hides images the browser cannot load (a participant should never
 * see a broken-image icon), so the authoring surface has to say what happened.
 */
function ImagePreview({ url, label }: { url: string | null; label: string }) {
  const t = useT()
  const valid = url !== null && /^https:\/\//i.test(url)
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')

  if (url === null || url === '') return null
  if (!valid) return <p role="alert" className="text-xs text-danger">{t('form.image_error_https')}</p>

  return (
    <div className="space-y-1.5 rounded-lg border border-border bg-surface-2/40 p-2">
      <span className="block text-xs font-medium text-muted-foreground">{t('form.image_preview', { label })}</span>
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        className={state === 'ok' ? 'max-h-40 w-full rounded object-cover' : 'hidden'}
        onLoad={() => setState('ok')}
        onError={() => setState('error')}
      />
      {state === 'error' && <p role="alert" className="text-xs text-danger">{t('form.image_error')}</p>}
      {state === 'loading' && <p className="text-xs text-muted-foreground">{t('form.image_loading')}</p>}
    </div>
  )
}

export function AppearanceControls({ value, onChange, previewTitle }: { value: Appearance; onChange: (next: Appearance) => void; previewTitle?: string }) {
  const t = useT()
  const edit = (patch: Partial<Appearance>) => onChange({ ...value, ...patch })
  // Colours with no override render the frame's own defaults, so the picker shows what the participant sees.
  const frame = frameColors(value)
  const inherited: Record<'accentColor' | 'backgroundColor' | 'surfaceColor' | 'textColor', string> = {
    accentColor: PRESET_ACCENTS[value.themePreset],
    backgroundColor: frame.background,
    surfaceColor: frame.surface,
    textColor: frame.text,
  }
  const colors = [
    ['backgroundColor', 'form.background_color'],
    ['surfaceColor', 'form.surface_color'],
    ['textColor', 'form.text_color'],
  ] as const
  return <div className="space-y-5">
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="space-y-2 text-sm"><span>{t('form.theme')}</span>
        <Select value={value.themePreset} onValueChange={preset => edit({ themePreset: preset as Appearance['themePreset'], accentColor: PRESET_ACCENTS[preset as Appearance['themePreset']] })}>
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
      <div className="space-y-2 text-sm"><span className="block">{t('form.accent_color')}</span>
        <ColorPicker label={t('form.accent_color')} value={value.accentColor} inherited={value.accentColor === inherited.accentColor}
          onChange={accentColor => edit({ accentColor })} onReset={() => edit({ accentColor: inherited.accentColor })} />
      </div>
      {colors.map(([key, title]) => <div key={key} className="space-y-2 text-sm"><span className="block">{t(title)}</span>
        <ColorPicker label={t(title)} value={value[key] ?? inherited[key]} inherited={value[key] === undefined}
          onChange={hex => edit({ [key]: hex })} onReset={() => edit({ [key]: undefined })} />
      </div>)}
      {([['bannerUrl', 'form.banner_url'], ['backgroundUrl', 'form.background_url']] as const).map(([key, title]) => <div key={key} className="space-y-2 text-sm sm:col-span-2"><label className="block" htmlFor={`appearance-${key}`}>{t(title)}</label>
        <Input id={`appearance-${key}`} type="url" inputMode="url" aria-label={t(title)} placeholder="https://example.com/image.jpg" value={value[key] ?? ''} onChange={event => edit({ [key]: event.target.value || null })} />
        <span className="block text-xs">{t('form.banner_help')}</span>
        <ImagePreview key={value[key] ?? ''} url={value[key] ?? null} label={t(title)} />
        <Button type="button" variant="outline" size="sm" disabled={!value[key]} onClick={() => edit({ [key]: null })}>{t('form.clear_banner')}</Button>
      </div>)}
    </div>
    <Button type="button" variant="ghost" size="sm" onClick={() => onChange({ themePreset: 'default', accentColor: PRESET_ACCENTS.default, bannerUrl: null })}>{t('form.reset_appearance')}</Button>
    <div aria-label={t('templates.theme_preview')} className="overflow-hidden rounded-xl border">
      <ParticipantFrame appearance={value} preview><div className="space-y-3"><h2 className="text-xl font-bold">{previewTitle || t('templates.theme_preview')}</h2><p>{t('form.appearance_help')}</p><Button type="button">{t('participant.signup_submit')}</Button></div></ParticipantFrame>
    </div>
  </div>
}
