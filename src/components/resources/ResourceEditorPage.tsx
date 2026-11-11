import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { Badge, GhostButton, PrimaryButton, Skeleton } from '../../roles/primary-admin/shell/ui'
import { Icon } from '../../roles/primary-admin/shell/Icon'
import { AUDIENCE_LABELS, FileAttachControl, Segmented, ToggleSwitch, toggleLabel } from '../../roles/primary-admin/shell/VideoShared'
import { FileKindTile, resourceScopeLabel } from './ResourceShared'
import {
  ALL_DEPARTMENTS,
  ALL_YEARS,
  MAX_RESOURCE_BYTES,
  RESOURCE_ACCEPT,
  RESOURCE_KIND_LABELS,
  deleteResourceFile,
  formatBytes,
  isResourceActive,
  newResourceId,
  resourceFileType,
  saveResource,
  updateResource,
  uploadResourceFile,
  watchResource,
} from '../../lib/firestore/resources'
import { watchCatalogDepartments, watchInstitutionDepartments, watchInstitutionDepartmentOverrides } from '../../lib/firestore/departments'
import { watchInstitutions } from '../../lib/firestore/institutions'
import { MBBS_YEARS } from '../../lib/academicStructure'
import type { Department, Institution, InstitutionDepartmentOverride, MbbsYear, Resource, VideoAudience } from '../../types'

type ShellProps = { eyebrow?: string; title: string; actions?: ReactNode; children: ReactNode }

const BORDER = 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)'
const CARD_STYLE = { backgroundColor: 'var(--color-paper)', borderColor: BORDER }
const LABEL = 'font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]'
const INPUT = 'w-full h-10 px-3 text-[13.5px] rounded-[6px] border bg-transparent'
const INPUT_STYLE = { borderColor: 'var(--color-line)', color: 'var(--color-char)' }

function StepHeader({ step, title, hint }: { step: string; title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-3 flex-wrap mb-3">
      <span className="font-mono text-[11px] tracking-[0.14em] uppercase shrink-0" style={{ color: 'var(--color-gold)' }}>
        Step {step}
      </span>
      <h2 className="font-display text-[19px]" style={{ color: 'var(--color-char)' }}>
        {title}
      </h2>
      {hint && (
        <span className="text-[12.5px]" style={{ color: 'var(--color-char-soft)' }}>
          {hint}
        </span>
      )}
    </div>
  )
}

function Label({ children }: { children: ReactNode }) {
  return (
    <span className={LABEL} style={{ color: 'var(--color-char-soft)' }}>
      {children}
    </span>
  )
}

function Choice({ selected, onClick, title, hint }: { selected: boolean; onClick: () => void; title: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-[8px] border px-4 py-3 transition-colors flex items-start gap-3"
      style={{
        borderColor: selected ? 'var(--color-gold)' : 'var(--color-line)',
        backgroundColor: selected ? 'color-mix(in srgb, var(--color-gold) 8%, transparent)' : 'transparent',
      }}
    >
      <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border flex items-center justify-center" style={{ borderColor: selected ? 'var(--color-gold)' : 'var(--color-line)' }}>
        {selected && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--color-gold)' }} />}
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium" style={{ color: 'var(--color-char)' }}>
          {title}
        </span>
        <span className="block text-[12px] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
          {hint}
        </span>
      </span>
    </button>
  )
}

