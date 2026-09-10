import { useEffect, useState } from 'react'
import { useSearch } from '@tanstack/react-router'
import { Users, UsersRound, Sparkles } from 'lucide-react'
import { useAppContext } from '@/lib/app-context'
import { useT } from '@/lib/i18n'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ParticipantsPanel } from '@/views/panels/ParticipantsPanel'
import { TeamsPanel } from '@/views/panels/TeamsPanel'
import { MatchingPanel } from '@/views/panels/MatchingPanel'

type Tab = 'participants' | 'teams' | 'matching'

export function OperatePage() {
  const { state, refresh } = useAppContext()
  const t = useT()
  const search = useSearch({ from: '/operations' }) as { tab?: Tab }
  const initial: Tab = search?.tab && ['participants', 'teams', 'matching'].includes(search.tab) ? search.tab : 'participants'
  const [tab, setTab] = useState<Tab>(initial)

  useEffect(() => {
    if (search?.tab && ['participants', 'teams', 'matching'].includes(search.tab)) setTab(search.tab as Tab)
  }, [search])

  const counts = {
    participants: state.participants.length,
    teams: state.teams.length,
    matching: state.stats.matchingOptIn,
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-2xl">{t('operate.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('operate.subtitle')}</p>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="w-full justify-start">
          <TabsTrigger value="participants" className="gap-1.5">
            <Users className="size-4" />
            {t('nav.participants')}
            <span className="ml-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">{counts.participants}</span>
          </TabsTrigger>
          <TabsTrigger value="teams" className="gap-1.5">
            <UsersRound className="size-4" />
            {t('nav.teams')}
            <span className="ml-1 rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">{counts.teams}</span>
          </TabsTrigger>
          <TabsTrigger value="matching" className="gap-1.5">
            <Sparkles className="size-4" />
            {t('nav.matching')}
            {counts.matching > 0 && <span className="ml-1 rounded-md bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent">{counts.matching}</span>}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="participants" className="mt-4">
          <ParticipantsPanel state={state} refresh={refresh} />
        </TabsContent>
        <TabsContent value="teams" className="mt-4">
          <TeamsPanel state={state} refresh={refresh} />
        </TabsContent>
        <TabsContent value="matching" className="mt-4">
          <MatchingPanel state={state} refresh={refresh} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
