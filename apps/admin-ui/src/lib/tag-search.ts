export function filterTags<T extends { tag: string; label: string }>(definitions: T[], prefix: string): T[] {
  const p = prefix.toLocaleLowerCase()
  return definitions.filter(d => !p || d.tag.toLocaleLowerCase().includes(`{${p}`) || d.label.toLocaleLowerCase().includes(p) || d.tag.slice(1, -1).toLocaleLowerCase().startsWith(p))
}
