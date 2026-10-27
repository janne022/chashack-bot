import { PageSkeleton } from '@/components/ui/skeleton'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { api, ApiError } from '@/api'
import type { FormConfig, ImportedSignup } from '@/types'
import { useLocale, useT } from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea-label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { SignupQuestion, type Localized } from '@/components/signup-question'
import { MemberCombobox, memberQueryFromUsername, type GuildMemberOption } from '@/components/member-combobox'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Upload, UserRoundSearch, Trash2, UserPlus } from 'lucide-react'

type PreviewRow = { rowNumber: number; values: Record<string, string>; answers: Record<string, string | string[]>; issues: string[]; duplicateStatus: 'create' | 'duplicate' | 'conflict' }
type Member = GuildMemberOption
type AutoLinkSummary = Awaited<ReturnType<typeof api.autoLinkImportedSignups>>
const CORE_FIELDS = ['name', 'email', 'discordUsername', 'allergies', 'experience', 'role', 'skills', 'teamPref', 'participationPreference', 'preferredAreas', 'groupSize', 'groupName', 'members']

/** Server codes an organizer can actually hit while editing or linking a row. */
const ERROR_KEYS: Record<string, string> = {
  event_ended: 'imports.error_event_ended',
  event_not_active: 'imports.error_event_not_active',
  event_not_found: 'imports.error_missing_row',
  import_not_found: 'imports.error_missing_row',
  identity_conflict: 'imports.error_identity_conflict',
  participant_conflict: 'imports.error_participant_conflict',
  registration_blocked: 'imports.error_blocked',
  invalid_answers: 'imports.error_invalid_answers',
  invalid_core_answer: 'imports.error_invalid_core',
  stale_form_version: 'imports.error_stale_form',
  not_guild_member: 'imports.error_not_member',
  invalid_member_id: 'imports.error_invalid_member',
  invalid_edit: 'imports.error_invalid_edit',
  member_search_unavailable: 'imports.member_search_failed',
  member_search_rate_limited: 'imports.member_search_rate_limited',
  discord_unavailable: 'imports.error_discord_unavailable',
}

