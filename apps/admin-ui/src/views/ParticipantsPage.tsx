import { useAppContext } from '@/lib/app-context'
import { ParticipantsPanel } from '@/views/panels/ParticipantsPanel'

export function ParticipantsPage() {
  const { state, refresh } = useAppContext()
  return <ParticipantsPanel state={state} refresh={refresh} />
}
