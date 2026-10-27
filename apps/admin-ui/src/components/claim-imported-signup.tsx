import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useT } from '@/lib/i18n'
import { ArrowRight, Check, UserRoundSearch } from 'lucide-react'

type Profile = { experience: string; roleTrack: string; skills: string[]; teamPref: string }

type ClaimMatch = {
  found: boolean
  record?: { name: string; groupName: string; discordUsername: string | null }
  linkedToSelf?: boolean
  linkedToOther?: boolean
}

type ClaimResult = {
  linked: boolean
  activated: boolean
  missingFields: string[]
  prefill?: { answers: Record<string, string | string[]>; profile: Profile }
}

/** Result codes the participant can actually act on, in their own words. */
const ERROR_KEYS: Record<string, string> = {
  import_not_found: 'participant.claim_not_found',
  identity_conflict: 'participant.claim_identity_conflict',
  participant_conflict: 'participant.claim_participant_conflict',
  registration_blocked: 'participant.claim_blocked',
  event_not_active: 'participant.claim_event_inactive',
  event_unavailable: 'participant.claim_event_inactive',
  stale_form_version: 'participant.claim_stale',
  invalid_email: 'participant.claim_invalid_email',
}

/**
 * "I filled the form before I joined Discord" — the participant proves the row
 * is theirs with the e-mail they used on the external form, sees just enough to
 * recognise it, and binds it to their Discord account. The server never returns
 * answers here; only the owner's own claim response carries a prefill.
 */
export function ClaimImportedSignup({ eventId, onActivated, onPrefill }: {
  eventId: string
  onActivated: () => void
  onPrefill: (prefill: { answers: Record<string, string | string[]>; profile: Profile }) => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [match, setMatch] = useState<ClaimMatch | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<'activated' | 'bound' | null>(null)

  const describe = (code: string | undefined, fallback: string) => {
    const key = code ? ERROR_KEYS[code] : undefined
    return key ? t(key) : t(fallback)
  }

  const readError = async (response: Response) => {
    try {
      const body = await response.json() as { error?: string }
      return typeof body.error === 'string' ? body.error : undefined
    } catch { return undefined }
  }

  async function lookup() {
    const value = email.trim()
    if (value.length < 3 || !value.includes('@')) { setError(t('participant.claim_invalid_email')); return }
    setBusy(true); setError(''); setMatch(null)
    try {
      const response = await fetch(`/api/participant/events/${encodeURIComponent(eventId)}/claim/lookup`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: value }),
      })
      if (response.status === 401) { location.assign('/auth/participant'); return }
      if (!response.ok) { setError(describe(await readError(response), 'participant.claim_lookup_failed')); return }
      const result = await response.json() as ClaimMatch
      if (!result.found) { setError(t('participant.claim_not_found')); return }
      setMatch(result)
      if (result.linkedToSelf) setDone('bound')
    } catch { setError(t('participant.claim_network_error')) }
    finally { setBusy(false) }
  }

  async function claim() {
    if (!match || busy) return
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/participant/events/${encodeURIComponent(eventId)}/claim`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: email.trim() }),
      })
      if (response.status === 401) { location.assign('/auth/participant'); return }
      if (!response.ok) { setError(describe(await readError(response), 'participant.claim_failed')); return }
      const result = await response.json() as ClaimResult
      if (result.activated) { setDone('activated'); onActivated(); return }
      setDone('bound')
      if (result.prefill) onPrefill(result.prefill)
    } catch { setError(t('participant.claim_network_error')) }
    finally { setBusy(false) }
  }

  if (done === 'activated') return <section className="rounded-2xl border bg-card p-6" role="status">
    <p className="flex items-center gap-2 font-semibold"><Check size={18} />{t('participant.claim_activated')}</p>
    <p className="mt-2 text-sm opacity-75">{t('participant.claim_activated_hint')}</p>
  </section>

  if (!open) return <section className="rounded-2xl border bg-card p-6">
    <h2 className="flex items-center gap-2 text-lg font-semibold"><UserRoundSearch size={18} />{t('participant.claim_title')}</h2>
    <p className="mt-2 text-sm opacity-75">{t('participant.claim_intro')}</p>
    <Button type="button" variant="outline" className="mt-4 min-h-11" onClick={() => setOpen(true)}>
      {t('participant.claim_open')}<ArrowRight size={16} />
    </Button>
  </section>

  return <section className="space-y-4 rounded-2xl border bg-card p-6">
    <h2 className="flex items-center gap-2 text-lg font-semibold"><UserRoundSearch size={18} />{t('participant.claim_title')}</h2>
    <p className="text-sm opacity-75">{t('participant.claim_help')}</p>
    <div className="space-y-2">
      <Label htmlFor="claim-email">{t('participant.claim_email')}</Label>
      <Input id="claim-email" type="email" inputMode="email" autoComplete="email" maxLength={254} value={email}
        onChange={event => { setEmail(event.target.value); setMatch(null); setDone(null) }} disabled={busy} />
      <p className="text-xs opacity-70">{t('participant.claim_email_hint')}</p>
    </div>
    {error && <p role="alert" className="text-sm">{error}</p>}
    {done === 'bound' && <p role="status" className="text-sm">{t('participant.claim_bound')}</p>}
    {match && !done && <div className="space-y-3 rounded-xl border p-4">
      {match.linkedToOther
        ? <p role="alert" className="text-sm">{t('participant.claim_identity_conflict')}</p>
        : <>
          <p className="text-sm font-semibold">{t('participant.claim_found')}</p>
          <dl className="space-y-1 text-sm">
            <div className="flex gap-2"><dt className="opacity-70">{t('participant.claim_name')}</dt><dd>{match.record?.name || t('imports.unnamed')}</dd></div>
            {match.record?.groupName ? <div className="flex gap-2"><dt className="opacity-70">{t('participant.claim_group')}</dt><dd>{match.record.groupName}</dd></div> : null}
            {match.record?.discordUsername ? <div className="flex gap-2"><dt className="opacity-70">{t('participant.claim_discord')}</dt><dd>{match.record.discordUsername}</dd></div> : null}
          </dl>
          <p className="text-xs opacity-70">{t('participant.claim_confirm_hint')}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" className="min-h-11" disabled={busy} onClick={() => void claim()}>{busy ? t('participant.team_save') : t('participant.claim_confirm')}</Button>
            <Button type="button" variant="outline" className="min-h-11" disabled={busy} onClick={() => { setMatch(null); setError('') }}>{t('participant.claim_not_me')}</Button>
          </div>
        </>}
    </div>}
    <div className="flex flex-wrap gap-2">
      <Button type="button" className="min-h-11" disabled={busy} onClick={() => void lookup()}>{busy ? t('participant.claim_searching') : t('participant.claim_lookup')}</Button>
      <Button type="button" variant="ghost" className="min-h-11" disabled={busy} onClick={() => { setOpen(false); setMatch(null); setError(''); setDone(null) }}>{t('common.cancel')}</Button>
    </div>
  </section>
}