export function ImportedSignups({ eventId, eventName, form }: { eventId: string; eventName: string; form: FormConfig }) {
  const t = useT()
  const locale = useLocale()
  const [records, setRecords] = useState<ImportedSignup[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [attentionOnly, setAttentionOnly] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [csv, setCsv] = useState('')
  const [headers, setHeaders] = useState<string[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<PreviewRow[]>([])
  const [selectedRow, setSelectedRow] = useState<number | null>(null)
  const [excluded, setExcluded] = useState<number[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState<{ create: number; duplicate: number; conflict: number } | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Record<string, string>>({})
  const [editAnswers, setEditAnswers] = useState<Record<string, string | string[]>>({})
  const [discordUsername, setDiscordUsername] = useState('')
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)
  const [memberError, setMemberError] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[]; label: string } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [templates, setTemplates] = useState<{ id: string; label: { en: string; sv: string }; description: { en: string; sv: string } }[]>([])
  const [templateId, setTemplateId] = useState('')
  const [appliedTemplate, setAppliedTemplate] = useState<string | null>(null)
  const [saveWarnings, setSaveWarnings] = useState<{ row: number; issues: string[] }[]>([])
  const [autoLink, setAutoLink] = useState<AutoLinkSummary | null>(null)
  const [linking, setLinking] = useState(false)

  function describeError(error: unknown, fallback: string) {
    if (error instanceof ApiError) {
      if (error.unauthorized) return t('imports.session_expired')
      if (['access_refused', 'not_allowed', 'forbidden'].includes(error.code)) return t('imports.access_denied')
      if (['csrf', 'bad_origin', 'origin_mismatch'].includes(error.code)) return t('imports.origin_error')
      // Every failure the server can explain has a localized twin here; the
      // server's own message is the last resort, not the first.
      const key = ERROR_KEYS[error.code]
      if (key) return t(key)
      if (error.message && error.message !== 'Request failed') return error.message
    }
    if (error instanceof TypeError) return t('imports.network_error')
    return error instanceof Error ? error.message : t(fallback)
  }

  async function reload() {
    setLoading(true); setLoadError('')
    try { setRecords((await api.importedSignups(eventId)).records) }
    catch (e) { setLoadError(describeError(e, 'imports.load_failed')) }
    finally { setLoading(false) }
  }
  useEffect(() => { void reload() }, [eventId])

  const visibleRecords = useMemo(() => records.filter(record => {
    if (attentionOnly && record.state === 'linked' && record.missingFields.length === 0) return false
    const q = search.trim().toLocaleLowerCase()
    return q === '' || [record.values.name, record.values.email, record.discordUsername, record.discordUserId, record.values.groupName].some(value => value?.toLocaleLowerCase().includes(q))
  }), [records, search, attentionOnly])
  const currentPreview = preview.find(row => row.rowNumber === selectedRow) ?? null
  const activeEdit = records.find(record => record.id === editId) ?? null
  // Only rows the organizer can still see count as selected: a filter must not
  // leave a delete that touches rows hidden from the list.
  const selectedVisible = useMemo(() => visibleRecords.filter(record => selectedIds.includes(record.id)).map(record => record.id), [visibleRecords, selectedIds])

  async function chooseFile(next: File | undefined) {
    setError(''); setPreview([]); setSummary(null); setSelectedRow(null); setExcluded([])
    if (!next) { setFile(null); setCsv(''); return }
    setCsv(''); setFile(null); setHeaders([]); setMapping({})
    if (!/\.csv$/i.test(next.name)) { setError(t('imports.csv_only')); return }
    if (next.size === 0) { setError(t('imports.file_empty')); return }
    if (next.size > 1_000_000) { setError(t('imports.file_too_large')); setFile(null); setCsv(''); return }
    setFile(next)
    try { setCsv(await next.text()) }
    catch { setError(t('imports.file_read_failed')) }
  }

  useEffect(() => {
    if (!importOpen) return
    let active = true
    void api.signupImportTemplates(eventId)
      .then(result => { if (active) setTemplates(result.templates) })
      .catch(() => { if (active) setTemplates([]) })
    return () => { active = false }
  }, [importOpen, eventId])

  async function runPreview(nextMapping = mapping, nextTemplate = templateId) {
    if (!csv || pending) return
    setPending(true); setError('')
    try {
      const result = await api.previewSignupImport(eventId, csv, Object.keys(nextMapping).length ? nextMapping : undefined, nextTemplate || null)
      setHeaders(result.headers); setMapping(result.suggestedMapping); setPreview(result.rows); setSummary(result.summary)
      setAppliedTemplate(result.presetId)
      setSelectedRow(result.rows[0]?.rowNumber ?? null)
    } catch (e) { setError(describeError(e, 'imports.preview_failed')) }
    finally { setPending(false) }
  }

  async function confirmImport() {
    const rows = preview.filter(row => !excluded.includes(row.rowNumber) && row.duplicateStatus !== 'duplicate')
    if (!rows.length || pending) return
    setPending(true); setError(''); setSaveWarnings([])
    try {
      const result = await api.importSignups(eventId, rows.map(row => ({ sourceRow: row.rowNumber, values: row.values, answers: row.answers })))
      toast.success(t('imports.saved_summary', { saved: result.saved, skipped: result.skipped, conflicts: result.conflicts }))
      if (result.autoLink && result.autoLink.linked.length > 0) {
        toast.success(t('imports.auto_link_linked', { count: result.autoLink.linked.length }))
      }
      setSaveWarnings(result.warnings ?? [])
      setImportOpen(false); setFile(null); setCsv(''); setPreview([]); setSummary(null); await reload()
    } catch (e) { setError(describeError(e, 'imports.save_failed')) }
    finally { setPending(false) }
  }

  function openEditor(record: ImportedSignup) {
    setEditId(record.id); setEditValues({ ...record.values }); setEditAnswers({ ...record.answers }); setDiscordUsername(record.discordUsername ?? '')
    setSelectedMember(null); setMemberError('')
  }

  async function runAutoLink() {
    if (linking) return
    setLinking(true); setError(''); setAutoLink(null)
    try {
      const result = await api.autoLinkImportedSignups(eventId)
      setAutoLink(result)
      if (result.linked.length > 0) toast.success(t('imports.auto_link_linked', { count: result.linked.length }))
      else toast.info(t('imports.auto_link_none'))
      await reload()
    } catch (e) { toast.error(describeError(e, 'imports.auto_link_failed')) }
    finally { setLinking(false) }
  }

  async function saveEdit(link = false) {
    if (!activeEdit || pending || (link && !selectedMember)) return
    setPending(true); setMemberError('')
    try {
      const result = await api.updateImportedSignup(eventId, activeEdit.id, {
        values: editValues, answers: editAnswers, discordUsername: discordUsername || null,
        ...(link && selectedMember ? { linkDiscordUserId: selectedMember.id } : {}),
      })
      if (link && selectedMember) {
        if (result.record.discordUserId !== null) {
          toast.success(t('imports.linked_toast', { name: result.record.values.name || selectedMember.displayName }))
        }
        if (result.groupTeam) {
          toast.success(t(result.groupTeam.created ? 'imports.group_team_created' : 'imports.group_team_joined', { team: result.groupTeam.teamName }))
        }
      }
      if (result.warnings && result.warnings.length > 0) toast.warning(t('imports.saved_with_warnings', { count: result.warnings.length }))
      setEditId(null); await reload()
    } catch (e) { setMemberError(describeError(e, 'imports.save_failed')) }
    finally { setPending(false) }
  }

  function toggleSelected(id: string) {
    setSelectedIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id])
  }

  async function confirmDeletion() {
    if (confirmDelete === null || deleting) return
    setDeleting(true)
    try {
      const result = confirmDelete.ids.length === 1
        ? await api.deleteImportedSignup(eventId, confirmDelete.ids[0]!)
        : await api.deleteImportedSignups(eventId, confirmDelete.ids)
      toast.success(t('imports.deleted', { count: result.deleted }))
      setSelectedIds(current => current.filter(id => !confirmDelete.ids.includes(id)))
      setConfirmDelete(null)
      if (editId !== null && confirmDelete.ids.includes(editId)) setEditId(null)
      await reload()
    } catch (e) { toast.error(describeError(e, 'imports.delete_failed')) }
    finally { setDeleting(false) }
  }

  const questionLabel = (label: Localized) => typeof label === 'string' ? label : label[localStorage.getItem('chas-locale') === 'sv' ? 'sv' : 'en'] ?? label.en
  const skillsField = (value: string, onChange: (next: string) => void) => {
    const ids = value.split(',').map(v => v.trim()).filter(Boolean)
    return <fieldset className="space-y-2 rounded-lg border border-border p-3">
      <legend className="px-1 text-xs">{t('imports.map_choices')}</legend>
      {value && <p className="truncate text-xs text-muted-foreground">{t('imports.source_value')}: {value}</p>}
      <div className="grid gap-1 sm:grid-cols-2">
        {form.skills.map(option => <Checkbox
          key={option.id}
          className={cn('min-h-10 w-full rounded-md px-2.5 py-2 text-sm hover:bg-surface-2', ids.includes(option.id) && 'bg-accent/5')}
          checked={ids.includes(option.id)}
          onCheckedChange={checked => onChange(checked ? [...new Set([...ids, option.id])].join(',') : ids.filter(v => v !== option.id).join(','))}
        >{option.label}</Checkbox>)}
      </div>
    </fieldset>
  }
  const selectOptions: Record<string, { id: string; label: string }[]> = {
    experience: form.experiences, role: form.roleTracks, teamPref: form.teamPrefs,
  }
  const fixedLabels: Record<string, string> = {
    name: t('imports.name'), email: t('imports.email'), discordUsername: t('imports.discord_username'), allergies: t('imports.allergies'),
    experience: t('imports.experience'), role: t('imports.role'), skills: t('imports.skills'), teamPref: t('imports.participation'),
    participationPreference: t('imports.participation'), preferredAreas: t('imports.preferred_areas'), groupSize: t('imports.group_size'),
    groupName: t('imports.group_name'), members: t('imports.members'),
  }

  return <section className="space-y-4" aria-label={t('imports.title')}>
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="font-display text-xl">{t('imports.title')}</h2><p className="text-sm text-muted-foreground">{eventName} · {t('imports.organizer_only')}</p></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={linking || records.length === 0} onClick={() => void runAutoLink()} title={t('imports.auto_link_hint')}>
          <UserPlus />{linking ? t('imports.auto_link_running') : t('imports.auto_link_action')}
        </Button>
        <Button onClick={() => { setImportOpen(true); setError('') }}><Upload />{t('imports.action')}</Button>
      </div>
    </header>
    <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">{t('imports.discord_limitation')}</p>
    {autoLink !== null && <div className="space-y-1 rounded-lg border border-border bg-surface-2/50 p-3 text-sm" role="status">
      <p className="font-medium">
        {t('imports.auto_link_summary', {
          linked: autoLink.linked.length,
          ambiguous: autoLink.ambiguous.length,
          missing: autoLink.missing,
          conflicts: autoLink.conflicts.length,
        })}
      </p>
      {autoLink.ambiguous.length > 0 && <p className="text-xs text-muted-foreground">
        {t('imports.auto_link_ambiguous', { names: autoLink.ambiguous.map(row => row.username).join(', ') })}
      </p>}
    </div>}
    {saveWarnings.length > 0 && <div className="space-y-1 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium">{t('imports.saved_with_warnings', { count: saveWarnings.length })}</p>
        <Button variant="ghost" size="sm" onClick={() => setSaveWarnings([])}>{t('common.clear')}</Button>
      </div>
      <ul className="list-disc space-y-1 pl-5 text-xs">
        {saveWarnings.map(warning => <li key={warning.row}>{t('imports.saved_warning_row', { row: warning.row })}: {warning.issues.join(' · ')}</li>)}
      </ul>
    </div>}
    <div className="flex flex-wrap items-center gap-3">
      <div className="min-w-48 flex-1"><Label htmlFor="import-search">{t('common.search')}</Label><Input id="import-search" value={search} onChange={e => setSearch(e.target.value)} /></div>
      <Checkbox className="min-h-10" checked={attentionOnly} onCheckedChange={v => setAttentionOnly(Boolean(v))}>{t('imports.needs_attention')}</Checkbox>
    </div>
    {selectedVisible.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface-2/50 p-3 text-sm">
      <span className="font-medium">{t('imports.selected_count', { count: selectedVisible.length })}</span>
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={() => setSelectedIds([])}>{t('common.clear')}</Button>
        <Button variant="outline" size="sm" onClick={() => setConfirmDelete({ ids: selectedVisible, label: t('imports.delete_selected_count', { count: selectedVisible.length }) })}>
          <Trash2 />{t('common.delete')}
        </Button>
      </div>
    </div>}
    {loading ? <PageSkeleton /> : loadError ? <div role="alert" className="space-y-2"><p>{loadError}</p><Button variant="outline" onClick={() => void reload()}>{t('common.retry')}</Button></div> : records.length === 0 ? <EmptyState icon={<Upload className="size-5" />} title={t('imports.empty')} description={t('imports.empty_desc')} action={<Button onClick={() => setImportOpen(true)}><Upload />{t('imports.action')}</Button>} /> : visibleRecords.length === 0 ? <Card><CardContent className="flex items-center justify-between py-4 text-sm"><span>{t('imports.no_matches')}</span><Button variant="ghost" onClick={() => { setSearch(''); setAttentionOnly(false) }}>{t('common.clear')}</Button></CardContent></Card> : <div className="grid gap-3 md:grid-cols-2">
      {visibleRecords.map(record => {
        const viaForm = record.discordUserId === null && Boolean(record.discordUsername)
        const stateKey = record.state === 'linked' ? 'imports.state_linked' : record.state === 'incomplete' ? 'imports.state_incomplete' : viaForm ? 'imports.state_form' : 'imports.state_unlinked'
        return <Card key={record.id} data-state={viaForm ? 'form' : record.state}>
          <CardHeader className="pb-2">
            <div className="flex items-start gap-2">
              <Checkbox className="mt-0.5" checked={selectedIds.includes(record.id)} onCheckedChange={() => toggleSelected(record.id)} aria-label={t('imports.select_row', { name: record.values.name || t('imports.unnamed') })} />
              <div className="min-w-0 flex-1">
                <CardTitle className="text-base">{record.values.name || t('imports.unnamed')} <span className="text-xs font-normal text-muted-foreground">· {t(stateKey)}</span></CardTitle>
                <CardDescription>{record.values.email || t('imports.no_email')} · {record.values.groupName || t('imports.no_group')}</CardDescription>
              </div>
              <Button variant="ghost" size="sm" className="shrink-0 text-muted-foreground"
                aria-label={t('imports.delete_row', { name: record.values.name || t('imports.unnamed') })}
                onClick={() => setConfirmDelete({ ids: [record.id], label: record.values.name || t('imports.unnamed') })}>
                <Trash2 />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {record.missingFields.length > 0 && <p className="text-warning">{t('imports.missing_fields', { fields: record.missingFields.join(', ') })}</p>}
            {record.discordUserId !== null
              ? <p className="text-muted-foreground">{t('imports.linked_to', { id: record.discordUserId })}</p>
              : viaForm
                ? <p className="text-muted-foreground">{t('imports.linked_via_form', { username: record.discordUsername ?? '' })}</p>
                : <p className="text-muted-foreground">{t('imports.unlinked_detail', { username: t('imports.not_provided') })}</p>}
            {Object.entries(record.values).filter(([key]) => key.startsWith('source:')).map(([key, value]) => <p key={key} className="break-words text-xs text-muted-foreground">{key.slice(7)}: {value}</p>)}
            <Button variant="secondary" onClick={() => openEditor(record)}>{t('imports.review_edit')}</Button>
          </CardContent>
        </Card>
      })}
    </div>}

    <Dialog open={importOpen} onOpenChange={open => { if (!pending) setImportOpen(open) }}>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-[min(64rem,95vw)] sm:max-w-[min(64rem,95vw)] overflow-y-auto">
        <DialogTitle>{t('imports.action')} · {eventName}</DialogTitle>
        <DialogDescription>{t('imports.limits')}</DialogDescription>
        <div className="space-y-4">
          <div className="space-y-2"><Label htmlFor="signup-csv">{t('imports.csv_file')}</Label><Input id="signup-csv" type="file" accept=".csv,text/csv" disabled={pending} onChange={e => void chooseFile(e.currentTarget.files?.[0])} />{file && <p className="text-xs text-muted-foreground">{file.name} · {file.size.toLocaleString()} bytes</p>}</div>
          {templates.length > 0 && <div className="space-y-1">
            <Label htmlFor="import-template">{t('imports.template')}</Label>
            <Select value={templateId || '__auto__'} onValueChange={value => { const next = value === '__auto__' ? '' : value; setTemplateId(next); if (preview.length > 0) void runPreview({}, next) }}>
              <SelectTrigger id="import-template"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto__">{t('imports.template_auto')}</SelectItem>
                {templates.map(tpl => <SelectItem key={tpl.id} value={tpl.id}>{tpl.label[locale]}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('imports.template_help')}</p>
          </div>}
          {!preview.length && <Button disabled={!csv || pending} onClick={() => void runPreview()}>{pending ? t('imports.previewing') : t('imports.preview')}</Button>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {preview.length > 0 && <>
            {appliedTemplate && <p className="text-xs text-muted-foreground">{t('imports.template_applied', { name: templates.find(tpl => tpl.id === appliedTemplate)?.label[locale] ?? appliedTemplate })}</p>}
            <p className="rounded-lg border p-3 text-sm">{t('imports.summary', { create: summary?.create ?? 0, duplicate: summary?.duplicate ?? 0, conflict: summary?.conflict ?? 0 })}</p>
            <div className="space-y-2"><h3 className="font-medium">{t('imports.map_columns')}</h3><div className="grid gap-2 sm:grid-cols-2">{headers.map(header => <div key={header} className="grid min-w-0 grid-cols-1 items-start gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-2"><Label htmlFor={`map-${header}`} className="min-w-0 whitespace-normal break-words">{header}</Label><Select value={mapping[header] || '__source__'} onValueChange={value => setMapping(current => ({ ...current, [header]: value === '__source__' ? '' : value }))}><SelectTrigger id={`map-${header}`} aria-label={`${t('imports.map')} ${header}`} className="w-full min-w-0 [&>span]:min-w-0 [&>span]:overflow-hidden [&>span]:text-ellipsis [&>span]:whitespace-nowrap"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__source__">{t('imports.keep_source')}</SelectItem>{CORE_FIELDS.map(key => <SelectItem key={key} value={key}>{fixedLabels[key]}</SelectItem>)}{form.customQuestions?.filter(q => q.visibility !== 'organizer_only').map(q => <SelectItem key={q.id} value={q.id}>{questionLabel(q.label)}</SelectItem>)}</SelectContent></Select></div>)}</div><Button variant="outline" disabled={pending} onClick={() => void runPreview(mapping)}>{t('imports.apply_mapping')}</Button></div>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,0.85fr)]">
              <div className="max-h-[30vh] overflow-auto rounded-lg border sm:max-h-[65vh]" role="list" aria-label={t('imports.rows')}>
                {preview.map(row => <div key={row.rowNumber} role="listitem" className="flex items-start gap-2 border-b p-2 last:border-0"><Checkbox checked={!excluded.includes(row.rowNumber)} aria-label={t('imports.include_row', { row: row.rowNumber })} onCheckedChange={checked => setExcluded(rows => checked ? rows.filter(n => n !== row.rowNumber) : [...rows, row.rowNumber])} /><button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelectedRow(row.rowNumber)} aria-pressed={selectedRow === row.rowNumber}><span className="font-medium">{row.rowNumber}. {row.values.name || t('imports.unnamed')}</span><span className="ml-2 text-xs text-muted-foreground">{t(`imports.duplicate_${row.duplicateStatus}`)}</span>{row.issues.length > 0 && <span className="block text-xs text-warning">{row.issues.join(' · ')}</span>}</button></div>)}
              </div>
              {currentPreview && <div className="max-h-none space-y-2 overflow-visible rounded-lg border p-3 sm:max-h-[65vh] sm:overflow-auto"><h3 className="font-medium">{t('imports.edit_row', { row: currentPreview.rowNumber })}</h3>{Object.entries(currentPreview.values).filter(([key]) => !key.startsWith('source:')).map(([key, value]) => <div key={key} className="space-y-1"><Label htmlFor={`row-${key}`}>{fixedLabels[key] ?? key}</Label>{key === 'skills' ? skillsField(value, next => setPreview(rows => rows.map(row => row.rowNumber === currentPreview.rowNumber ? { ...row, values: { ...row.values, skills: next } } : row))) : selectOptions[key] ? <Select value={value || '__empty__'} onValueChange={next => setPreview(rows => rows.map(row => row.rowNumber === currentPreview.rowNumber ? { ...row, values: { ...row.values, [key]: next === '__empty__' ? '' : next } } : row))}><SelectTrigger id={`row-${key}`}><SelectValue placeholder={t('participant.signup_choose')} /></SelectTrigger><SelectContent><SelectItem value="__empty__">{t('participant.signup_choose')}</SelectItem>{selectOptions[key]!.map(option => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent></Select> : <Input id={`row-${key}`} value={value} onChange={e => setPreview(rows => rows.map(row => row.rowNumber === currentPreview.rowNumber ? { ...row, values: { ...row.values, [key]: e.target.value } } : row))} />}</div>)}{form.customQuestions?.filter(question => question.visibility !== 'organizer_only').map(question => <SignupQuestion key={question.id} question={question} answer={currentPreview.answers[question.id]} invalid={false} label={questionLabel} onChange={value => setPreview(rows => rows.map(row => row.rowNumber === currentPreview.rowNumber ? { ...row, answers: { ...row.answers, [question.id]: value } } : row))} t={t} />)}{Object.entries(currentPreview.values).filter(([key]) => key.startsWith('source:')).map(([key, value]) => <div key={key} className="space-y-1"><Label htmlFor={`source-${key}`}>{t('imports.unmapped_answer', { header: key.slice(7) })}</Label><Textarea id={`source-${key}`} value={value} onChange={e => setPreview(rows => rows.map(row => row.rowNumber === currentPreview.rowNumber ? { ...row, values: { ...row.values, [key]: e.target.value } } : row))} /></div>)}</div>}
            </div>
            <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={pending} onClick={() => { setImportOpen(false); setPreview([]); setCsv(''); setFile(null) }}>{t('common.cancel')}</Button><Button disabled={pending || preview.every(row => excluded.includes(row.rowNumber) || row.duplicateStatus === 'duplicate')} onClick={() => void confirmImport()}>{pending ? t('imports.saving') : t('imports.confirm')}</Button></div>
          </>}
        </div>
      </DialogContent>
    </Dialog>

    <Dialog open={activeEdit !== null} onOpenChange={open => { if (!open && !pending) setEditId(null) }}>
      {activeEdit && <DialogContent className="max-h-[90vh] w-[95vw] max-w-[min(42rem,95vw)] sm:max-w-[min(42rem,95vw)] overflow-y-auto"><DialogTitle>{t('imports.edit_title', { name: activeEdit.values.name || t('imports.unnamed') })} · {eventName}</DialogTitle><DialogDescription>{t('imports.edit_desc')}</DialogDescription><div className="space-y-3">
        {CORE_FIELDS.filter(key => Object.hasOwn(editValues, key) || ['name', 'email', 'discordUsername'].includes(key)).map(key => <div key={key} className="space-y-1"><Label htmlFor={`saved-${key}`}>{fixedLabels[key]}</Label>{key === 'skills' ? skillsField(editValues.skills ?? '', next => setEditValues(values => ({ ...values, skills: next }))) : selectOptions[key] ? <Select value={editValues[key] || '__empty__'} onValueChange={value => setEditValues(values => ({ ...values, [key]: value === '__empty__' ? '' : value }))}><SelectTrigger id={`saved-${key}`}><SelectValue placeholder={t('participant.signup_choose')} /></SelectTrigger><SelectContent><SelectItem value="__empty__">{t('participant.signup_choose')}</SelectItem>{selectOptions[key]!.map(option => <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>)}</SelectContent></Select> : <Input id={`saved-${key}`} value={key === 'discordUsername' ? discordUsername : editValues[key] ?? ''} onChange={e => key === 'discordUsername' ? setDiscordUsername(e.target.value) : setEditValues(values => ({ ...values, [key]: e.target.value }))} />}</div>)}
        {form.customQuestions?.filter(question => question.visibility !== 'organizer_only').map(question => <SignupQuestion key={question.id} question={question} answer={editAnswers[question.id]} invalid={false} label={questionLabel} onChange={value => setEditAnswers(answers => ({ ...answers, [question.id]: value }))} t={t} />)}
        <div className="space-y-2 rounded-lg border border-border p-3"><h3 className="font-medium"><UserRoundSearch className="mr-1 inline size-4" />{t('imports.link_member')}</h3><p className="text-xs text-muted-foreground">{activeEdit.discordUserId ? t('imports.relink_explanation') : t('imports.link_explanation')}</p>
          {activeEdit.discordUserId && <p className="rounded-lg border border-ok/40 p-2 text-xs">{t('imports.linked_to', { id: activeEdit.discordUserId })}</p>}
          <MemberCombobox value={selectedMember} onSelect={setSelectedMember} initialQuery={memberQueryFromUsername(discordUsername || activeEdit.discordUsername)} disabled={pending} />
          {discordUsername && <p className="text-xs text-muted-foreground">{t('imports.link_using_form', { username: discordUsername })}</p>}
          {editValues.groupName && <p className="text-xs text-muted-foreground">{t('imports.link_group_hint', { group: editValues.groupName })}</p>}
        </div>
        {memberError && <p role="alert" className="text-sm text-destructive">{memberError}</p>}
        <p className="text-xs text-muted-foreground">{t('imports.link_eligibility')}</p>
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={pending} onClick={() => setEditId(null)}>{t('common.cancel')}</Button><Button variant="secondary" disabled={pending} onClick={() => void saveEdit()}>{pending ? t('imports.saving') : t('imports.save')}</Button><Button disabled={pending || !selectedMember} onClick={() => void saveEdit(true)}>{t('imports.save_and_link')}</Button></div>
      </div></DialogContent>}
    </Dialog>

    <AlertDialog open={confirmDelete !== null} onOpenChange={open => { if (!open && !deleting) setConfirmDelete(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('imports.delete_title')}</AlertDialogTitle>
          <AlertDialogDescription>{t('imports.delete_desc', { label: confirmDelete?.label ?? '' })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction disabled={deleting} onClick={event => { event.preventDefault(); void confirmDeletion() }}>{deleting ? t('imports.deleting') : t('common.delete')}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </section>
}
