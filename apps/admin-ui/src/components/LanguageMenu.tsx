import { Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { setLocale, useLocale, useT, type Locale } from '@/lib/i18n'

export function LanguageMenu({ compact = false, side = 'bottom' }: { compact?: boolean; side?: 'top' | 'bottom' }) {
  const t = useT()
  const locale = useLocale()
  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" size={compact ? 'icon' : undefined} className={compact ? 'min-h-11 min-w-11' : 'flex-1 justify-start rounded-lg bg-card text-xs'} aria-label={t('common.choose_language')}>
        <Globe aria-hidden="true" />{compact ? <span className="sr-only">{locale.toUpperCase()}</span> : locale === 'en' ? 'English' : 'Svenska'}
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align={compact ? 'end' : 'start'} side={side} className="w-40">
      <DropdownMenuRadioGroup value={locale} onValueChange={value => setLocale(value as Locale)}>
        <DropdownMenuRadioItem value="en" lang="en">English</DropdownMenuRadioItem>
        <DropdownMenuRadioItem value="sv" lang="sv">Svenska</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>
}
