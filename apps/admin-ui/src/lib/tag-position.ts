export type TagPosition = { start: number; end: number; prefix: string }

/** Find an unfinished token at the cursor, including an existing suffix when editing it. */
export function getTagPosition(value: string, cursor: number): TagPosition | null {
  const before = value.slice(0, cursor)
  const start = before.lastIndexOf('{')
  if (start === -1) return null
  const prefix = before.slice(start + 1)
  if (prefix.length > 30 || !/^[\p{L}\p{N}_]*$/u.test(prefix)) return null
  const suffix = value.slice(cursor).match(/^[a-zA-Z0-9_]*\}/)?.[0]
  return { start, end: cursor + (suffix?.length ?? 0), prefix }
}
