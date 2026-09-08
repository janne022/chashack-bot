import { useAppContext } from '@/lib/app-context'
import { AuditPanel } from '@/views/panels/AuditPanel'

export function AuditPage() {
  const { state } = useAppContext()
  return <AuditPanel state={state} />
}
