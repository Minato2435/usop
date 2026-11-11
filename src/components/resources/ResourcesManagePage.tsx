import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, PrimaryButton, Skeleton, inputClass } from '../../roles/primary-admin/shell/ui'
import { Icon } from '../../roles/primary-admin/shell/Icon'
import { toggleLabel } from '../../roles/primary-admin/shell/VideoShared'
import { SaveChangesBar, SubTabBar } from '../../roles/institution-admin/shell/toggleUi'
import { AdminResourceRow } from './ResourceShared'
import {
  RESOURCE_KIND_LABELS,
  deleteResourceAndFile,
  isResourceActive,
  isResourceEnabledFor,
  setResourceEnabledForInstitution,
  updateResource,
  watchAllResources,
  watchInstitutionResourceOverrides,
} from '../../lib/firestore/resources'
import { watchInstitutions } from '../../lib/firestore/institutions'
import { MBBS_YEARS } from '../../lib/academicStructure'
import type { Institution, InstitutionResourceOverride, MbbsYear, Resource, ResourceKind, VideoAudience } from '../../types'

type ShellProps = { eyebrow?: string; title: string; actions?: ReactNode; children: ReactNode }

// The admin list of resources.
// - Primary Admin (no institutionId): every resource platform-wide — catalog
//   ("All colleges") and each college's own — with publish switch, edit,
//   delete.
// - Institution Admin (institutionId): two tabs. "Catalog" = Primary Admin's
//   shared resources with this college's include/exclude switch (staged,
//   Save changes — same as the Videos page). "Our college" = the college's
//   own resources, which it fully manages.
export function ResourcesManagePage({ Shell, institutionId, basePath }: { Shell: ComponentType<ShellProps>; institutionId?: string | null; basePath: string }) {
  const navigate = useNavigate()
  const isPrimary = institutionId === undefined

  const [resources, setResources] = useState<Resource[] | null>(null)
  useEffect(() => watchAllResources(setResources), [])

  const [institutions, setInstitutions] = useState<Institution[]>([])
  useEffect(() => {
    if (!isPrimary) return
    return watchInstitutions(setInstitutions)
  }, [isPrimary])
  const collegeName = (id: string) => (id ? (institutions.find((i) => i.id === id)?.name ?? 'One college') : 'All colleges')

  const [overrides, setOverrides] = useState<InstitutionResourceOverride[] | null>(isPrimary ? [] : null)
  useEffect(() => {
    if (isPrimary || !institutionId) return
    return watchInstitutionResourceOverrides(institutionId, setOverrides)
  }, [isPrimary, institutionId])

  const [tab, setTab] = useState<'catalog' | 'own'>('own')
  const [draft, setDraft] = useState<Record<string, boolean>>({})
  const [savingDraft, setSavingDraft] = useState(false)
  const included = (id: string) => (id in draft ? draft[id] : isResourceEnabledFor(overrides ?? [], id))
  async function saveDraft() {
    if (!institutionId) return
    setSavingDraft(true)
    await Promise.all(Object.entries(draft).map(([id, on]) => setResourceEnabledForInstitution(institutionId, id, on)))
    setDraft({})
    setSavingDraft(false)
  }

  const [search, setSearch] = useState('')
  const [collegeFilter, setCollegeFilter] = useState<'any' | 'catalog' | string>('any')
  const [kindFilter, setKindFilter] = useState<ResourceKind | 'all'>('all')
  const [audienceFilter, setAudienceFilter] = useState<VideoAudience | 'all'>('all')
  const [yearFilter, setYearFilter] = useState<MbbsYear | 'all'>('all')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const base = useMemo(() => {
    const all = resources ?? []
    if (isPrimary) return all
    // A catalog resource Primary Admin disabled reaches nobody, so it isn't
    // offered for the college to include/exclude.
    return tab === 'catalog' ? all.filter((r) => r.institutionId === '' && isResourceActive(r)) : all.filter((r) => r.institutionId === institutionId)
  }, [resources, isPrimary, tab, institutionId])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return base
      .filter(
        (r) =>
          (q === '' || r.title.toLowerCase().includes(q) || r.fileName.toLowerCase().includes(q) || r.department.toLowerCase().includes(q)) &&
          (kindFilter === 'all' || r.kind === kindFilter) &&
          (audienceFilter === 'all' || r.audience === audienceFilter) &&
          (yearFilter === 'all' || r.mbbsYear === yearFilter || r.mbbsYear === 0) &&
          (!isPrimary || collegeFilter === 'any' || (collegeFilter === 'catalog' ? r.institutionId === '' : r.institutionId === collegeFilter)),
      )
      .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
  }, [base, search, kindFilter, audienceFilter, yearFilter, collegeFilter, isPrimary])

  const stats = useMemo(() => {
    const all = isPrimary ? (resources ?? []) : base
    return [
      { label: 'Resources', value: all.length },
      { label: isPrimary ? 'All colleges' : 'For students', value: isPrimary ? all.filter((r) => !r.institutionId).length : all.filter((r) => r.audience === 'student').length },
      { label: isPrimary ? 'College-only' : 'For faculty', value: isPrimary ? all.filter((r) => r.institutionId).length : all.filter((r) => r.audience === 'faculty').length },
      {
        label: !isPrimary && tab === 'catalog' ? 'Switched off here' : 'Disabled',
        value: !isPrimary && tab === 'catalog' ? all.filter((r) => !included(r.id)).length : all.filter((r) => !isResourceActive(r)).length,
      },
    ]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resources, base, isPrimary, tab, overrides, draft])

  const canManage = isPrimary || tab === 'own'
  const loading = resources === null || overrides === null

  return (
    <Shell
      eyebrow="Content"
      title="Resources"
      actions={
        canManage ? (
          <PrimaryButton onClick={() => navigate(`${basePath}/new`)}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            New resource
          </PrimaryButton>
        ) : undefined
      }
    >
      <p className="text-[13px] mb-5 -mt-1 max-w-2xl" style={{ color: 'var(--color-char-soft)' }}>
        {isPrimary
          ? 'Study material for students and staff — PDFs, Word, PowerPoint, Excel and images. Publish to every college, or to one college only.'
          : 'Study material for your students and staff. The catalog comes from the platform — switch off anything you don’t want here. Add your own under “Our college”.'}
      </p>

      {!isPrimary && (
        <SubTabBar
          value={tab}
          onChange={(v) => setTab(v)}
          options={[
            { v: 'own', label: 'Our college' },
            { v: 'catalog', label: 'Catalog (all colleges)' },
          ]}
        />
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 border rounded-[6px] overflow-hidden mb-5 divide-x divide-y sm:divide-y-0 divide-[var(--color-line)]" style={{ borderColor: 'var(--color-line)' }}>
        {stats.map((s, i) => (
          <div key={s.label} className="px-5 py-4">
            <div className="font-display text-[28px] leading-none tabular-nums" style={{ color: i === 0 ? 'var(--color-gold)' : 'var(--color-char)' }}>
              {loading ? '–' : s.value}
            </div>
            <div className="text-[10.5px] uppercase tracking-[0.08em] mt-1.5" style={{ color: 'var(--color-char-soft)' }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2.5 flex-wrap mb-5">
        <div className="relative flex-1 min-w-[200px]">
          <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: 'var(--color-char-soft)' }} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, file or department" className={`${inputClass} pl-8`} style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }} />
        </div>
        {isPrimary && (
          <select className={inputClass} style={{ width: 190, borderColor: 'var(--color-line)', color: 'var(--color-char)' }} value={collegeFilter} onChange={(e) => setCollegeFilter(e.target.value)}>
            <option value="any">Any college</option>
            <option value="catalog">All-college (catalog)</option>
            {[...institutions]
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
          </select>
        )}
        <select className={inputClass} style={{ width: 140, borderColor: 'var(--color-line)', color: 'var(--color-char)' }} value={kindFilter} onChange={(e) => setKindFilter(e.target.value as ResourceKind | 'all')}>
          <option value="all">All types</option>
          {(Object.keys(RESOURCE_KIND_LABELS) as ResourceKind[]).map((k) => (
            <option key={k} value={k}>
              {RESOURCE_KIND_LABELS[k]}
            </option>
          ))}
        </select>
        <select className={inputClass} style={{ width: 140, borderColor: 'var(--color-line)', color: 'var(--color-char)' }} value={audienceFilter} onChange={(e) => setAudienceFilter(e.target.value as VideoAudience | 'all')}>
          <option value="all">All audiences</option>
          <option value="student">Students</option>
          <option value="faculty">Faculty</option>
        </select>
        <select className={inputClass} style={{ width: 120, borderColor: 'var(--color-line)', color: 'var(--color-char)' }} value={yearFilter} onChange={(e) => setYearFilter(e.target.value === 'all' ? 'all' : (Number(e.target.value) as MbbsYear))}>
          <option value="all">All years</option>
          {MBBS_YEARS.map((y) => (
            <option key={y} value={y}>
              Year {y}
            </option>
          ))}
        </select>
      </div>

      {!isPrimary && tab === 'catalog' && <SaveChangesBar pendingCount={Object.keys(draft).length} saving={savingDraft} onSave={saveDraft} onDiscard={() => setDraft({})} />}

      {loading ? (
        <div className="space-y-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : shown.length === 0 ? (
        <Card className="chamfer max-w-lg">
          <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            {base.length === 0
              ? !isPrimary && tab === 'catalog'
                ? 'The platform hasn’t published any shared resources yet.'
                : 'No resources yet — add the first one with “New resource”.'
              : 'Nothing matches these filters.'}
          </p>
        </Card>
      ) : (
        <div className="border rounded-[10px] overflow-hidden" style={{ backgroundColor: 'var(--color-paper)', borderColor: 'var(--color-line)' }}>
          {shown.map((r) =>
            !isPrimary && tab === 'catalog' ? (
              <AdminResourceRow
                key={r.id}
                resource={r}
                muted={!included(r.id)}
                toggle={{ on: included(r.id), onChange: () => setDraft((d) => ({ ...d, [r.id]: !included(r.id) })), label: toggleLabel('include', included(r.id)) }}
              />
            ) : (
              <AdminResourceRow
                key={r.id}
                resource={r}
                collegeLabel={isPrimary ? collegeName(r.institutionId) : undefined}
                muted={!isResourceActive(r)}
                toggle={{ on: isResourceActive(r), onChange: () => updateResource(r.id, { active: !isResourceActive(r) }), label: toggleLabel('publish', isResourceActive(r)) }}
                actions={
                  confirmDelete === r.id ? (
                    <span className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={async () => {
                          await deleteResourceAndFile(r)
                          setConfirmDelete(null)
                        }}
                        className="px-2.5 py-1 text-[12px] font-medium rounded-[5px]"
                        style={{ backgroundColor: 'var(--color-clay)', color: '#fff' }}
                      >
                        Delete
                      </button>
                      <button onClick={() => setConfirmDelete(null)} className="px-2 py-1 text-[12px]" style={{ color: 'var(--color-char-soft)' }}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <span className="flex items-center shrink-0">
                      <button title="Edit" onClick={() => navigate(`${basePath}/${r.id}/edit`)} className="h-8 w-8 flex items-center justify-center rounded-[6px] hover:bg-black/[0.05]" style={{ color: 'var(--color-char-soft)' }}>
                        <Icon name="edit" className="h-4 w-4" />
                      </button>
                      <button title="Delete" onClick={() => setConfirmDelete(r.id)} className="h-8 w-8 flex items-center justify-center rounded-[6px] hover:bg-black/[0.05]" style={{ color: 'var(--color-clay)' }}>
                        <Icon name="trash" className="h-4 w-4" />
                      </button>
                    </span>
                  )
                }
              />
            ),
          )}
        </div>
      )}
    </Shell>
  )
}
