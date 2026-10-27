import { PageSkeleton } from '@/components/ui/skeleton'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
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
import { Upload, UserRoundSearch } from 'lucide-react'

type PreviewRow = { rowNumber: number; values: Record<string, string>; answers: Record<string, string | string[]>; issues: string[]; duplicateStatus: 'create' | 'duplicate' | 'conflict' }
type Member = { id: string; username: string; displayName: string }
const CORE_FIELDS = ['name', 'email', 'discordUsername', 'allergies', 'experience', 'role', 'skills', 'teamPref', 'participationPreference', 'preferredAreas', 'groupSize', 'groupName', 'members']

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
  const [memberQuery, setMemberQuery] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const [selectedMember, setSelectedMember] = useState<Member | null>(null)
  const [memberBusy, setMemberBusy] = useState(false)
  const [memberError, setMemberError] = useState('')
  const [templates, setTemplates] = useState<{ id: string; label: { en: string; sv: string }; description: { en: string; sv: string } }[]>([])
  const [templateId, setTemplateId] = useState('')
  const [appliedTemplate, setAppliedTemplate] = useState<string | null>(null)
  const [saveWarnings, setSaveWarnings] = useState<{ row: number; issues: string[] }[]>([])

  function describeError(error: unknown, fallback: string) {
    if (error instanceof ApiError) {
      if (error.unauthorized) return t('imports.session_expired')
      if (['access_refused', 'not_allowed', 'forbidden'].includes(error.code)) return t('imports.access_denied')
      if (['csrf', 'bad_origin', 'origin_mismatch'].includes(error.code)) return t('imports.origin_error')
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
      setSaveWarnings(result.warnings ?? [])
      setImportOpen(false); setFile(null); setCsv(''); setPreview([]); setSummary(null); await reload()
    } catch (e) { setError(describeError(e, 'imports.save_failed')) }
    finally { setPending(false) }
  }

  function openEditor(record: ImportedSignup) {
    setEditId(record.id); setEditValues({ ...record.values }); setEditAnswers({ ...record.answers }); setDiscordUsername(record.discordUsername ?? '')
    setMemberQuery(''); setMembers([]); setSelectedMember(null); setMemberError('')
  }

  async function searchMembers() {
    setMemberBusy(true); setMemberError(''); setSelectedMember(null)
    try { setMembers((await api.searchGuildMembers(memberQuery)).members) }
    catch (e) { setMembers([]); setMemberError(describeError(e, 'imports.member_search_failed')) }
    finally { setMemberBusy(false) }
  }

  async function saveEdit(link = false) {
    if (!activeEdit || pending || (link && !selectedMember)) return
    setPending(true); setMemberError('')
    try {
      await api.updateImportedSignup(eventId, activeEdit.id, {
        values: editValues, answers: editAnswers, discordUsername: discordUsername || null,
        ...(link && selectedMember ? { linkDiscordUserId: selectedMember.id } : {}),
      })
      setEditId(null); await reload()
    } catch (e) { setMemberError(describeError(e, 'imports.save_failed')) }
    finally { setPending(false) }
  }

  const questionLabel = (label: Localized) => typeof label === 'string' ? label : label[localStorage.getItem('chas-locale') === 'sv' ? 'sv' : 'en'] ?? label.en
  const skillsField = (value: string, onChange: (next: string) => void) => <fieldset className="space-y-1 rounded border p-2"><legend className="px-1 text-xs">{t('imports.map_choices')}</legend>{value && <p className="text-xs text-muted-foreground">{t('imports.source_value')}: {value}</p>}{form.skills.map(option => <Checkbox key={option.id} className="min-h-9" checked={value.split(',').map(v => v.trim()).includes(option.id)} onCheckedChange={checked => { const ids = value.split(',').map(v => v.trim()).filter(Boolean); onChange(checked ? [...new Set([...ids, option.id])].join(',') : ids.filter(v => v !== option.id).join(',')) }}>{option.label}</Checkbox>)}</fieldset>
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
      <Button onClick={() => { setImportOpen(true); setError('') }}><Upload />{t('imports.action')}</Button>
    </header>
    <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">{t('imports.discord_limitation')}</p>
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
    {loading ? <PageSkeleton /> : loadError ? <div role="alert" className="space-y-2"><p>{loadError}</p><Button variant="outline" onClick={() => void reload()}>{t('common.retry')}</Button></div> : records.length === 0 ? <EmptyState icon={<Upload className="size-5" />} title={t('imports.empty')} description={t('imports.empty_desc')} action={<Button onClick={() => setImportOpen(true)}><Upload />{t('imports.action')}</Button>} /> : visibleRecords.length === 0 ? <Card><CardContent className="flex items-center justify-between py-4 text-sm"><span>{t('imports.no_matches')}</span><Button variant="ghost" onClick={() => { setSearch(''); setAttentionOnly(false) }}>{t('common.clear')}</Button></CardContent></Card> : <div className="grid gap-3 md:grid-cols-2">
      {visibleRecords.map(record => <Card key={record.id}>
        <CardHeader className="pb-2"><CardTitle className="text-base">{record.values.name || t('imports.unnamed')} <span className="text-xs font-normal text-muted-foreground">· {t(`imports.state_${record.state}`)}</span></CardTitle><CardDescription>{record.values.email || t('imports.no_email')} · {record.values.groupName || t('imports.no_group')}</CardDescription></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {record.missingFields.length > 0 && <p className="text-warning">{t('imports.missing_fields', { fields: record.missingFields.join(', ') })}</p>}
          {!record.discordUserId && <p className="text-muted-foreground">{t('imports.unlinked_detail', { username: record.discordUsername || t('imports.not_provided') })}</p>}
          {Object.entries(record.values).filter(([key]) => key.startsWith('source:')).map(([key, value]) => <p key={key} className="break-words text-xs text-muted-foreground">{key.slice(7)}: {value}</p>)}
          <Button variant="secondary" onClick={() => openEditor(record)}>{t('imports.review_edit')}</Button>
        </CardContent>
      </Card>)}
    </div>}

    <Dialog open={importOpen} onOpenChange={open => { if (!pending) setImportOpen(open) }}>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-[min(64rem,95vw)] sm:max-w-[min(64rem,95vw)] overflow-y-auto">
        <DialogTitle>{t('imports.action')} · {eventName}</DialogTitle>
        <DialogDescription>{t('imports.limits')}</DialogDescription>
        <div className="space-y-4">
          <div className="space-y-2"><Label htmlFor="signup-csv">{t('imports.csv_file')}</Label><Input id="signup-csv" type="file" accept=".csv,text/csv" disabled={pending} onChange={e => void chooseFile(e.currentTarget.files?.[0])} />{file && <p className="text-xs text-muted-foreground">{file.name} · {file.size.toLocaleString()} bytes</p>}</div>
          {templates.length > 0 && <div className="space-y-1">
            <Label htmlFor="import-template">{t('imports.template')}</Label>
            <Select value={templateId || '__auto__'} onValueChange={value => { const next = value === '__auto__' ? '' : value; setTemplateId(next); if (preview.length > 0) void runPreview(mapping, next) }}>
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
        {activeEdit.discordUserId ? <p className="rounded-lg border border-ok/40 p-3 text-sm">{t('imports.linked_to', { id: activeEdit.discordUserId })}</p> : <div className="space-y-2 rounded-lg border p-3"><h3 className="font-medium"><UserRoundSearch className="mr-1 inline size-4" />{t('imports.link_member')}</h3><p className="text-xs text-muted-foreground">{t('imports.link_explanation')}</p><div className="flex gap-2"><Input aria-label={t('imports.member_search')} minLength={2} maxLength={100} value={memberQuery} onChange={e => setMemberQuery(e.target.value)} /><Button variant="outline" disabled={memberBusy || memberQuery.trim().length < 2} onClick={() => void searchMembers()}>{memberBusy ? t('imports.searching') : t('common.search')}</Button></div>{members.map(member => <Button key={member.id} type="button" variant={selectedMember?.id === member.id ? 'secondary' : 'outline'} aria-pressed={selectedMember?.id === member.id} className="w-full justify-start" onClick={() => setSelectedMember(member)}>{member.displayName} <span className="text-muted-foreground">@{member.username}</span></Button>)}</div>}
        {memberError && <p role="alert" className="text-sm text-destructive">{memberError}</p>}
        <p className="text-xs text-muted-foreground">{t('imports.link_eligibility')}</p>
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" disabled={pending} onClick={() => setEditId(null)}>{t('common.cancel')}</Button><Button variant="secondary" disabled={pending} onClick={() => void saveEdit()}>{pending ? t('imports.saving') : t('imports.save')}</Button>{!activeEdit.discordUserId && <Button disabled={pending || !selectedMember} onClick={() => void saveEdit(true)}>{t('imports.save_and_link')}</Button>}</div>
      </div></DialogContent>}
    </Dialog>
  </section>
}
