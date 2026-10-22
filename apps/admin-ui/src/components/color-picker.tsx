import { useEffect, useId, useState, type CSSProperties } from 'react'
import { Check, ChevronDown, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { BRAND_SWATCHES, hexToHsl, hslToHex, normalizeHex, readableInk } from '@/lib/color'

const SLIDER =
  'w-full cursor-pointer appearance-none bg-transparent outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-[image:var(--track)] [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-popover [&::-moz-range-thumb]:bg-ring [&::-moz-range-thumb]:shadow [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-[image:var(--track)] [&::-webkit-slider-thumb]:mt-[-4px] [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-popover [&::-webkit-slider-thumb]:bg-ring [&::-webkit-slider-thumb]:shadow'

export function ColorPicker({ label, value, inherited = false, onChange, onReset }: {
  label: string
  value: string
  inherited?: boolean
  onChange: (hex: string) => void
  onReset?: () => void
}) {
  const t = useT()
  const [draft, setDraft] = useState(value)
  const helpId = useId()
  // Keep the user's own casing while they type; only re-seed when the model changed elsewhere.
  useEffect(() => setDraft((current) => (normalizeHex(current) === value ? current : value)), [value])

  const invalid = normalizeHex(draft) === null
  const hsl = hexToHsl(value)
  const { h, s, l } = { h: Math.round(hsl.h), s: Math.round(hsl.s), l: Math.round(hsl.l) }
  const swatchName = inherited ? `${label}: ${value} (${t('color.inherited')})` : `${label}: ${value}`
  const sliders = [
    { key: 'h', title: t('color.hue'), value: h, max: 359, track: `linear-gradient(to right, ${[0, 60, 120, 180, 240, 300, 359].map((stop) => `hsl(${stop} ${s}% ${l}%)`).join(', ')})` },
    { key: 's', title: t('color.saturation'), value: s, max: 100, track: `linear-gradient(to right, hsl(${h} 0% ${l}%), hsl(${h} 100% ${l}%))` },
    { key: 'l', title: t('color.lightness'), value: l, max: 100, track: `linear-gradient(to right, hsl(${h} ${s}% 0%), hsl(${h} ${s}% 50%), hsl(${h} ${s}% 100%))` },
  ] as const

  return <Popover>
    <PopoverTrigger asChild>
      <Button type="button" variant="outline" size="lg" aria-label={swatchName} className="w-full justify-start gap-2 font-normal">
        <span aria-hidden="true" className="size-5 shrink-0 rounded-md ring-1 ring-foreground/15" style={{ backgroundColor: value }} />
        <span className="font-mono text-xs">{value}</span>
        {inherited && <span className="text-muted-foreground text-xs">{t('color.inherited')}</span>}
        <ChevronDown aria-hidden="true" className="ml-auto size-3.5 opacity-60" />
      </Button>
    </PopoverTrigger>
    <PopoverContent className="w-80 gap-3 p-3" aria-label={label}>
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="size-11 shrink-0 rounded-lg ring-1 ring-foreground/15" style={{ backgroundColor: value }} />
        <div className="flex-1 space-y-1">
          <Input aria-label={t('color.hex')} aria-invalid={invalid || undefined} aria-describedby={helpId} value={draft} spellCheck={false} autoComplete="off"
            onChange={(event) => { setDraft(event.target.value); const hex = normalizeHex(event.target.value); if (hex) onChange(hex) }} />
          <p id={helpId} className={cn('text-xs', invalid ? 'text-destructive' : 'text-muted-foreground')}>{t(invalid ? 'color.hex_invalid' : 'color.hex_hint')}</p>
        </div>
      </div>
      <div role="group" aria-label={t('color.palette')} className="grid grid-cols-6 gap-1.5">
        {BRAND_SWATCHES.map((swatch) => {
          const selected = swatch.hex === value
          return <button key={swatch.id} type="button" aria-label={`${t(`color.swatch.${swatch.id}`)} ${swatch.hex}`} aria-pressed={selected}
            onClick={() => onChange(swatch.hex)}
            className={cn('flex size-11 items-center justify-center rounded-lg ring-1 ring-foreground/15 outline-none transition hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', selected && 'outline-2 outline-offset-2 outline-ring')}
            style={{ backgroundColor: swatch.hex }}>
            {selected && <Check aria-hidden="true" className="size-4" style={{ color: readableInk(swatch.hex) }} />}
          </button>
        })}
      </div>
      <div className="space-y-2">
        {sliders.map((slider) => <div key={slider.key} className="flex items-center gap-2">
          <label htmlFor={`${helpId}-${slider.key}`} className="w-16 shrink-0 text-xs text-muted-foreground">{slider.title}</label>
          <input id={`${helpId}-${slider.key}`} type="range" min={0} max={slider.max} value={slider.value} aria-label={`${label}: ${slider.title}`}
            style={{ '--track': slider.track } as CSSProperties}
            className={cn(SLIDER, 'h-4')}
            onChange={(event) => onChange(hslToHex({ ...hsl, [slider.key]: Number(event.target.value) }))} />
          <output htmlFor={`${helpId}-${slider.key}`} className="w-8 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">{slider.value}</output>
        </div>)}
      </div>
      {onReset && <Button type="button" variant="ghost" size="sm" className="justify-start" disabled={inherited} onClick={onReset}>
        <RotateCcw aria-hidden="true" />{t('color.use_default')}
      </Button>}
    </PopoverContent>
  </Popover>
}
