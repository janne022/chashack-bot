import assert from 'node:assert/strict'
import { test } from 'node:test'
import { QueryClient } from '@tanstack/react-query'
import { AUTH_QUERY_KEY, clearServerCache, clearSessionCache } from '../src/lib/session-cache.ts'

test('server change removes old guild data and prevents in-flight responses from restoring it', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(AUTH_QUERY_KEY, { user: 'organizer' })
  client.setQueryData(['auth', 'old-session-data'], 'private')
  client.setQueryData(['guild-members', 'old-guild', 'ada'], ['old member'])
  client.setQueryData(['participant-registration', 'event'], { answers: 'private' })
  let resolve!: (value: string) => void
  let aborted = false
  const pending = client.fetchQuery({ queryKey: ['guild-members', 'old-guild', 'pending'], queryFn: ({ signal }) => new Promise<string>(r => { resolve = r; signal.addEventListener('abort', () => { aborted = true }) }) }).catch(() => undefined)
  await clearServerCache(client)
  assert.equal(aborted, true)
  resolve('late response')
  await pending
  assert.deepEqual(client.getQueryData(AUTH_QUERY_KEY), { user: 'organizer' })
  assert.equal(client.getQueryData(['auth', 'old-session-data']), undefined)
  assert.equal(client.getQueryData(['guild-members', 'old-guild', 'ada']), undefined)
  assert.equal(client.getQueryData(['guild-members', 'old-guild', 'pending']), undefined)
  assert.equal(client.getQueryData(['participant-registration', 'event']), undefined)
})

test('sign-out clears the session and all cached server data', async () => {
  const client = new QueryClient()
  client.setQueryData(AUTH_QUERY_KEY, { user: 'organizer' })
  client.setQueryData(['guild-members', 'guild', 'ada'], ['member'])
  await clearSessionCache(client)
  assert.equal(client.getQueryCache().getAll().length, 0)
})
