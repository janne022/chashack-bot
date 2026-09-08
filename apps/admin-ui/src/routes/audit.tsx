import { createFileRoute } from '@tanstack/react-router'
import { AuditPage } from '@/views/AuditPage'

export const Route = createFileRoute('/audit')({
  component: AuditPage,
})
