import type { Question } from '@/components/signup-question'
import type { FormAppearance } from '@/types'

/** The public event + form every participant page renders. */
export interface PublicEvent {
  event: { id: string; name: string; description: string; startsAt: number | null; endsAt: number | null }
  form: {
    version: number
    title: string
    description: string
    appearance: FormAppearance
    questions: Question[]
    profileFields: {
      experiences: { id: string; label: string; label_sv?: string }[]
      roleTracks: { id: string; label: string; label_sv?: string }[]
      skills: { id: string; label: string; label_sv?: string; group: string }[]
      teamPrefs: { id: string; label: string; label_sv?: string }[]
    }
  }
}

/**
 * One cached read of `/api/public/events/:eventId` shared by the participant
 * overview, signup and team pages. Moving between them renders the previous
 * answer instantly instead of downloading the same form again.
 *
 * `force` bypasses the cache for a live push, which has to see the new form.
 */
export const publicEventQuery = (eventId: string, force = false) => ({
  queryKey: ['public-event', eventId] as const,
  queryFn: async (): Promise<PublicEvent> => {
    const res = await fetch(`/api/public/events/${encodeURIComponent(eventId)}`)
    if (!res.ok) throw new Error('participant.signup_unavailable')
    return await res.json() as PublicEvent
  },
  staleTime: force ? 0 : 5 * 60_000,
  gcTime: 30 * 60_000,
})
