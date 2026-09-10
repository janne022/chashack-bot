import { createFileRoute } from '@tanstack/react-router'
import { OperatePage } from '@/views/OperatePage'

export const Route = createFileRoute('/operations')({
  component: OperatePage,
})
