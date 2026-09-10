import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/matching')({
  beforeLoad: () => {
    throw redirect({ to: '/operations', search: { tab: 'matching' } as never })
  },
})
