import { useAppContext } from '@/lib/app-context'
import { FormPanel } from '@/views/panels/FormPanel'

export function FormPage() {
  const { state, refresh } = useAppContext()
  return <FormPanel state={state} refresh={refresh} />
}
