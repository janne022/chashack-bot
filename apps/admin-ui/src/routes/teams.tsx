import { createFileRoute } from '@tanstack/react-router'
import { TeamsPage } from '@/views/TeamsPage'

export const Route = createFileRoute('/teams')({
  component: TeamsPage,
})
