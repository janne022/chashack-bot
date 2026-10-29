import type { AnswerVersion, AppState, AuthMe, DiscordEventSyncResult, FormConfig, HackathonEvent, ImportedSignup, MatchResult, SubmissionForm, SubmissionRecord, Team, TeamSuggestion } from './types'
import { translate } from './lib/i18n'

export function rateLimitMessage(response: Response): string {
  const seconds = Number(response.headers.get('retry-after'))
  return Number.isFinite(seconds) && seconds > 0
    ? translate('common.rate_limited_retry', { seconds })
    : translate('common.rate_limited')
}

class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly unauthorized = false,
    public readonly retryAfterSeconds?: number,
    public readonly rateLimited = false,
  ) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const hasBody = init?.body !== undefined
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (res.status === 401) {
    throw new ApiError('Not signed in', 'unauthorized', true)
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const retryAfterSeconds = res.status === 429 ? Number(res.headers.get('retry-after')) : NaN
    const message = (body.message as string) ?? 'Request failed'
    throw new ApiError(
      res.status === 429
        ? rateLimitMessage(res)
        : message,
      (body.code as string) ?? (body.error as string) ?? 'error',
      false,
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds : undefined,
      res.status === 429,
    )
  }
  return body as T
}

export const api = {
  async addParticipant(eventId: string, userId: string): Promise<void> {
    await request(`/api/events/${encodeURIComponent(eventId)}/participants`, { method: 'POST', body: JSON.stringify({ userId }) })
  },
  async registrationAnswers(eventId: string, userId: string): Promise<AnswerVersion & { answerHistory: AnswerVersion[] }> {
    return request(`/api/events/${encodeURIComponent(eventId)}/registrations/${encodeURIComponent(userId)}`)
  },


  async submissionForm(eventId: string): Promise<{ form: SubmissionForm }> {
    return request(`/api/events/${encodeURIComponent(eventId)}/submission-form`)
  },
  async saveSubmissionForm(eventId: string, form: SubmissionForm): Promise<{ form: SubmissionForm }> {
    return request(`/api/events/${encodeURIComponent(eventId)}/submission-form`, { method: 'PUT', body: JSON.stringify({ version: form.version, form: { enabled: form.enabled, allowEdits: form.allowEdits, questions: form.questions } }) })
  },
  async submissions(eventId: string, signal?: AbortSignal): Promise<{ form: SubmissionForm; submissions: (SubmissionRecord & { userId: string })[] }> {
    return request(`/api/events/${encodeURIComponent(eventId)}/submissions`, { signal })
  },

  /**
   * Load app state. Pass an eventId to scope participants/teams/matching to a
   * specific event — required when more than one event is active at once.
   */
  async state(eventId?: string | null, signal?: AbortSignal): Promise<AppState> {
    const qs = eventId ? `?eventId=${encodeURIComponent(eventId)}` : ''
    return request<AppState>(`/api/state${qs}`, signal ? { signal } : undefined)
  },

  /** All event-scoped calls accept an explicit eventId; omit it to let the server pick the default event. */
  async participantAction(userId: string, action: string, reason?: string, eventId?: string): Promise<void> {
    await request(`/api/participants/${userId}/status`, {
      method: 'POST',
      body: JSON.stringify({ action, reason, ...(eventId ? { eventId } : {}) }),
    })
  },

  async assignTeam(userId: string, teamId: string | null, eventId?: string): Promise<void> {
    await request(`/api/participants/${userId}/team`, {
      method: 'POST',
      body: JSON.stringify({ teamId, ...(eventId ? { eventId } : {}) }),
    })
  },

  async createTeam(name: string, kind: 'public' | 'private', ownerId: string, eventId?: string): Promise<{ team: Team; provisioning: 'complete' | 'pending' | 'disabled' }> {
    return request('/api/teams', {
      method: 'POST',
      body: JSON.stringify({ name, kind, ownerId, ...(eventId ? { eventId } : {}) }),
    })
  },

  async provisionTeam(teamId: string): Promise<{ team: Team; provisioning: 'complete' | 'pending' }> {
    return request(`/api/teams/${encodeURIComponent(teamId)}/provision`, { method: 'POST' })
  },

  async deleteTeam(teamId: string): Promise<void> {
    await request(`/api/teams/${teamId}/delete`, { method: 'POST' })
  },

  async rotateCode(teamId: string): Promise<string> {
    const res = await request<{ code: string }>(`/api/teams/${teamId}/rotate-code`, {
      method: 'POST',
    })
    return res.code
  },

  async updateTeamSettings(
    teamId: string,
    update: { name?: string; kind?: 'public' | 'private'; colorId?: string | null },
  ): Promise<Team> {
    const res = await request<{ team: Team }>(`/api/teams/${teamId}/settings`, {
      method: 'POST',
      body: JSON.stringify(update),
    })
    return res.team
  },

  async setGuildCategory(categoryId: string | null): Promise<void> {
    await request('/api/guild/category', {
      method: 'POST',
      body: JSON.stringify({ categoryId }),
    })
  },

  async updateGuildSettings(update: {
    teamCategoryId?: string | null
    defaultAnnouncementChannelId?: string | null
    defaultPanelChannelId?: string | null
    defaultCategoryId?: string | null
    defaultCleanupDelayHours?: number | null
    defaultFormTemplateId?: string | null
    defaultScheduleChannelId?: string | null
    modRoleIds?: string[] | null
  }): Promise<{ settings: AppState['guildSettings'] }> {
    return request('/api/guild/settings', {
      method: 'POST',
      body: JSON.stringify(update),
    })
  },

  async setEventForm(eventId: string, opts: { formTemplateId?: string; formJson?: string }): Promise<{ form: FormConfig }> {
    return request(`/api/events/${eventId}/form`, {
      method: 'POST',
      body: JSON.stringify(opts),
    })
  },

  async removeMember(teamId: string, userId: string): Promise<void> {
    await request(`/api/teams/${teamId}/remove-member`, {
      method: 'POST',
      body: JSON.stringify({ userId }),
    })
  },

  async matchPreview(eventId?: string): Promise<MatchResult> {
    const res = await request<{ result: MatchResult }>('/api/match/preview', {
      method: 'POST',
      body: JSON.stringify({ ...(eventId ? { eventId } : {}) }),
    })
    return res.result
  },

  async matchCommit(eventId?: string, revision?: string): Promise<MatchResult> {
    const res = await request<{ result: MatchResult }>('/api/match/commit', {
      method: 'POST',
      body: JSON.stringify({ revision, ...(eventId ? { eventId } : {}) }),
    })
    return res.result
  },

  async matchSuggestions(participantId: string, eventId?: string): Promise<TeamSuggestion[]> {
    const res = await request<{ suggestions: TeamSuggestion[] }>('/api/match/suggestions', {
      method: 'POST',
      body: JSON.stringify({ participantId, ...(eventId ? { eventId } : {}) }),
    })
    return res.suggestions
  },

  async matchLock(eventId?: string): Promise<void> {
    await request('/api/match/lock', {
      method: 'POST',
      body: JSON.stringify({ ...(eventId ? { eventId } : {}) }),
    })
  },

  async matchUnlock(eventId?: string): Promise<void> {
    await request('/api/match/unlock', {
      method: 'POST',
      body: JSON.stringify({ ...(eventId ? { eventId } : {}) }),
    })
  },

  async updateForm(config: Partial<FormConfig>): Promise<FormConfig> {
    const res = await request<{ config: FormConfig }>('/api/form', {
      method: 'POST',
      body: JSON.stringify(config),
    })
    return res.config
  },

  async resetForm(): Promise<FormConfig> {
    const res = await request<{ config: FormConfig }>('/api/form/reset', { method: 'POST' })
    return res.config
  },

  async resetEvent(eventId?: string): Promise<void> {
    await request('/api/event/reset', {
      method: 'POST',
      body: JSON.stringify({ ...(eventId ? { eventId } : {}) }),
    })
  },

  async createEvent(input: {
    name: string
    description?: string
    startsAt?: number | null
    endsAt?: number | null
    signupStartsAt?: number | null
    signupEndsAt?: number | null
    cleanupDelayHours?: number
    templateId?: string
    formTemplateId?: string
    formJson?: string
    panelChannelId?: string | null
    announcementChannelId?: string | null
    scheduleChannelId?: string | null
    schedule?: { id: string; time: number; title: string; description?: string; kind?: string; actions?: { id: string; type: string; title?: string; message?: string; channelId?: string | null; mode?: string; assignmentId?: string }[] }[]
    announcements?: { id: string; title: string; message: string; trigger: string; channelId?: string | null }[]
    assignments?: { id: string; title: string; instructions: string; description?: string }[]
    assignmentStrategy?: 'random' | 'same'
    launch?: boolean
    createDiscordEvent?: boolean
    saveAsTemplate?: boolean
    saveTemplateName?: string
  }): Promise<{ event: HackathonEvent; discordEvent: DiscordEventSyncResult | null }> {
    const res = await request<{ event: HackathonEvent; discordEvent?: DiscordEventSyncResult | null }>('/api/events', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return { event: res.event, discordEvent: res.discordEvent ?? null }
  },

  async activateEvent(eventId: string): Promise<{ event: HackathonEvent; panel: { ok: boolean; channelId?: string; reason?: string; edited?: boolean }; announce: { posted: boolean; reason: string; channelId: string | null } | null; itinerary?: { ok: boolean; channelId?: string; reason?: string; edited?: boolean } | null; discordEvent?: DiscordEventSyncResult | null }> {
    const res = await request<{ ok: true; event: HackathonEvent; panel: { ok: boolean; channelId?: string; reason?: string; edited?: boolean }; announce: { posted: boolean; reason: string; channelId: string | null } | null; itinerary?: { ok: boolean; channelId?: string; reason?: string; edited?: boolean } | null; discordEvent?: DiscordEventSyncResult | null }>(`/api/events/${eventId}/activate`, { method: 'POST' })
    return { event: res.event, panel: res.panel, announce: res.announce, itinerary: (res as unknown as { itinerary?: { ok: boolean; channelId?: string; reason?: string; edited?: boolean } | null }).itinerary ?? null, discordEvent: res.discordEvent ?? null }
  },

  async updateEvent(
    eventId: string,
    update: {
      name?: string
      description?: string
      startsAt?: number | null
      endsAt?: number | null
      signupStartsAt?: number | null
      signupEndsAt?: number | null
      cleanupDelayHours?: number
      matchAt?: number | null
      schedule?: { id: string; time: number; title: string; description?: string; kind?: string; actions?: { id: string; type: string; title?: string; message?: string; channelId?: string | null; mode?: string; assignmentId?: string }[] }[]
      announcements?: { id: string; title: string; message: string; trigger: string; channelId?: string | null }[]
      assignments?: { id: string; title: string; instructions: string; description?: string }[]
      scheduleChannelId?: string | null
    },
  ): Promise<void> {
    await request(`/api/events/${eventId}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    })
  },

  async endEvent(eventId: string): Promise<void> {
    await request(`/api/events/${eventId}/end`, { method: 'POST' })
  },

  async announce(
    eventId: string,
    title: string,
    message: string,
    dm: boolean,
    channelId?: string,
    teamChats = false,
  ): Promise<{ posted: boolean; reason: string; channelId: string | null; dmSent: number; dmFailed: number; teamSent: number; teamFailed: number }> {
    return request('/api/events/announce', {
      method: 'POST',
      body: JSON.stringify({ eventId, title, message, dm, channelId, teamChats }),
    })
  },

  async testChannel(channelId: string): Promise<{ ok: true; channelId: string; name: string }> {
    return request('/api/diag/channel-test', {
      method: 'POST',
      body: JSON.stringify({ channelId }),
    })
  },

  async getGuildChannels(): Promise<{ channels: { id: string; name: string }[]; categories: { id: string; name: string }[]; roles: { id: string; name: string; color: string }[] }> {
    return request('/api/guild/channels')
  },

  async previewSignupImport(eventId: string, csv: string, mapping?: Record<string, string>, templateId?: string | null): Promise<{ headers: string[]; suggestedMapping: Record<string, string>; presetId: string | null; rows: { rowNumber: number; values: Record<string, string>; answers: Record<string, string | string[]>; issues: string[]; duplicateStatus: 'create' | 'duplicate' | 'conflict' }[]; summary: { create: number; duplicate: number; conflict: number } }> {
    return request(`/api/events/${encodeURIComponent(eventId)}/signup-import/preview`, { method: 'POST', body: JSON.stringify({ csv, ...(mapping ? { mapping } : {}), ...(templateId ? { templateId } : {}) }) })
  },

  async signupImportTemplates(eventId: string): Promise<{ templates: { id: string; label: { en: string; sv: string }; description: { en: string; sv: string }; columns: { header: string; target: string }[] }[] }> {
    return request(`/api/events/${encodeURIComponent(eventId)}/signup-import/templates`)
  },

  async importSignups(eventId: string, rows: { sourceRow: number; values: Record<string, string>; answers: Record<string, string | string[]> }[]): Promise<{ saved: number; skipped: number; conflicts: number; warnings?: { row: number; issues: string[] }[]; autoLink?: { linked: { importId: string; userId: string; username: string; alreadyRegistered: boolean }[]; ambiguous: { importId: string; username: string }[]; missing: number; conflicts: { importId: string; username: string; error: string }[] } }> {
    return request(`/api/events/${encodeURIComponent(eventId)}/signup-import`, { method: 'POST', body: JSON.stringify({ rows }) })
  },

  async importedSignups(eventId: string): Promise<{ records: ImportedSignup[] }> {
    return request(`/api/events/${encodeURIComponent(eventId)}/imported-signups`)
  },

  async updateImportedSignup(eventId: string, id: string, update: { values?: Record<string, string>; answers?: Record<string, string | string[]>; discordUsername?: string | null; linkDiscordUserId?: string }): Promise<{
    record: ImportedSignup
    activated?: boolean
    missingFields: string[]
    alreadyRegistered?: boolean
    groupTeam?: { teamId: string; teamName: string; created: boolean }
    warnings?: string[]
  }> {
    return request(`/api/events/${encodeURIComponent(eventId)}/imported-signups/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(update) })
  },

  async deleteImportedSignup(eventId: string, id: string): Promise<{ deleted: number }> {
    return request(`/api/events/${encodeURIComponent(eventId)}/imported-signups/${encodeURIComponent(id)}`, { method: 'DELETE' })
  },

  async deleteImportedSignups(eventId: string, ids: string[]): Promise<{ deleted: number }> {
    return request(`/api/events/${encodeURIComponent(eventId)}/imported-signups/delete`, { method: 'POST', body: JSON.stringify({ ids }) })
  },

  /**
   * Link every imported row whose Discord username matches exactly one member.
   * Ambiguous or unknown names stay unlinked and are reported, never guessed.
   */
  async autoLinkImportedSignups(eventId: string): Promise<{
    linked: { importId: string; userId: string; username: string; alreadyRegistered: boolean }[]
    ambiguous: { importId: string; username: string }[]
    missing: number
    conflicts: { importId: string; username: string; error: string }[]
    records?: ImportedSignup[]
  }> {
    return request(`/api/events/${encodeURIComponent(eventId)}/imported-signups/auto-link`, { method: 'POST' })
  },

  async searchGuildMembers(query: string, after: string | null, signal?: AbortSignal): Promise<{ members: { id: string; username: string; displayName: string; avatar: string }[]; nextCursor: string | null }> {
    const params = new URLSearchParams({ query })
    if (after) params.set('after', after)
    return request(`/api/guild/members?${params}`, { signal })
  },

  async createDiscordEvents(eventId: string, days: number, durationHours: number): Promise<void> {
    await request(`/api/events/${eventId}/discord-events`, {
      method: 'POST',
      body: JSON.stringify({ days, durationHours }),
    })
  },

  async syncDiscordEvent(eventId: string): Promise<DiscordEventSyncResult> {
    return request(`/api/events/${encodeURIComponent(eventId)}/discord-event`, { method: 'POST' })
  },

  async listTemplates(kind?: 'event' | 'form' | 'announcement' | 'assignments' | 'theme'): Promise<{ templates: { id: string; name: string; kind: string; createdAt: number }[] }> {
    const url = kind ? `/api/templates?kind=${kind}` : '/api/templates'
    return request(url)
  },

  async saveTemplate(eventId: string, name: string, kind: 'event' | 'form' | 'announcement' = 'event', formJson?: string): Promise<{ template: { id: string; name: string; kind: string; createdAt: number } }> {
    const body: Record<string, unknown> = { eventId, name, kind }
    if (formJson !== undefined) body.formJson = formJson
    // also allow raw json for event templates from editor
    if (kind === 'event' && eventId === '__json__' && formJson !== undefined) {
      body.json = formJson
      delete body.eventId
      delete body.formJson
    }
    return request('/api/templates', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },

  async createTemplateRaw(name: string, kind: 'event' | 'form' | 'announcement' | 'assignments' | 'theme', json: string): Promise<{ template: { id: string; name: string; kind: string; createdAt: number } }> {
    return request('/api/templates', {
      method: 'POST',
      body: JSON.stringify({ name, kind, json }),
    })
  },

  async updateTemplate(templateId: string, update: { name?: string; json?: string }): Promise<{ template: { id: string; name: string; kind: string; createdAt: number } }> {
    return request(`/api/templates/${templateId}`, {
      method: 'PATCH',
      body: JSON.stringify(update),
    })
  },

  async deleteTemplate(templateId: string): Promise<void> {
    await request(`/api/templates/${templateId}`, { method: 'DELETE' })
  },

  // ─── session (multi-server + Discord login) ───


  async authMe(signal?: AbortSignal): Promise<AuthMe> {
    return request('/api/auth/me', { signal })
  },

  async switchGuild(guildId: string): Promise<{ ok: true; guildId: string }> {
    return request('/api/auth/guild', { method: 'POST', body: JSON.stringify({ guildId }) })
  },

  async logout(): Promise<void> {
    await request('/api/auth/logout', { method: 'POST' })
  },
}

export { ApiError }
