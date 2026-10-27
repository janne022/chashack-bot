import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import type { FormConfig } from '@/types'
import { Hexagon, ArrowLeft, Sun, Moon, Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PRESET_ACCENTS, readableInk, contrastRatio } from '@/lib/color'
import { setLocale, useLocale, useT } from '@/lib/i18n'

export type Appearance = NonNullable<FormConfig['appearance']>

export function resolveAppearance(form: Pick<FormConfig, 'appearance' | 'themePreset' | 'accentColor' | 'bannerUrl'>): Appearance {
  // An event-local appearance is a complete snapshot; null intentionally clears legacy images.
  if (form.appearance) return form.appearance
  const preset = form.themePreset ?? 'default'
  return { themePreset: preset, accentColor: form.accentColor ?? PRESET_ACCENTS[preset], bannerUrl: form.bannerUrl ?? null }
}

/** Colours the frame actually paints — the inherited defaults the pickers must show. */
export function frameColors(appearance: Appearance) {
  const dark = appearance.mode === 'dark' || (appearance.mode === undefined && appearance.themePreset !== 'default')
  return {
    accent: appearance.accentColor || PRESET_ACCENTS[appearance.themePreset],
    background: appearance.backgroundColor ?? (dark ? '#0a0c10' : '#f7f5f0'),
    surface: appearance.surfaceColor ?? (dark ? '#11141b' : '#fffdf9'),
    text: appearance.textColor ?? (dark ? '#eef2f7' : '#1a1d24'),
  }
}

export function ParticipantFrame({ appearance, children, preview = false }: { appearance: Appearance; children: ReactNode; preview?: boolean }) {
  const t = useT()
  const locale = useLocale()
  const [preference, setPreference] = useState<'light' | 'dark' | null>(() => {
    try { const value = localStorage.getItem('chas-participant-mode'); return value === 'light' || value === 'dark' ? value : null } catch { return null }
  })
  const authoredMode = appearance.mode ?? (appearance.themePreset === 'default' ? 'light' : 'dark')
  const mode = preview ? authoredMode : preference ?? authoredMode
  const { accent, background, surface, text } = frameColors(mode === authoredMode ? appearance : {
    ...appearance, mode, backgroundColor: undefined, surfaceColor: undefined, textColor: undefined,
  })
  const errorColor = mode === 'dark' ? '#fda4af' : '#b42335'
  const variables = {
    '--destructive': contrastRatio(errorColor, surface) >= 4.5 && contrastRatio(errorColor, background) >= 4.5 ? errorColor : text,
    '--participant-accent': accent,
    '--primary': accent, '--primary-foreground': readableInk(accent),
    '--background': background, '--card': surface, '--popover': surface,
    '--foreground': text, '--card-foreground': text, '--popover-foreground': text,
    '--muted-foreground': text,
    '--muted': 'color-mix(in srgb, ' + text + ' 6%, ' + surface + ')',
    '--input': 'color-mix(in srgb, ' + text + ' 25%, ' + surface + ')',
    '--border': 'color-mix(in srgb, ' + text + ' 16%, ' + surface + ')',
    '--accent': 'color-mix(in srgb, ' + text + ' 8%, ' + surface + ')',
    '--accent-foreground': text, '--ring': accent,
    '--color-surface': surface, '--color-surface-2': background,
  }
  // Radix popovers are portalled to body: give them the same palette as the page.
  useEffect(() => {
    if (preview) return
    const root = document.documentElement
    const previous = Object.fromEntries(Object.keys(variables).map(key => [key, root.style.getPropertyValue(key)]))
    const previousTheme = root.dataset.theme
    const wasDark = root.classList.contains('dark')
    for (const [key, value] of Object.entries(variables)) root.style.setProperty(key, value)
    root.dataset.theme = mode
    root.classList.toggle('dark', mode === 'dark')
    return () => {
      for (const [key, value] of Object.entries(previous)) value ? root.style.setProperty(key, value) : root.style.removeProperty(key)
      if (previousTheme) root.dataset.theme = previousTheme; else delete root.dataset.theme
      root.classList.toggle('dark', wasDark)
    }
  }, [accent, background, surface, text, mode, preview])
  const toggle = () => {
    const next = mode === 'dark' ? 'light' : 'dark'
    setPreference(next)
    try { localStorage.setItem('chas-participant-mode', next) } catch { /* session preference still applies */ }
  }
  return <main className={preview ? "participant-frame relative" : "participant-frame relative min-h-screen"} style={{ ...variables, color: text, backgroundColor: background, colorScheme: mode } as CSSProperties}>
    {appearance.backgroundUrl && /^https:\/\//i.test(appearance.backgroundUrl) && <img src={appearance.backgroundUrl} alt="" referrerPolicy="no-referrer" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-15" onError={event => { event.currentTarget.hidden = true }} />}
    <div className="relative mx-auto max-w-6xl px-5 pb-16 sm:px-10">
      {!preview && <header className="participant-header">
        {location.pathname === '/my-hackathons'
          ? <a href="/my-hackathons" aria-label="ChasHack" className="inline-flex min-h-11 items-center gap-3 text-xl font-bold tracking-tight"><Hexagon aria-hidden="true" className="size-7" style={{ color: accent }} />ChasHack<span className="hidden border-l border-current/20 pl-3 text-xs font-normal tracking-normal opacity-70 sm:inline">{t('participant.community')}</span></a>
          : <span className="inline-flex min-h-11 items-center gap-3 text-xl font-bold tracking-tight"><Hexagon aria-hidden="true" className="size-7" style={{ color: accent }} />ChasHack<span className="hidden border-l border-current/20 pl-3 text-xs font-normal tracking-normal opacity-70 sm:inline">{t('participant.community')}</span></span>}
        <div className="flex items-center gap-1">
          <Button variant="ghost" className="min-h-11 min-w-11" onClick={() => setLocale(locale === 'en' ? 'sv' : 'en')} aria-label={t('common.language', { locale: locale.toUpperCase() })}><Globe aria-hidden="true" size={16} />{locale.toUpperCase()}</Button>
          <Button variant="ghost" className="min-h-11 min-w-11" onClick={toggle} aria-label={t('common.switch_theme', { mode: mode === 'dark' ? t('common.theme_light') : t('common.theme_dark') })}>{mode === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}</Button>
        </div>
      </header>}
      {!preview && location.pathname !== '/my-hackathons' && <a href="/my-hackathons" className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm opacity-75 hover:opacity-100"><ArrowLeft aria-hidden="true" size={16} />{t('participant.my_title')}</a>}
      {appearance.bannerUrl && /^https:\/\//i.test(appearance.bannerUrl) && <img src={appearance.bannerUrl} alt="" referrerPolicy="no-referrer" className="mb-8 max-h-64 w-full rounded-2xl object-cover" onError={event => { event.currentTarget.hidden = true }} />}
      {children}
    </div>
  </main>
}
