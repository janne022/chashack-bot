import { createFileRoute } from '@tanstack/react-router'
import { EventsPage } from '@/views/EventsPage'

export const Route = createFileRoute('/events')({
  component: EventsPage,
})
