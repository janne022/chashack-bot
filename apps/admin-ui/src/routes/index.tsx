import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  // `/` is the multi-server picker (`ServerSwitcher` links to `/?servers=1`).
  // Redirecting it unconditionally dropped the flag before `ServerGate` read it,
  // which put the organizer straight back into their remembered server.
  beforeLoad: ({ location }) => {
    if (!new URLSearchParams(location.searchStr).has('servers')) throw redirect({ to: '/events' })
  },
})
