import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/participants')({
  beforeLoad: () => {
    throw redirect({ to: '/operations', search: { tab: 'participants' } as never })
  },
})
