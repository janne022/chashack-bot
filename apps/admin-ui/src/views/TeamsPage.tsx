import { useAppContext } from '@/lib/app-context'
import { TeamsPanel } from '@/views/panels/TeamsPanel'

export function TeamsPage() {
  const { state, refresh } = useAppContext()
  return <TeamsPanel state={state} refresh={refresh} />
}
