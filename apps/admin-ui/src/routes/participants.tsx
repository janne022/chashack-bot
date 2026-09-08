import { createFileRoute } from '@tanstack/react-router'
import { ParticipantsPage } from '@/views/ParticipantsPage'

export const Route = createFileRoute('/participants')({
  component: ParticipantsPage,
})
