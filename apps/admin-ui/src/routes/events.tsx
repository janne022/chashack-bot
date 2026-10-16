import { createFileRoute, Outlet } from '@tanstack/react-router'
import { EventsPage } from '@/views/EventsPage'

export const Route = createFileRoute('/events')({
  component: () => location.pathname.includes('/signup') ? <Outlet /> : <EventsPage />,
})
