import { createFileRoute, Outlet } from '@tanstack/react-router'
import { EventsPage } from '@/views/EventsPage'

export const Route = createFileRoute('/events')({
  component: () => /^\/events\/[^/]+\/?(?:signup)?\/?$/.test(location.pathname) ? <Outlet /> : <EventsPage />,
})
