import type { AppState, FormConfig, HackathonEvent, MatchResult, Team, TeamSuggestion } from './types'

class ApiError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly unauthorized = false,
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
    throw new ApiError(
      (body.message as string) ?? 'Request failed',
      (body.code as string) ?? 'error',
    )
  }
  return body as T
}

export const api = {
  async login(password: string): Promise<void> {
    await request('/api/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    })
  },

  async state(): Promise<AppState> {
    return request<AppState>('/api/state')
  },

  async participantAction(userId: string, action: string, reason?: string): Promise<void> {
    await request(`/api/participants/${userId}/status`, {
      method: 'POST',
      body: JSON.stringify({ action, reason }),
    })
  },

  async assignTeam(userId: string, teamId: string | null): Promise<void> {
    await request(`/api/participants/${userId}/team`, {
      method: 'POST',
      body: JSON.stringify({ teamId }),
    })
  },

  async createTeam(name: string, kind: 'public' | 'private', ownerId?: string): Promise<Team> {
    const res = await request<{ team: Team }>('/api/teams', {
      method: 'POST',
      body: JSON.stringify({ name, kind, ownerId }),
    })
    return res.team
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

  async matchPreview(): Promise<MatchResult> {
    const res = await request<{ result: MatchResult }>('/api/match/preview', { method: 'POST' })
    return res.result
  },

  async matchCommit(): Promise<MatchResult> {
    const res = await request<{ result: MatchResult }>('/api/match/commit', { method: 'POST' })
    return res.result
  },

  async matchSuggestions(participantId: string): Promise<TeamSuggestion[]> {
    const res = await request<{ suggestions: TeamSuggestion[] }>('/api/match/suggestions', {
      method: 'POST',
      body: JSON.stringify({ participantId }),
    })
    return res.suggestions
  },

  async matchLock(): Promise<void> {
    await request('/api/match/lock', { method: 'POST' })
  },

  async matchUnlock(): Promise<void> {
    await request('/api/match/unlock', { method: 'POST' })
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

  async resetEvent(): Promise<void> {
    await request('/api/event/reset', { method: 'POST' })
  },

  async createEvent(input: {
    name: string
    description?: string
    startsAt?: number | null
    endsAt?: number | null
    templateId?: string
    formTemplateId?: string
    panelChannelId?: string | null
    announcementChannelId?: string | null
    schedule?: { id: string; time: number; title: string; description?: string; kind?: string }[]
  }): Promise<HackathonEvent> {
    const res = await request<{ event: HackathonEvent }>('/api/events', {
      method: 'POST',
      body: JSON.stringify(input),
    })
    return res.event
  },

  async activateEvent(eventId: string): Promise<void> {
    await request(`/api/events/${eventId}/activate`, { method: 'POST' })
  },

  async updateEvent(
    eventId: string,
    update: {
      name?: string
      description?: string
      startsAt?: number | null
      endsAt?: number | null
      cleanupDelayHours?: number
      matchAt?: number | null
      schedule?: { id: string; time: number; title: string; description?: string; kind?: string }[]
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
  ): Promise<{ posted: boolean; dmSent: number; dmFailed: number }> {
    return request('/api/events/announce', {
      method: 'POST',
      body: JSON.stringify({ eventId, title, message, dm, channelId }),
    })
  },

  async createDiscordEvents(eventId: string, days: number, durationHours: number): Promise<void> {
    await request(`/api/events/${eventId}/discord-events`, {
      method: 'POST',
      body: JSON.stringify({ days, durationHours }),
    })
  },

  async listTemplates(kind?: 'event' | 'form'): Promise<{ templates: { id: string; name: string; kind: string; createdAt: number }[] }> {
    const url = kind ? `/api/templates?kind=${kind}` : '/api/templates'
    return request(url)
  },

  async saveTemplate(eventId: string, name: string, kind: 'event' | 'form' = 'event', formJson?: string): Promise<{ template: { id: string; name: string; kind: string; createdAt: number } }> {
    const body: Record<string, unknown> = { eventId, name, kind }
    if (formJson !== undefined) body.formJson = formJson
    return request('/api/templates', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  },

  async deleteTemplate(templateId: string): Promise<void> {
    await request(`/api/templates/${templateId}`, { method: 'DELETE' })
  },
}

export { ApiError }