// Create/edit a resource (one uploaded file). Shared by Primary Admin
// (`lockedInstitutionId` undefined: publishes to every college, or to one
// college it picks) and Institution Admin (locked to their own college).
// Edit mode is driven by a `:resourceId` route param.
export function ResourceEditorPage({
  Shell,
  lockedInstitutionId,
  backTo,
  backLabel,
}: {
  Shell: ComponentType<ShellProps>
  lockedInstitutionId?: string
  backTo: string
  backLabel: string
}) {
  const { appUser } = useAuth()
  const navigate = useNavigate()
  const { resourceId } = useParams<{ resourceId: string }>()
  const isEditing = !!resourceId
  const isPrimary = lockedInstitutionId === undefined

  const [existing, setExisting] = useState<Resource | null | undefined>(undefined)
  useEffect(() => {
    if (!resourceId) return
    return watchResource(resourceId, setExisting)
  }, [resourceId])

  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState<'all' | 'one'>(isPrimary ? 'all' : 'one')
  const [collegeId, setCollegeId] = useState(lockedInstitutionId ?? '')
  const [audience, setAudience] = useState<VideoAudience>('student')
  const [mbbsYear, setMbbsYear] = useState<MbbsYear | 0>(ALL_YEARS)
  const [reach, setReach] = useState<'all' | 'one'>('all')
  const [department, setDepartment] = useState('')
  const [active, setActive] = useState(true)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (loaded || !existing) return
    setTitle(existing.title)
    setDescription(existing.description)
    setScope(existing.institutionId ? 'one' : 'all')
    setCollegeId(existing.institutionId || lockedInstitutionId || '')
    setAudience(existing.audience)
    setMbbsYear(existing.mbbsYear ?? ALL_YEARS)
    setReach(existing.department === ALL_DEPARTMENTS ? 'all' : 'one')
    setDepartment(existing.department)
    setActive(isResourceActive(existing))
    setLoaded(true)
  }, [existing, loaded, lockedInstitutionId])

  // An Institution Admin can only open their own college's resources here.
  const foreign = !isPrimary && !!existing && existing.institutionId !== lockedInstitutionId

  const [institutions, setInstitutions] = useState<Institution[]>([])
  useEffect(() => {
    if (!isPrimary) return
    return watchInstitutions((list) => setInstitutions([...list].sort((a, b) => a.name.localeCompare(b.name))))
  }, [isPrimary])
  const targetCollege = scope === 'one' ? collegeId : ''

  // Departments that can be targeted: the catalog, plus the chosen college's
  // own (minus anything switched off there). Students: only departments of
  // the chosen year (or of any year when "All years").
  const [catalogDepts, setCatalogDepts] = useState<Department[]>([])
  const [ownDepts, setOwnDepts] = useState<Department[]>([])
  const [deptOverrides, setDeptOverrides] = useState<InstitutionDepartmentOverride[]>([])
  useEffect(() => watchCatalogDepartments(setCatalogDepts), [])
  useEffect(() => {
    setOwnDepts([])
    setDeptOverrides([])
    if (!targetCollege) return
    const a = watchInstitutionDepartments(targetCollege, setOwnDepts)
    const b = watchInstitutionDepartmentOverrides(targetCollege, setDeptOverrides)
    return () => {
      a()
      b()
    }
  }, [targetCollege])
  const departmentOptions = useMemo(() => {
    const off = new Set(deptOverrides.filter((o) => !o.enabled).map((o) => o.departmentId))
    const pool = [...catalogDepts, ...ownDepts].filter((d) => !off.has(d.id))
    const names = new Set(pool.filter((d) => audience === 'faculty' || mbbsYear === ALL_YEARS || d.mbbsYear === mbbsYear).map((d) => d.name))
    if (department) names.add(department)
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [catalogDepts, ownDepts, deptOverrides, audience, mbbsYear, department])

  const [fileError, setFileError] = useState('')
  function pickFile(f: File | null) {
    setFileError('')
    if (f && !resourceFileType(f.name)) {
      setFileError('That file type isn’t supported. Use PDF, Word, PowerPoint, Excel, PNG or JPEG.')
      return
    }
    if (f && f.size > MAX_RESOURCE_BYTES) {
      setFileError(`That file is ${formatBytes(f.size)} — the limit is ${formatBytes(MAX_RESOURCE_BYTES)}.`)
      return
    }
    setFile(f)
    if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim())
  }

  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState(0)
  const [formError, setFormError] = useState('')

  const missing: string[] = []
  if (!isEditing && !file) missing.push('a file')
  if (!title.trim()) missing.push('a title')
  if (scope === 'one' && !collegeId) missing.push('a college')
  if (reach === 'one' && !department) missing.push('a department')
  const canSave = missing.length === 0 && !saving

  async function handleSave() {
    if (!canSave || !appUser) return
    setSaving(true)
    setProgress(0)
    setFormError('')
    const id = existing?.id ?? newResourceId()
    let uploadedPath: string | null = null
    try {
      const fileFields = file ? await uploadResourceFile(id, file, setProgress) : null
      uploadedPath = fileFields?.storagePath ?? null
      const common = {
        title: title.trim(),
        description: description.trim(),
        institutionId: targetCollege,
        audience,
        mbbsYear: audience === 'student' ? mbbsYear : ALL_YEARS,
        department: reach === 'all' ? ALL_DEPARTMENTS : department,
        active,
      }
      if (isEditing && existing) {
        await updateResource(id, { ...common, ...(fileFields ?? {}) })
        // The old file goes only once the doc points at the new one.
        if (fileFields) await deleteResourceFile(existing.storagePath)
      } else if (fileFields) {
        const now = Date.now()
        await saveResource(id, { ...common, ...fileFields, createdBy: appUser.uid, createdAt: now, updatedAt: now })
      }
      navigate(backTo)
    } catch (e) {
      console.error('Saving resource failed', e)
      if (uploadedPath) await deleteResourceFile(uploadedPath)
      setSaving(false)
      setFormError('Saving failed — check your connection and try again.')
    }
  }

  const pageLoading = isEditing && (existing === undefined || (existing !== null && !loaded))
  const notFound = isEditing && (existing === null || foreign)
  const kind = file ? resourceFileType(file.name)?.kind : existing?.kind
  const shownSize = file ? file.size : existing?.size
  const collegeName = scope === 'one' ? (isPrimary ? institutions.find((i) => i.id === collegeId)?.name : 'Your college') : null
  const who = !active
    ? 'Nobody while it’s disabled.'
    : `${audience === 'student' ? (mbbsYear ? `Year ${mbbsYear} students` : 'Students of every year') : 'Faculty and HODs'}${
        reach === 'one' ? (department ? ` with ${department}` : ' of one department') : ''
      } ${scope === 'all' ? 'at every college that has it switched on' : collegeName ? `at ${collegeName}` : 'at one college'}.`

  return (
    <Shell
      eyebrow="Content · Resources"
      title={isEditing ? 'Edit resource' : 'New resource'}
      actions={
        !pageLoading && !notFound ? (
          <div className="flex items-center gap-2">
            <GhostButton onClick={() => navigate(backTo)}>Cancel</GhostButton>
            <PrimaryButton onClick={handleSave} disabled={!canSave}>
              {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Publish resource'}
            </PrimaryButton>
          </div>
        ) : undefined
      }
    >
      <div className="max-w-[1080px] mx-auto">
        <button
          onClick={() => navigate(backTo)}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium mb-5 hover:opacity-70 transition-opacity"
          style={{ color: 'var(--color-char-soft)' }}
        >
          <Icon name="chevron" className="h-3 w-3 rotate-180" />
          {backLabel}
        </button>

        {pageLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-40" />
          </div>
        ) : notFound ? (
          <div className="rounded-[10px] border p-5" style={CARD_STYLE}>
            <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
              This resource doesn't exist or you don't have access to it.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-8 items-start">
            <div className="min-w-0">
              <StepHeader step="01" title="The file" hint="PDF, Word, PowerPoint, Excel, PNG or JPEG, up to 50 MB." />
              <div className="rounded-[10px] border p-5 mb-9" style={CARD_STYLE}>
                <div className="mb-5">
                  <Label>{isEditing ? 'Replace file (optional)' : 'File'}</Label>
                  {isEditing && existing && !file && (
                    <div className="flex items-center gap-3 mb-2.5 px-3 py-2.5 rounded-[8px] border" style={{ borderColor: 'var(--color-line)' }}>
                      <FileKindTile kind={existing.kind} size={28} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12.5px] truncate" style={{ color: 'var(--color-char)' }}>
                          {existing.fileName}
                        </span>
                        <span className="block font-mono text-[11px]" style={{ color: 'var(--color-char-soft)' }}>
                          {formatBytes(existing.size)} · current file
                        </span>
                      </span>
                    </div>
                  )}
                  <FileAttachControl accept={RESOURCE_ACCEPT} file={file} onChange={pickFile} label={isEditing ? 'Choose a new file' : 'Choose a file'} hint="PDF · DOC/DOCX · PPT/PPTX · XLS/XLSX · PNG · JPEG" />
                  {fileError && (
                    <p className="mt-1.5 text-[12px]" style={{ color: 'var(--color-clay)' }}>
                      {fileError}
                    </p>
                  )}
                  {saving && file && (
                    <div className="mt-2">
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-line)' }}>
                        <div className="h-full transition-all duration-200" style={{ width: `${Math.round(progress * 100)}%`, backgroundColor: 'var(--color-gold)' }} />
                      </div>
                      <p className="mt-1 text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
                        Uploading… {Math.round(progress * 100)}%
                      </p>
                    </div>
                  )}
                </div>
                <div className="mb-5">
                  <Label>Title</Label>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Basic Life Support — Handout" className={INPUT} style={INPUT_STYLE} />
                </div>
                <div>
                  <Label>Description (optional)</Label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    placeholder="What's in this file and when to use it"
                    className="w-full px-3 py-2 text-[13.5px] rounded-[6px] border bg-transparent resize-none"
                    style={INPUT_STYLE}
                  />
                </div>
              </div>

              <StepHeader step="02" title="Who it's for" />
              <div className="rounded-[10px] border p-5 mb-9" style={CARD_STYLE}>
                {isPrimary && (
                  <div className="mb-6">
                    <Label>Colleges</Label>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <Choice selected={scope === 'all'} onClick={() => setScope('all')} title="All colleges" hint="Shared catalog — each college can switch it off for itself" />
                      <Choice selected={scope === 'one'} onClick={() => setScope('one')} title="One college" hint="Only that college’s students or staff see it" />
                    </div>
                    {scope === 'one' && (
                      <select
                        value={collegeId}
                        onChange={(e) => {
                          setCollegeId(e.target.value)
                          setDepartment('')
                        }}
                        className={`${INPUT} mt-3`}
                        style={{ ...INPUT_STYLE, color: collegeId ? 'var(--color-char)' : 'var(--color-char-soft)' }}
                      >
                        <option value="" disabled>
                          Select a college
                        </option>
                        {institutions.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-5">
                  <div>
                    <Label>Audience</Label>
                    <Segmented
                      value={audience}
                      onChange={(a) => {
                        setAudience(a)
                        setDepartment('')
                      }}
                      options={(['student', 'faculty'] as VideoAudience[]).map((a) => ({ v: a, label: AUDIENCE_LABELS[a] }))}
                    />
                  </div>
                  {audience === 'student' ? (
                    <div>
                      <Label>MBBS year</Label>
                      <select
                        value={mbbsYear}
                        onChange={(e) => {
                          setMbbsYear(Number(e.target.value) as MbbsYear | 0)
                          setDepartment('')
                        }}
                        className={INPUT}
                        style={INPUT_STYLE}
                      >
                        <option value={ALL_YEARS}>All years</option>
                        {MBBS_YEARS.map((y) => (
                          <option key={y} value={y}>
                            Year {y}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="text-[12px] leading-relaxed sm:pt-6" style={{ color: 'var(--color-char-soft)' }}>
                      Faculty resources aren't tied to a year.
                    </div>
                  )}
                </div>

                <Label>Departments</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Choice selected={reach === 'all'} onClick={() => setReach('all')} title="All departments" hint="Everyone in the audience above" />
                  <Choice selected={reach === 'one'} onClick={() => setReach('one')} title="One department" hint={audience === 'student' ? 'Only students who have that department' : 'Only that department’s faculty and HOD'} />
                </div>
                {reach === 'one' && (
                  <div className="mt-4">
                    <select value={department} onChange={(e) => setDepartment(e.target.value)} className={INPUT} style={{ ...INPUT_STYLE, color: department ? 'var(--color-char)' : 'var(--color-char-soft)' }}>
                      <option value="" disabled>
                        Select a department
                      </option>
                      {departmentOptions.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                    {departmentOptions.length === 0 && (
                      <p className="mt-1.5 text-[12px]" style={{ color: 'var(--color-clay)' }}>
                        No departments to choose from yet — publish to all departments instead.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <StepHeader step="03" title="Visibility" hint="Turn it off any time without deleting it." />
              <div className="rounded-[10px] border p-5 mb-9 flex items-center justify-between gap-4" style={CARD_STYLE}>
                <div className="min-w-0">
                  <div className="font-display text-[16px]" style={{ color: 'var(--color-char)' }}>
                    {active ? 'Enabled' : 'Disabled'}
                  </div>
                  <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
                    {active ? 'Visible to everyone it reaches as soon as it’s saved.' : 'Hidden from everyone — it stays in your list so you can switch it back on.'}
                  </div>
                </div>
                <ToggleSwitch on={active} onChange={() => setActive((a) => !a)} label={toggleLabel('publish', active)} />
              </div>

              {formError && (
                <p className="text-[12.5px] mb-3" style={{ color: 'var(--color-clay)' }}>
                  {formError}
                </p>
              )}
              <div className="flex items-center justify-end gap-3 flex-wrap pb-6">
                {missing.length > 0 && (
                  <span className="text-[12px] mr-auto" style={{ color: 'var(--color-char-soft)' }}>
                    Still needed: {missing.join(', ')}
                  </span>
                )}
                <GhostButton onClick={() => navigate(backTo)}>Cancel</GhostButton>
                <PrimaryButton onClick={handleSave} disabled={!canSave}>
                  {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Publish resource'}
                </PrimaryButton>
              </div>
            </div>

            <aside className="lg:sticky lg:top-0">
              <div className="font-mono text-[11px] tracking-[0.14em] uppercase mb-3" style={{ color: 'var(--color-gold)' }}>
                Live preview
              </div>
              <div className="rounded-[10px] border p-4" style={CARD_STYLE}>
                <div className="flex items-start gap-3">
                  {kind ? (
                    <FileKindTile kind={kind} size={40} />
                  ) : (
                    <span className="h-12 w-10 shrink-0 rounded-[8px] border border-dashed flex items-center justify-center" style={{ borderColor: 'var(--color-line)' }}>
                      <Icon name="resources" className="h-4 w-4" style={{ color: 'var(--color-char-soft)' }} />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="font-display text-[16px] leading-snug break-words" style={{ color: title.trim() ? 'var(--color-char)' : 'var(--color-char-soft)' }}>
                      {title.trim() || 'Untitled resource'}
                    </div>
                    <div className="text-[11.5px] mt-1" style={{ color: 'var(--color-char-soft)' }}>
                      {reach === 'one' && !department ? 'Pick a department' : resourceScopeLabel({ department: reach === 'all' ? '' : department, mbbsYear, audience })}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                      {kind && <Badge tone="neutral">{RESOURCE_KIND_LABELS[kind]}</Badge>}
                      {shownSize != null && <span className="font-mono text-[11px]" style={{ color: 'var(--color-char-soft)' }}>{formatBytes(shownSize)}</span>}
                      {!active && <Badge tone="clay">Disabled</Badge>}
                    </div>
                  </div>
                </div>
                {description.trim() && (
                  <p className="text-[12.5px] mt-3 leading-relaxed" style={{ color: 'var(--color-char-soft)' }}>
                    {description.trim()}
                  </p>
                )}
              </div>
              <div className="mt-4 rounded-[10px] border p-4" style={CARD_STYLE}>
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon name="users" className="h-3.5 w-3.5" style={{ color: 'var(--color-gold)' }} />
                  <span className="text-[11px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                    Who will see it
                  </span>
                </div>
                <p className="text-[13px] leading-relaxed" style={{ color: active ? 'var(--color-char)' : 'var(--color-char-soft)' }}>
                  {who}
                </p>
              </div>
            </aside>
          </div>
        )}
      </div>
    </Shell>
  )
}
