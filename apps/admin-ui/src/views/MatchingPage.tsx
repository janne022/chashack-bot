import { useAppContext } from '@/lib/app-context'
import { MatchingPanel } from '@/views/panels/MatchingPanel'

export function MatchingPage() {
  const { state, refresh } = useAppContext()
  return <MatchingPanel state={state} refresh={refresh} />
}
