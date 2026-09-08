import { createFileRoute } from '@tanstack/react-router'
import { FormPage } from '@/views/FormPage'

export const Route = createFileRoute('/form')({
  component: FormPage,
})
