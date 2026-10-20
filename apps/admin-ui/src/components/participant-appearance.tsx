import type { CSSProperties, ReactNode } from 'react'
import type { FormConfig } from '@/types'

export type Appearance = NonNullable<FormConfig['appearance']>
const accents = { default: '#55bbda', halloween: '#ef793e', christmas: '#347b57' }

export function resolveAppearance(form: Pick<FormConfig, 'appearance' | 'themePreset' | 'accentColor' | 'bannerUrl'>): Appearance {
  // An event-local appearance is a complete snapshot; null intentionally clears legacy images.
  if (form.appearance) return form.appearance
  const preset = form.themePreset ?? 'default'
  return { themePreset: preset, accentColor: form.accentColor ?? accents[preset], bannerUrl: form.bannerUrl ?? null }
}

function foreground(hex: string) {
  const channels = hex.slice(1).match(/.{2}/g)?.map(part => {
    const n = parseInt(part, 16) / 255
    return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4
  }) ?? [0, 0, 0]
  return channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722 > .179 ? '#111827' : '#ffffff'
}

export function ParticipantFrame({ appearance, children }: { appearance: Appearance; children: ReactNode }) {
  const dark = appearance.mode === 'dark' || (appearance.mode === undefined && appearance.themePreset !== 'default')
  const background = appearance.backgroundColor ?? (dark ? '#0a0c10' : '#f7f5f0')
  const surface = appearance.surfaceColor ?? (dark ? '#11141b' : '#fffdf9')
  const text = appearance.textColor ?? (dark ? '#eef2f7' : '#1a1d24')
  const accent = appearance.accentColor || accents[appearance.themePreset]
  const style = {
    '--participant-accent': accent,
    '--primary': accent,
    '--primary-foreground': foreground(accent), // g0:allow:secrets t_04535032 — CSS property names, not credentials.
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
  return <main className="relative min-h-screen p-4 sm:p-8" style={style}>
    {appearance.backgroundUrl && /^https:\/\//i.test(appearance.backgroundUrl) && <img src={appearance.backgroundUrl} alt="" referrerPolicy="no-referrer" className="pointer-events-none absolute inset-0 h-full w-full object-cover" onError={event => { event.currentTarget.hidden = true }} />}
    <div className="relative mx-auto max-w-6xl rounded-2xl p-3 sm:p-6" style={{ backgroundColor: surface }}>
      {appearance.bannerUrl && /^https:\/\//i.test(appearance.bannerUrl) && <img src={appearance.bannerUrl} alt="" referrerPolicy="no-referrer" className="mb-6 max-h-64 w-full rounded-xl object-cover" onError={event => { event.currentTarget.hidden = true }} />}
      {children}
    </div>
  </main>
}
