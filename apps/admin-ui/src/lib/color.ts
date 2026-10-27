/** Colour maths for the appearance pickers. Pure: no React, no DOM. */

export type Hsl = { h: number; s: number; l: number }

/** Accent carried by each theme preset — the accent's inherited default. */
export const PRESET_ACCENTS = { default: '#55bbda', halloween: '#ef793e', christmas: '#347b57' } as const

/** Brand palette from DESIGN.md plus the neutrals the four surfaces need. */
export const BRAND_SWATCHES = [
  { id: 'comb_sky', hex: '#55bbda' },
  { id: 'deep_comb_sky', hex: '#2e8fb3' },
  { id: 'signal_coral', hex: '#f08080' },
  { id: 'moss_teal', hex: '#4e8780' },
  { id: 'orchid_lilac', hex: '#c77fc7' },
  { id: 'powder_pink', hex: '#f4a7b9' },
  { id: 'boundary_amber', hex: '#f0b429' },
  { id: 'alert_red', hex: '#ef4444' },
  { id: 'night_comb', hex: '#0a0c10' },
  { id: 'raised_cell', hex: '#11141b' },
  { id: 'warm_paper', hex: '#f7f5f0' },
  { id: 'moonlight_ink', hex: '#eef2f7' },
] as const

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i

/** `#abc`/`55BBDa` → lowercase `#aabbcc`; null while the input is still a draft. */
export function normalizeHex(input: string): string | null {
  const match = HEX.exec(input.trim())
  if (!match) return null
  const digits = match[1]!.toLowerCase()
  return `#${digits.length === 3 ? digits.replace(/./g, (d) => d + d) : digits}`
}

export function hexToHsl(hex: string): Hsl {
  const value = normalizeHex(hex) ?? '#000000'
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  const l = (max + min) / 2
  if (delta === 0) return { h: 0, s: 0, l: l * 100 }
  const s = delta / (1 - Math.abs(2 * l - 1))
  const raw = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return { h: ((raw * 60) % 360 + 360) % 360, s: s * 100, l: l * 100 }
}

export function hslToHex({ h, s, l }: Hsl): string {
  const saturation = s / 100
  const lightness = l / 100
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = lightness - chroma / 2
  const [r, g, b] =
    h < 60 ? [chroma, x, 0] : h < 120 ? [x, chroma, 0] : h < 180 ? [0, chroma, x] : h < 240 ? [0, x, chroma] : h < 300 ? [x, 0, chroma] : [chroma, 0, x]
  const channel = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
  return `#${channel(r!)}${channel(g!)}${channel(b!)}`
}

/** Ink that stays legible on `hex` — same threshold the participant frame uses. */
export function readableInk(hex: string): '#111827' | '#ffffff' {
  const value = normalizeHex(hex) ?? '#000000'
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16) / 255) as [number, number, number]
  const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
  return luminance > 0.179 ? '#111827' : '#ffffff'
}

export function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string) => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
    return c[0]! * .2126 + c[1]! * .7152 + c[2]! * .0722
  }
  const x = luminance(a), y = luminance(b)
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05)
}
