import { createFileRoute } from '@tanstack/react-router'
import { MatchingPage } from '@/views/MatchingPage'

export const Route = createFileRoute('/matching')({
  component: MatchingPage,
})
