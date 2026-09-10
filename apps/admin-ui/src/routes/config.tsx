import { createFileRoute } from '@tanstack/react-router'
import { ConfigPage } from '@/views/ConfigPage'

export const Route = createFileRoute('/config')({
  component: ConfigPage,
})
