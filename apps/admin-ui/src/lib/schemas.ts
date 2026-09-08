/**
 * Zod schemas: the API contract, shared shape for request payloads and
 * light runtime validation where it matters (event dates, form editor).
 */
import { z } from 'zod'

export const isoOrEmpty = z
  .string()
  .refine((v) => v === '' || !Number.isNaN(Date.parse(v)), 'Not a valid date')

export const createEventSchema = z
  .object({
    name: z.string().trim().min(3, 'Name needs at least 3 characters').max(100),
    description: z.string().trim().max(1000).optional(),
    startsAt: z.number().int().positive().nullable().optional(),
    endsAt: z.number().int().positive().nullable().optional(),
    templateId: z.string().optional(),
  })
  .refine(
    (v) => v.startsAt == null || v.endsAt == null || v.endsAt > v.startsAt,
    { message: 'The event must end after it starts', path: ['endsAt'] },
  )

export const announceSchema = z.object({
  eventId: z.string().min(1),
  title: z.string().trim().min(1, 'Headline required').max(100),
  message: z.string().trim().min(1, 'Message required').max(800),
  dm: z.boolean(),
})

export const cleanupDelaySchema = z.number().int().min(0).max(720)

export type CreateEventInput = z.infer<typeof createEventSchema>
export type AnnounceInput = z.infer<typeof announceSchema>
