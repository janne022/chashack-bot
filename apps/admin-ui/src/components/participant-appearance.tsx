import { useEffect, type CSSProperties, type ReactNode } from 'react'
import type { FormConfig } from '@/types'
import { Hexagon, CalendarDays } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PRESET_ACCENTS, readableInk } from '@/lib/color'
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

export function ParticipantFrame({ appearance, children, portalTheme = false }: { appearance: Appearance; children: ReactNode; portalTheme?: boolean }) {
  const t = useT()
  const { accent, background, surface, text } = frameColors(appearance)
  const mode = appearance.mode ?? (appearance.themePreset === 'default' ? 'light' : 'dark')
  useEffect(() => {
    if (!portalTheme) return
    const root = document.documentElement
    const previousTheme = root.dataset.theme
    const hadDarkClass = root.classList.contains('dark')
    const tokens: Record<string, string> = {
      '--background': background, '--foreground': text, '--card': surface, '--card-foreground': text,
      '--popover': surface, '--popover-foreground': text, '--primary': accent,
      '--primary-foreground': readableInk(accent), '--secondary': surface, '--secondary-foreground': text,
      '--muted': surface, '--muted-foreground': text, '--accent': surface,
      '--accent-foreground': text, '--border': `${text}40`, '--input': `${text}40`, '--ring': accent,
    }
    const previous = Object.fromEntries(Object.keys(tokens).map(key => [key, root.style.getPropertyValue(key)])) as Record<string, string>
    root.dataset.theme = mode
    root.classList.toggle('dark', mode === 'dark')
    for (const [key, value] of Object.entries(tokens)) root.style.setProperty(key, value)
    return () => {
      if (previousTheme === undefined) delete root.dataset.theme
      else root.dataset.theme = previousTheme
      root.classList.toggle('dark', hadDarkClass)
      for (const [key, value] of Object.entries(previous)) {
        if (value) root.style.setProperty(key, value)
        else root.style.removeProperty(key)
      }
    }
  }, [portalTheme, mode, accent, background, surface, text])
  const style = {
    '--participant-accent': accent,
    '--primary': accent,
    '--primary-foreground': readableInk(accent), // g0:allow:secrets t_04535032 — CSS property names, not credentials.
    '--background': background,
    '--card': surface,
    '--foreground': text,
    '--card-foreground': text,
    '--muted-foreground': text,
    '--input': text,
    '--border': text,
    color: text,
    backgroundColor: background,
  } as CSSProperties
  return <main data-participant-mode={mode} className="relative min-h-screen p-4 sm:p-8" style={style}>
    {appearance.backgroundUrl && /^https:\/\//i.test(appearance.backgroundUrl) && <img src={appearance.backgroundUrl} alt="" referrerPolicy="no-referrer" className="pointer-events-none absolute inset-0 h-full w-full object-cover" onError={event => { event.currentTarget.hidden = true }} />}
    <div className="relative mx-auto max-w-6xl rounded-2xl p-3 sm:p-6" style={{ backgroundColor: surface }}>
      <header className="mb-8 flex flex-wrap items-center justify-between gap-3 border-b border-current/15 pb-4">
        <a href="/my-hackathons" aria-label="ChasHack" className="inline-flex min-h-11 items-center gap-2 font-display text-xl font-extrabold"><Hexagon aria-hidden="true" className="size-7" />ChasHack</a>
        <nav aria-label={t('participant.signup_navigation')}><Button asChild variant="outline" className="min-h-11"><a href="/my-hackathons" aria-current={location.pathname === '/my-hackathons' ? 'page' : undefined}><CalendarDays aria-hidden="true" className="size-4" />{t('participant.my_title')}</a></Button></nav>
      </header>
      {appearance.bannerUrl && /^https:\/\//i.test(appearance.bannerUrl) && <img src={appearance.bannerUrl} alt="" referrerPolicy="no-referrer" className="mb-6 max-h-64 w-full rounded-xl object-cover" onError={event => { event.currentTarget.hidden = true }} />}
      {children}
    </div>
  </main>
}
