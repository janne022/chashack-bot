import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/form')({
  beforeLoad: () => {
    throw redirect({ to: '/templates' })
  },
})
