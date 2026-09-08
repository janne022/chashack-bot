/**
 * Tiny hand-rolled i18n for the admin UI (no dependencies).
 *
 * - I18nProvider: React context holding the current locale.
 * - useT(): hook returning t(key, params?) with {var} interpolation.
 * - setLocale(): switch locale, persist to localStorage('chas-locale'),
 *   update <html lang> and re-render the tree.
 *
 * Catalogs are flat dot-key JSON files (en.json / sv.json) imported inline so
 * Vite bundles them — no fetch, no async init.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import en from './en.json'
import sv from './sv.json'

export type Locale = 'en' | 'sv'

type Catalog = Record<string, string>

const CATALOGS: Record<Locale, Catalog> = { en, sv }
const STORAGE_KEY = 'chas-locale'

export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'en', label: 'EN' },
  { id: 'sv', label: 'SV' },
]

function readStoredLocale(): Locale {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw === 'sv' ? 'sv' : 'en'
  } catch {
    return 'en'
  }
}

function applyDocumentLang(locale: Locale): void {
  document.documentElement.lang = locale
}

interface I18nContextValue {
  locale: Locale
  t: (key: string, params?: Record<string, string | number>) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

let setLocaleExternal: ((locale: Locale) => void) | null = null

/** Switch the locale programmatically (language toggle button). */
export function setLocale(locale: Locale): void {
  setLocaleExternal?.(locale)
}

/** Translate outside React (rare) — current locale via a module ref. */
let currentLocale: Locale = readStoredLocale()

export function getLocale(): Locale {
  return currentLocale
}

export function translate(
  key: string,
  params?: Record<string, string | number>,
  locale: Locale = currentLocale,
): string {
  const raw = CATALOGS[locale][key] ?? CATALOGS.en[key] ?? key
  if (params === undefined) return raw
  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  )
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readStoredLocale)

  useEffect(() => {
    currentLocale = locale
    applyDocumentLang(locale)
    try {
      localStorage.setItem(STORAGE_KEY, locale)
    } catch {
      /* private mode — locale still works for the session */
    }
  }, [locale])

  setLocaleExternal = setLocaleState

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) => translate(key, params, locale),
    [locale],
  )

  const value = useMemo(() => ({ locale, t }), [locale, t])

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useT(): (key: string, params?: Record<string, string | number>) => string {
  const ctx = useContext(I18nContext)
  if (ctx !== null) return ctx.t
  // Fallback when rendered outside the provider (tests, portals): still translate.
  return useCallback(
    (key: string, params?: Record<string, string | number>) => translate(key, params),
    [],
  )
}

export function useLocale(): Locale {
  const ctx = useContext(I18nContext)
  return ctx?.locale ?? currentLocale
}
