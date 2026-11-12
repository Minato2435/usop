import { useEffect, useMemo, useState, type ComponentType, type CSSProperties, type ReactNode } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { Card, Skeleton } from '../../roles/primary-admin/shell/ui'
import { Icon } from '../../roles/primary-admin/shell/Icon'
import { FileKindTile, KIND_COLORS, OpenDownloadButtons, fmtDay } from './ResourceShared'
import {
  ALL_DEPARTMENTS,
  RESOURCE_KIND_LABELS,
  formatBytes,
  isResourceEnabledFor,
  resourceReachesDepartment,
  watchFacultyResources,
  watchInstitutionResourceOverrides,
  watchStudentResources,
} from '../../lib/firestore/resources'
import { useStudentDepartments } from '../../lib/enabledDepartments'
import { watchDepartment } from '../../lib/firestore/departments'
import type { Department, InstitutionResourceOverride, Resource, ResourceKind } from '../../types'

type ShellProps = { eyebrow?: string; title: string; actions?: ReactNode; children: ReactNode }

const NEW_FOR_MS = 14 * 86_400_000
const GENERAL = '__general__' // department filter value for "for every department"

type SortKey = 'newest' | 'oldest' | 'az' | 'za' | 'largest' | 'smallest'
const SORT_LABELS: Record<SortKey, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  az: 'Title A–Z',
  za: 'Title Z–A',
  largest: 'Largest file',
  smallest: 'Smallest file',
}
const SORTERS: Record<SortKey, (a: Resource, b: Resource) => number> = {
  newest: (a, b) => stamp(b) - stamp(a),
  oldest: (a, b) => stamp(a) - stamp(b),
  az: (a, b) => a.title.localeCompare(b.title),
  za: (a, b) => b.title.localeCompare(a.title),
  largest: (a, b) => b.size - a.size,
  smallest: (a, b) => a.size - b.size,
}
function stamp(r: Resource) {
  return r.updatedAt ?? r.createdAt
}

const VIEW_KEY = 'usop.resources.view'
function readView(): 'grid' | 'list' {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid'
  } catch {
    return 'grid'
  }
}

const BORDER = 'color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)'
const CARD_BG = 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)'

