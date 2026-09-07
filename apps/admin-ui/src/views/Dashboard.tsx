import type { AppState } from '@/types'
import type { TabId } from '@/types-dashboard'
import { OverviewPanel } from './panels/OverviewPanel'
import { ParticipantsPanel } from './panels/ParticipantsPanel'
import { TeamsPanel } from './panels/TeamsPanel'
import { MatchingPanel } from './panels/MatchingPanel'
import { FormPanel } from './panels/FormPanel'
import { AuditPanel } from './panels/AuditPanel'

export function Dashboard({
  state,
  refresh,
  tab,
  go,
}: {
  state: AppState
  refresh: () => Promise<void>
  tab: TabId
  go: (t: TabId) => void
}) {
  switch (tab) {
    case 'overview':
      return <OverviewPanel state={state} refresh={refresh} go={go} />
    case 'participants':
      return <ParticipantsPanel state={state} refresh={refresh} />
    case 'teams':
      return <TeamsPanel state={state} refresh={refresh} />
    case 'matching':
      return <MatchingPanel state={state} refresh={refresh} />
    case 'form':
      return <FormPanel state={state} refresh={refresh} />
    case 'audit':
      return <AuditPanel state={state} />
  }
}
