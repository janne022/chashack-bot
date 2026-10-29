import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import type { FormConfig } from '@/types'
import { Hexagon, ArrowLeft, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LanguageMenu } from '@/components/LanguageMenu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { PRESET_ACCENTS, readableInk, contrastRatio } from '@/lib/color'
import { useT } from '@/lib/i18n'

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

export function ParticipantFrame({ appearance, children, preview = false, forceEventMode = false }: { appearance: Appearance; children: ReactNode; preview?: boolean; forceEventMode?: boolean }) {
  const t = useT()
  const [preference, setPreference] = useState<'light' | 'dark' | 'system' | 'event'>(() => {
    try { const value = localStorage.getItem('chas-participant-mode'); return value === 'light' || value === 'dark' || value === 'system' ? value : 'event' } catch { return 'event' }
  })
  const authoredMode = appearance.mode ?? (appearance.themePreset === 'default' ? 'light' : 'dark')
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => { const media = window.matchMedia('(prefers-color-scheme: dark)'); const change = (event: MediaQueryListEvent) => setSystemDark(event.matches); media.addEventListener('change', change); return () => media.removeEventListener('change', change) }, [])
  const mode = preview || forceEventMode || preference === 'event' ? authoredMode : preference === 'system' ? (systemDark ? 'dark' : 'light') : preference
  const { accent, background, surface, text } = frameColors(mode === authoredMode ? appearance : {
    ...appearance, mode, backgroundColor: undefined, surfaceColor: undefined, textColor: undefined,
  })
  const errorColor = mode === 'dark' ? '#fda4af' : '#b42335'
  const variables = {
    '--destructive': contrastRatio(errorColor, surface) >= 4.5 && contrastRatio(errorColor, background) >= 4.5 ? errorColor : text,
    '--participant-accent': accent,
    '--primary': accent, '--primary-foreground': readableInk(accent), // g0:allow:secrets #63 — CSS custom property names, not credentials.
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
  const selectPreference = (next: typeof preference) => {
    setPreference(next)
    try { if (next === 'event') localStorage.removeItem('chas-participant-mode'); else localStorage.setItem('chas-participant-mode', next) } catch { /* session preference still applies */ }
  }
  return <main className={preview ? "participant-frame relative" : "participant-frame relative min-h-screen"} style={{ ...variables, color: text, backgroundColor: background, colorScheme: mode } as CSSProperties}>
    {appearance.backgroundUrl && /^https:\/\//i.test(appearance.backgroundUrl) && <img key={appearance.backgroundUrl} src={appearance.backgroundUrl} alt="" referrerPolicy="no-referrer" className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-15" onError={event => { event.currentTarget.hidden = true }} />}
    <div className="relative mx-auto max-w-6xl px-5 pb-16 sm:px-10">
      {!preview && <header className="participant-header">
        {location.pathname === '/my-hackathons'
          ? <Link to="/my-hackathons" aria-label="ChasHack" className="inline-flex min-h-11 items-center gap-3 text-xl font-bold tracking-tight"><Hexagon aria-hidden="true" className="size-7" style={{ color: accent }} />ChasHack<span className="hidden border-l border-current/20 pl-3 text-xs font-normal tracking-normal opacity-70 sm:inline">{t('participant.community')}</span></Link>
          : <span className="inline-flex min-h-11 items-center gap-3 text-xl font-bold tracking-tight"><Hexagon aria-hidden="true" className="size-7" style={{ color: accent }} />ChasHack<span className="hidden border-l border-current/20 pl-3 text-xs font-normal tracking-normal opacity-70 sm:inline">{t('participant.community')}</span></span>}
        <div className="flex items-center gap-1">
          <LanguageMenu compact />
          {!forceEventMode && <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" className="min-h-11 min-w-11" aria-label={t('common.theme_mode')}><Sun aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuRadioGroup value={preference} onValueChange={value => selectPreference(value as typeof preference)}><DropdownMenuRadioItem value="event">{t('participant.theme_event')}</DropdownMenuRadioItem><DropdownMenuRadioItem value="light">{t('common.theme_light_mode')}</DropdownMenuRadioItem><DropdownMenuRadioItem value="dark">{t('common.theme_dark_mode')}</DropdownMenuRadioItem><DropdownMenuRadioItem value="system">{t('common.theme_system')}</DropdownMenuRadioItem></DropdownMenuRadioGroup></DropdownMenuContent></DropdownMenu>}
        </div>
      </header>}
      {!preview && location.pathname !== '/my-hackathons' && <Link to="/my-hackathons" className="mb-5 inline-flex min-h-11 items-center gap-2 text-sm opacity-75 hover:opacity-100"><ArrowLeft aria-hidden="true" size={16} />{t('participant.my_title')}</Link>}
      {appearance.bannerUrl && /^https:\/\//i.test(appearance.bannerUrl) && <img key={appearance.bannerUrl} src={appearance.bannerUrl} alt="" referrerPolicy="no-referrer" className="mb-8 max-h-64 w-full rounded-2xl object-cover" onError={event => { event.currentTarget.hidden = true }} />}
      {children}
    </div>
  </main>
}
