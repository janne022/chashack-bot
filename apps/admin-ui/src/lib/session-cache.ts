import type { QueryClient } from '@tanstack/react-query'

export const AUTH_QUERY_KEY = ['auth', 'me'] as const

/** Discard server and participant data while retaining the session observer. */
export async function clearServerCache(client: QueryClient): Promise<void> {
  const otherQueries = { predicate: (query: { queryKey: readonly unknown[] }) => query.queryKey.length !== AUTH_QUERY_KEY.length || query.queryKey.some((part, index) => part !== AUTH_QUERY_KEY[index]) }
  await client.cancelQueries(otherQueries)
  client.removeQueries(otherQueries)
}

/** Cancel pending requests before removing all data from the previous session. */
export async function clearSessionCache(client: QueryClient): Promise<void> {
  await client.cancelQueries()
  client.clear()
}
