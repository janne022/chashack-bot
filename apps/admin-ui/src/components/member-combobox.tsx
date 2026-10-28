import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Check, Loader2, Search, UserRound, X } from 'lucide-react'
import { cn } from 'cn'
import { api } from '@/api'
import { useT } from '@/lib/i18n'
import { ServerContext } from '@/components/ServerGate'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export interface GuildMemberOption {
  id: string
  username: string
  displayName: string
  avatar: string
}

/**
 * A Discord username typed into a Google Form is not a Discord identity: it can
 * be `@name`, `name#1234` or plain. Reduce it to what the member search expects.
 */
export function memberQueryFromUsername(username: string | null | undefined): string {
  if (typeof username !== 'string') return ''
  return username.trim().replace(/^@+/, '').replace(/#\d{1,4}$/, '').trim()
}

function isExactMatch(member: GuildMemberOption, query: string): boolean {
  const wanted = query.trim().toLocaleLowerCase()
  if (wanted.length === 0) return false
  return member.username.toLocaleLowerCase() === wanted || member.displayName.toLocaleLowerCase() === wanted
}

/**
 * Guild member picker that searches while the organizer types.
 *
 * One debounced search per pause, cached by TanStack Query, so opening the same
 * editor twice does not repeat the Discord round trip. When the imported row
 * carries a Discord username from the form, the picker starts on that name and
 * preselects an exact match — the organizer confirms with "Save & link" instead
 * of typing the name again.
 */
export function MemberCombobox({
  value,
  onSelect,
  initialQuery = '',
  disabled = false,
  onError,
}: {
  value: GuildMemberOption | null
  onSelect: (member: GuildMemberOption | null) => void
  initialQuery?: string
  disabled?: boolean
  onError?: (message: string) => void
}) {
  const t = useT()
  const guildId = useContext(ServerContext)?.guild.id
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState(initialQuery)
  const [debounced, setDebounced] = useState(initialQuery)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const preselected = useRef('')

  useEffect(() => { setQuery(initialQuery); setDebounced(initialQuery); setActive(0) }, [initialQuery])
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 300)
    return () => clearTimeout(timer)
  }, [query])

  const term = debounced.trim()
  const enabled = open && !!guildId
  const search = useInfiniteQuery({
    queryKey: ['guild-members', guildId, term],
    queryFn: ({ signal, pageParam }) => api.searchGuildMembers(term, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: page => page.nextCursor,
    enabled,
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    retry: false,
  })
  const members = useMemo(() => query.trim() === term ? search.data?.pages.flatMap(page => page.members) ?? [] : [], [search.data, query, term])
  const exact = useMemo(() => members.find((member) => isExactMatch(member, term)) ?? null, [members, term])

  // Offer the form's own username as the answer when it identifies exactly one
  // member. The trigger shows the choice, so nothing is linked until Save.
  useEffect(() => {
    if (value !== null || exact === null || members.length !== 1) return
    const key = `${term}:${exact.id}`
    if (preselected.current === key) return
    preselected.current = key
    onSelect(exact)
  }, [exact, members.length, onSelect, term, value])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  useEffect(() => { setActive(0) }, [term])
  useEffect(() => { if (open) document.getElementById(`member-option-${members[active]?.id}`)?.scrollIntoView({ block: 'nearest' }) }, [active, term, open])

  useEffect(() => {
    if (search.error && onError) onError(search.error instanceof Error ? search.error.message : t('imports.member_search_failed'))
  }, [search.error, onError, t])

  const choose = (member: GuildMemberOption) => {
    onSelect(member)
    setOpen(false)
  }

  return (
    <Popover modal open={open} onOpenChange={open => { if (!disabled) setOpen(open) }}>
      <div className="flex items-center gap-1">
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" disabled={disabled} className="min-w-0 flex-1 justify-start font-normal" aria-label={t('imports.member_search')}>
            {value?.avatar ? <img src={value.avatar} alt="" className="size-6 shrink-0 rounded-full" /> : <UserRound className="size-4 shrink-0 text-muted-foreground" />}
            {value === null
              ? <span className="truncate text-muted-foreground">{t('imports.member_choose')}</span>
              : <span className="truncate">{value.displayName} <span className="text-muted-foreground">@{value.username}</span></span>}
          </Button>
        </PopoverTrigger>
        {value !== null && !disabled && <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label={t('imports.member_clear')} onClick={() => onSelect(null)}><X className="size-4" /></Button>}
      </div>
      <PopoverContent className="w-[min(26rem,calc(100vw-2rem))] p-2" align="start">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            role="combobox"
            aria-expanded={open}
            aria-controls="member-combobox-list"
            aria-autocomplete="list"
            aria-activedescendant={members[active] ? `member-option-${members[active]!.id}` : undefined}
            className="pl-8"
            value={query}
            placeholder={t('imports.member_search_placeholder')}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => Math.min(index + 1, members.length - 1)) }
              else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(index - 1, 0)) }
              else if (event.key === 'Enter' && members[active]) { event.preventDefault(); choose(members[active]!) }
              else if (event.key === 'Escape') { event.preventDefault(); setOpen(false) }
            }}
          />
        </div>
        <div id="member-combobox-list" role="listbox" aria-label={t('imports.member_search')} className="mt-2 max-h-64 space-y-0.5 overflow-y-auto" onScroll={event => { const el = event.currentTarget; if (el.scrollHeight - el.scrollTop - el.clientHeight < 80 && search.hasNextPage && !search.isFetching) void search.fetchNextPage() }}>
          {enabled && search.isFetching && <p className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{t('imports.searching')}</p>}
          {enabled && !search.isFetching && search.error && <p role="alert" className="px-2 py-3 text-xs text-destructive">{search.error instanceof Error ? search.error.message : t('imports.member_search_failed')}</p>}
          {enabled && !search.isFetching && !search.error && members.length === 0 && <p className="px-2 py-3 text-xs text-muted-foreground">{t('imports.member_search_empty')}</p>}
          {members.map((member, index) => <button
            key={member.id}
            id={`member-option-${member.id}`}
            type="button"
            role="option"
            aria-selected={value?.id === member.id}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-surface-2',
              index === active && 'bg-surface-2',
              value?.id === member.id && 'bg-accent/10',
            )}
            onMouseEnter={() => setActive(index)}
            onClick={() => choose(member)}
          >
            <img src={member.avatar} alt="" loading="lazy" className="size-8 shrink-0 rounded-full" />
            <span className="min-w-0 flex-1"><span className="block truncate font-medium">{member.displayName}</span><span className="block truncate text-xs text-muted-foreground">@{member.username}</span></span>{/* db-guard:allow:db-name-guard #68 — truncate is a CSS class, not SQL. */}
            {isExactMatch(member, term) && term.length > 0 && <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">{t('imports.member_form_match')}</span>}
            {value?.id === member.id && <Check className="size-4 shrink-0 text-accent" />}
          </button>)}
        </div>
        {search.hasNextPage && <Button type="button" variant="ghost" size="sm" className="w-full" disabled={search.isFetching} onClick={() => void search.fetchNextPage()}>{t('imports.member_load_more')}</Button>}
      </PopoverContent>
    </Popover>
  )
}
