import { createContext, useContext, type ReactNode } from 'react'
import type { AppState } from '@/types'

interface AppContextValue {
  state: AppState
  refresh: () => Promise<void>
  /**
   * Switch which event the participant/team/matching views are scoped to.
   * Pass null to fall back to the server default (newest active event).
   * No-op in single-event setups.
   */
  selectEvent: (eventId: string | null) => void
}

const AppContext = createContext<AppContextValue | null>(null)

export const AppContextProvider = AppContext.Provider

export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext)
  if (ctx === null) throw new Error('useAppContext must be used inside App')
  return ctx
}

export type { ReactNode }
