import type { AppState, FormConfig, MatchResult, Team } from './types'

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
  const res = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...init,
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
}

export { ApiError }
