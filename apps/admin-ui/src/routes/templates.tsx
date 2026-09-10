import { createFileRoute } from '@tanstack/react-router'
import { TemplatesPage } from '@/views/TemplatesPage'

export const Route = createFileRoute('/templates')({
  component: TemplatesPage,
})