// The read-only Resources library. Students see resources for their year
// (or every year) in their departments; faculty/HOD see faculty resources
// for their department. Both get catalog resources their college hasn't
// switched off, plus their college's own. Grouped "General" (all
// departments) first, then by department.
export function ResourceLibraryPage({ Shell, audience }: { Shell: ComponentType<ShellProps>; audience: 'student' | 'faculty' }) {
  const { appUser } = useAuth()
  const institutionId = appUser?.institutionId ?? null

  // Departments the viewer belongs to.
  const { departments: studentDepts, loading: studentDeptsLoading } = useStudentDepartments(
    audience === 'student' ? institutionId : null,
    audience === 'student' ? (appUser?.mbbsYear ?? null) : null,
  )
  const [staffDept, setStaffDept] = useState<Department | null | undefined>(audience === 'faculty' ? undefined : null)
  useEffect(() => {
    if (audience !== 'faculty') return
    if (!appUser?.departmentId) {
      setStaffDept(null)
      return
    }
    return watchDepartment(appUser.departmentId, setStaffDept)
  }, [audience, appUser?.departmentId])
  const myDeptNames = useMemo(
    () => (audience === 'student' ? studentDepts.map((d) => d.name) : staffDept ? [staffDept.name] : []),
    [audience, studentDepts, staffDept],
  )

  const [resources, setResources] = useState<Resource[] | null>(null)
  useEffect(() => {
    if (!institutionId) return
    if (audience === 'student') {
      if (!appUser?.mbbsYear) return
      return watchStudentResources(institutionId, appUser.mbbsYear, setResources)
    }
    return watchFacultyResources(institutionId, setResources)
  }, [audience, institutionId, appUser?.mbbsYear])

  const [overrides, setOverrides] = useState<InstitutionResourceOverride[] | null>(null)
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionResourceOverrides(institutionId, setOverrides)
  }, [institutionId])

  const visible = useMemo(
    () =>
      (resources ?? []).filter(
        (r) => resourceReachesDepartment(r, myDeptNames) && (r.institutionId !== '' || isResourceEnabledFor(overrides ?? [], r.id)),
      ),
    [resources, overrides, myDeptNames],
  )

  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<ResourceKind | 'all'>('all')
  const [dept, setDept] = useState<string>('all') // 'all' | GENERAL | a department name
  const [sort, setSort] = useState<SortKey>('newest')
  const [view, setView] = useState<'grid' | 'list'>(readView)
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view)
    } catch {
      /* private mode — fine */
    }
  }, [view])

  const now = Date.now()

  // Department options = the viewer's departments that actually have files,
  // plus "General" when there are all-department files.
  const deptOptions = useMemo(() => {
    const counts = new Map<string, number>()
    visible.forEach((r) => {
      const k = r.department === ALL_DEPARTMENTS ? GENERAL : r.department
      counts.set(k, (counts.get(k) ?? 0) + 1)
    })
    const names = [...counts.keys()].filter((k) => k !== GENERAL).sort((a, b) => a.localeCompare(b))
    return [...(counts.has(GENERAL) ? [{ value: GENERAL, label: 'General (every department)', count: counts.get(GENERAL)! }] : []), ...names.map((n) => ({ value: n, label: n, count: counts.get(n)! }))]
  }, [visible])

  // Filter by department + search first; type counts follow those, so the
  // chips always say how many you'd get.
  const base = useMemo(() => {
    const q = search.trim().toLowerCase()
    return visible.filter(
      (r) =>
        (dept === 'all' || (dept === GENERAL ? r.department === ALL_DEPARTMENTS : r.department === dept)) &&
        (q === '' || r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q) || r.fileName.toLowerCase().includes(q)),
    )
  }, [visible, dept, search])
  const kindCounts = useMemo(() => {
    const m = new Map<ResourceKind, number>()
    base.forEach((r) => m.set(r.kind, (m.get(r.kind) ?? 0) + 1))
    return m
  }, [base])

  const shown = useMemo(() => base.filter((r) => kind === 'all' || r.kind === kind).sort(SORTERS[sort]), [base, kind, sort])

  const groups = useMemo(() => {
    const map = new Map<string, Resource[]>()
    for (const r of shown) map.set(r.department, [...(map.get(r.department) ?? []), r])
    const keys = [...map.keys()].sort((a, b) => (a === ALL_DEPARTMENTS ? -1 : b === ALL_DEPARTMENTS ? 1 : a.localeCompare(b)))
    return keys.map((k) => ({ key: k, title: k === ALL_DEPARTMENTS ? 'General' : k, hint: k === ALL_DEPARTMENTS ? 'For every department' : undefined, items: map.get(k)! }))
  }, [shown])

  const stats = useMemo(
    () => ({
      total: visible.length,
      fresh: visible.filter((r) => now - r.createdAt < NEW_FOR_MS).length,
      departments: new Set(visible.filter((r) => r.department !== ALL_DEPARTMENTS).map((r) => r.department)).size,
      college: visible.filter((r) => r.institutionId !== '').length,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible],
  )

  const filtered = dept !== 'all' || kind !== 'all' || search.trim() !== ''
  function clearFilters() {
    setDept('all')
    setKind('all')
    setSearch('')
  }

  const loading =
    resources === null || overrides === null || (audience === 'student' ? studentDeptsLoading : staffDept === undefined)
  const noProfile = !institutionId || (audience === 'student' && !appUser?.mbbsYear)

  return (
    <Shell eyebrow={audience === 'student' ? (appUser?.mbbsYear ? `Year ${appUser.mbbsYear}` : 'Study material') : (staffDept?.name ?? 'Study material')} title="Resources">
      <p className="text-[13.5px] mb-6 -mt-1 max-w-2xl leading-relaxed" style={{ color: 'var(--color-char-soft)' }}>
        Handouts, notes, slides and reference images shared by your college and the USOP library
        {audience === 'student' ? ' for your year' : ' for faculty'}.
      </p>

      {noProfile ? (
        <Card className="max-w-lg">
          <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            Your profile isn’t linked to a college{audience === 'student' ? ' and year' : ''} yet — ask your institution admin.
          </p>
        </Card>
      ) : (
        <>
          {/* Summary strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 border rounded-[6px] overflow-hidden divide-x divide-y sm:divide-y-0 mb-6" style={{ borderColor: BORDER }}>
            <Stat label="Files" value={stats.total} accent loading={loading} />
            <Stat label="New in 2 weeks" value={stats.fresh} loading={loading} />
            <Stat label="Departments" value={stats.departments} loading={loading} />
            <Stat label="From your college" value={stats.college} loading={loading} />
          </div>

          {/* Toolbar */}
          <div className="rounded-[12px] border p-3 sm:p-3.5 mb-7 flex flex-col gap-3" style={{ borderColor: BORDER, backgroundColor: CARD_BG }}>
            <div className="flex flex-wrap items-center gap-2.5">
              <div className="relative flex-1 min-w-[200px]">
                <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: 'var(--color-char-soft)' }} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by title, description or file name…"
                  className="w-full pl-9 pr-3 py-2 text-[13px] rounded-[8px] border outline-none transition-colors focus:border-[var(--color-gold)]"
                  style={{ borderColor: 'var(--color-line)', backgroundColor: 'var(--color-paper-raised)', color: 'var(--color-char)' }}
                />
              </div>
              <SelectBox label="Department" value={dept} onChange={setDept} icon="departments">
                <option value="all">All departments ({visible.length})</option>
                {deptOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label} ({o.count})
                  </option>
                ))}
              </SelectBox>
              <SelectBox label="Sort" value={sort} onChange={(v) => setSort(v as SortKey)} icon="filter">
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABELS[k]}
                  </option>
                ))}
              </SelectBox>
              <div className="flex rounded-[8px] border overflow-hidden shrink-0" style={{ borderColor: 'var(--color-line)' }}>
                {(['grid', 'list'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    title={v === 'grid' ? 'Cards' : 'List'}
                    onClick={() => setView(v)}
                    className="h-[34px] w-9 flex items-center justify-center transition-colors"
                    style={{ backgroundColor: view === v ? 'var(--color-ink)' : 'var(--color-paper-raised)', color: view === v ? 'var(--color-frost)' : 'var(--color-char-soft)' }}
                  >
                    <Icon name={v} className="h-4 w-4" />
                  </button>
                ))}
              </div>
            </div>

            {/* File type chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] mr-1" style={{ color: 'var(--color-char-soft)' }}>
                File type
              </span>
              {(['all', ...(Object.keys(RESOURCE_KIND_LABELS) as ResourceKind[])] as const).map((k) => {
                const active = kind === k
                const count = k === 'all' ? base.length : (kindCounts.get(k) ?? 0)
                if (k !== 'all' && count === 0 && !active) return null
                const color = k === 'all' ? 'var(--color-ink)' : KIND_COLORS[k]
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKind(k)}
                    className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors"
                    style={{
                      borderColor: active ? color : 'var(--color-line)',
                      backgroundColor: active ? (k === 'all' ? color : `color-mix(in srgb, ${color} 12%, var(--color-paper-raised) 88%)`) : 'var(--color-paper-raised)',
                      color: active ? (k === 'all' ? 'var(--color-frost)' : color) : 'var(--color-char-soft)',
                    }}
                  >
                    {k !== 'all' && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />}
                    {k === 'all' ? 'All types' : RESOURCE_KIND_LABELS[k]}
                    <span className="tabular-nums opacity-70">{count}</span>
                  </button>
                )
              })}
              {filtered && (
                <span className="ml-auto text-[12px]" style={{ color: 'var(--color-char-soft)' }}>
                  Showing <span className="tabular-nums font-medium" style={{ color: 'var(--color-char)' }}>{shown.length}</span> of {visible.length} ·{' '}
                  <button type="button" onClick={clearFilters} className="font-medium underline underline-offset-2" style={{ color: 'var(--color-gold)' }}>
                    Clear filters
                  </button>
                </span>
              )}
            </div>
          </div>

          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-44 rounded-[14px]" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <div className="rounded-[14px] border border-dashed text-center py-14 px-6" style={{ borderColor: BORDER }}>
              <span className="mx-auto mb-3 h-12 w-12 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-gold-soft)', color: 'var(--color-gold)' }}>
                <Icon name="resources" className="h-6 w-6" />
              </span>
              <p className="font-display text-[18px]" style={{ color: 'var(--color-char)' }}>
                {visible.length === 0 ? 'Nothing shared yet' : 'No files match'}
              </p>
              <p className="text-[13px] mt-1" style={{ color: 'var(--color-char-soft)' }}>
                {visible.length === 0 ? 'Files your college or USOP share with you will appear here.' : 'Try another department or file type, or clear the filters.'}
              </p>
              {visible.length > 0 && (
                <button type="button" onClick={clearFilters} className="mt-4 rounded-[8px] border px-4 py-2 text-[12.5px] font-medium" style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}>
                  Clear filters
                </button>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-9">
              {groups.map((g) => (
                <section key={g.key}>
                  <div className="flex items-center gap-3 mb-3.5">
                    <span className="h-7 w-7 rounded-full flex items-center justify-center font-display text-[13px] shrink-0" style={{ border: '1.5px solid var(--color-gold)', color: 'var(--color-gold)' }}>
                      {g.key === ALL_DEPARTMENTS ? '★' : g.title.charAt(0)}
                    </span>
                    <span className="font-display text-[19px] leading-none" style={{ color: 'var(--color-char)' }}>
                      {g.title}
                    </span>
                    {g.hint && (
                      <span className="text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
                        {g.hint}
                      </span>
                    )}
                    <span className="flex-1 h-px" style={{ backgroundColor: 'var(--color-line)' }} />
                    <span className="font-mono text-[11px]" style={{ color: 'var(--color-char-soft)' }}>
                      {g.items.length} {g.items.length === 1 ? 'file' : 'files'}
                    </span>
                  </div>
                  {view === 'grid' ? (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {g.items.map((r, i) => (
                        <ResourceCard key={r.id} r={r} index={i} isNew={now - r.createdAt < NEW_FOR_MS} />
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-[12px] border overflow-hidden" style={{ borderColor: BORDER, backgroundColor: 'var(--color-paper)' }}>
                      {g.items.map((r) => (
                        <ResourceRow key={r.id} r={r} isNew={now - r.createdAt < NEW_FOR_MS} />
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </Shell>
  )
}

function Stat({ label, value, accent, loading }: { label: string; value: number; accent?: boolean; loading: boolean }) {
  return (
    <div className="px-5 py-4" style={{ borderColor: BORDER }}>
      <div className="font-display text-[28px] leading-none tabular-nums" style={{ color: accent ? 'var(--color-gold)' : 'var(--color-char)' }}>
        {loading ? '–' : value}
      </div>
      <div className="text-[10.5px] uppercase tracking-[0.08em] mt-1.5" style={{ color: 'var(--color-char-soft)' }}>
        {label}
      </div>
    </div>
  )
}

function SelectBox({
  label,
  value,
  onChange,
  icon,
  children,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  icon: 'departments' | 'filter'
  children: ReactNode
}) {
  return (
    <label className="relative flex items-center rounded-[8px] border pl-3 pr-8 h-[34px] transition-colors focus-within:border-[var(--color-gold)] min-w-0" style={{ borderColor: 'var(--color-line)', backgroundColor: 'var(--color-paper-raised)' }}>
      <Icon name={icon} className="h-3.5 w-3.5 shrink-0 mr-2" style={{ color: 'var(--color-gold)' }} />
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-transparent outline-none text-[12.5px] font-medium pr-1 max-w-[220px] truncate cursor-pointer"
        style={{ color: 'var(--color-char)' }}
      >
        {children}
      </select>
      <Icon name="chevron" className="absolute right-2.5 h-3.5 w-3.5 pointer-events-none" style={{ color: 'var(--color-char-soft)', transform: 'rotate(90deg)' }} />
    </label>
  )
}

function Meta({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium" style={{ backgroundColor: 'color-mix(in srgb, var(--color-char-soft) 9%, transparent)', color: 'var(--color-char-soft)', ...style }}>
      {children}
    </span>
  )
}

function scopeChips(r: Resource) {
  return (
    <>
      {r.audience === 'student' && <Meta>{r.mbbsYear ? `Year ${r.mbbsYear}` : 'All years'}</Meta>}
      <Meta style={r.institutionId ? { backgroundColor: 'var(--color-gold-soft)', color: 'var(--color-gold)' } : undefined}>
        {r.institutionId ? 'Your college' : 'USOP library'}
      </Meta>
    </>
  )
}

function ResourceCard({ r, index, isNew }: { r: Resource; index: number; isNew: boolean }) {
  const color = KIND_COLORS[r.kind]
  return (
    <article
      className="fade-up group relative rounded-[14px] border flex flex-col overflow-hidden transition-all hover:-translate-y-0.5 hover:shadow-[0_18px_36px_-22px_rgba(11,18,32,0.45)]"
      style={{ backgroundColor: CARD_BG, borderColor: BORDER, animationDelay: `${index * 35}ms` }}
    >
      <span className="h-[3px] w-full" style={{ background: `linear-gradient(90deg, ${color}, color-mix(in srgb, ${color} 25%, transparent))` }} />
      <div className="p-4 pb-3 flex items-start gap-3.5">
        <FileKindTile kind={r.kind} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h3 className="font-display text-[17px] leading-snug break-words flex-1" style={{ color: 'var(--color-char)' }}>
              {r.title}
            </h3>
            {isNew && (
              <span className="shrink-0 rounded-full px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.08em]" style={{ backgroundColor: 'var(--color-gold)', color: 'var(--color-paper-raised)' }}>
                New
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1 mt-1.5">{scopeChips(r)}</div>
        </div>
      </div>
      <p className="px-4 text-[12.5px] leading-relaxed line-clamp-3 min-h-[1.5em] mb-3" style={{ color: 'var(--color-char-soft)' }}>
        {r.description || <span className="italic opacity-70">{r.fileName}</span>}
      </p>
      <div className="mt-auto px-4 py-3 border-t flex items-center gap-3" style={{ borderColor: BORDER }}>
        <span className="font-mono text-[10.5px] flex-1 min-w-0 truncate" style={{ color: 'var(--color-char-soft)' }}>
          {formatBytes(r.size)} · {fmtDay(stamp(r))}
        </span>
        <OpenDownloadButtons resource={r} compact />
      </div>
    </article>
  )
}

function ResourceRow({ r, isNew }: { r: Resource; isNew: boolean }) {
  return (
    <div className="flex items-center gap-3.5 px-4 py-3 border-b last:border-0 transition-colors hover:bg-black/[0.02]" style={{ borderColor: BORDER }}>
      <FileKindTile kind={r.kind} size={34} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-display text-[15.5px] leading-tight break-words" style={{ color: 'var(--color-char)' }}>
            {r.title}
          </span>
          {isNew && (
            <span className="rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.08em]" style={{ backgroundColor: 'var(--color-gold)', color: 'var(--color-paper-raised)' }}>
              New
            </span>
          )}
        </div>
        {r.description && (
          <p className="text-[12px] truncate mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
            {r.description}
          </p>
        )}
      </div>
      <div className="hidden md:flex items-center gap-1 shrink-0">{scopeChips(r)}</div>
      <span className="hidden sm:block font-mono text-[10.5px] w-[130px] text-right shrink-0" style={{ color: 'var(--color-char-soft)' }}>
        {formatBytes(r.size)} · {fmtDay(stamp(r))}
      </span>
      <OpenDownloadButtons resource={r} compact />
    </div>
  )
}
