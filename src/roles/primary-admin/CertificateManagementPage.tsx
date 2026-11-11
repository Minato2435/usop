import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PrimaryAdminShell } from './shell/PrimaryAdminShell'
import { Badge, Card, Skeleton } from './shell/ui'
import { Icon } from './shell/Icon'
import { useCountUp } from './shell/useCountUp'
import { CertificateRequestsList } from '../../components/CertificateRequestsListPage'
import { watchAllDepartments, watchInstitutionDepartmentOverrides } from '../../lib/firestore/departments'
import { watchInstitutions } from '../../lib/firestore/institutions'
import {
  watchAllCertificateSkillPresets,
  watchAllCertificateRequests,
  certificateRequestStatus,
} from '../../lib/firestore/certificates'
import { MBBS_YEARS } from '../../lib/academicStructure'
import type { CertificateRequest, CertificateSkillPreset, Department, Institution, MbbsYear } from '../../types'

type Tab = 'requests' | 'presets'

const BORDER = 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)'
const ROW_LINE = 'color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)'

function hasSkills(p: CertificateSkillPreset | undefined): p is CertificateSkillPreset {
  return !!p && p.requiredSkills.length > 0
}

// Laid out after `attaching references/Certificate Management - Admin.dc.html`
// (adapted, not copied — our shell, tokens and data). Requests come first
// since deciding them is the recurring job; presets are set up once per
// department. Tab lives in `?tab=` so the review page's Back lands here.
export function PrimaryAdminCertificateManagementPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab: Tab = searchParams.get('tab') === 'presets' ? 'presets' : 'requests'
  function setTab(t: Tab) {
    setSearchParams(t === 'requests' ? {} : { tab: t }, { replace: true })
  }

  const [departments, setDepartments] = useState<Department[] | null>(null)
  useEffect(() => watchAllDepartments(setDepartments), [])
  const [institutions, setInstitutions] = useState<Institution[]>([])
  useEffect(() => watchInstitutions(setInstitutions), [])
  const [presets, setPresets] = useState<CertificateSkillPreset[]>([])
  useEffect(() => watchAllCertificateSkillPresets(setPresets), [])
  const [requests, setRequests] = useState<CertificateRequest[]>([])
  useEffect(() => watchAllCertificateRequests(setRequests), [])

  const awaitingYou = requests.filter((r) => certificateRequestStatus(r) === 'pending' && r.primaryAdminDecision === 'pending').length


  return (
    <PrimaryAdminShell eyebrow="Certificates" title="Certificate Management">
      <p className="text-[13.5px] leading-relaxed max-w-[600px] mb-6" style={{ color: 'var(--color-char-soft)' }}>
        Decide certificate requests alongside the Skill Lab Director, and set the skills each department requires for its
        certificate.
      </p>

      <div className="flex gap-8 mb-7 border-b" style={{ borderColor: BORDER }}>
        {(
          [
            ['requests', 'Requests', requests.length],
            ['presets', 'Skill presets', departments?.length ?? 0],
          ] as [Tab, string, number][]
        ).map(([key, label, count]) => {
          const active = tab === key
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="pb-3.5 -mb-px px-0.5 font-display text-[21px] flex items-center gap-2.5 transition-colors"
              style={{
                color: active ? 'var(--color-char)' : 'var(--color-char-soft)',
                borderBottom: `2px solid ${active ? 'var(--color-gold)' : 'transparent'}`,
              }}
            >
              {label}
              <span className="font-mono text-[11px]" style={{ color: 'var(--color-char-soft)' }}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {tab === 'requests' ? (
        <>
          <StatStrip
            stats={[
              { label: 'Awaiting you', value: awaitingYou, accent: true },
              { label: 'Pending', value: requests.filter((r) => certificateRequestStatus(r) === 'pending').length },
              { label: 'Issued', value: requests.filter((r) => certificateRequestStatus(r) === 'issued').length },
              { label: 'Rejected', value: requests.filter((r) => certificateRequestStatus(r) === 'rejected').length },
            ]}
          />
          <CertificateRequestsList basePath="/admin/certificates/requests" />
        </>
      ) : (
        <PresetsTab departments={departments} institutions={institutions} presets={presets} editorBasePath="/admin/certificates/presets" />
      )}

    </PrimaryAdminShell>
  )
}

// The bordered, hairline-divided stat strip DepartmentsPage/LogTemplatesPage
// use — gold reserved for the one headline number.
function StatStrip({ stats }: { stats: { label: string; value: number; accent?: boolean }[] }) {
  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-4 border rounded-[6px] overflow-hidden mb-7 divide-x divide-y sm:divide-y-0 divide-[var(--color-line)]"
      style={{ borderColor: 'var(--color-line)' }}
    >
      {stats.map((st) => (
        <StatCell key={st.label} {...st} />
      ))}
    </div>
  )
}

function StatCell({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  const shown = useCountUp(value)
  return (
    <div className="px-5 py-4">
      <div className="font-display text-[28px] leading-none tabular-nums" style={{ color: accent ? 'var(--color-gold)' : 'var(--color-char)' }}>
        {shown}
      </div>
      <div className="mt-2 text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
        {label}
      </div>
    </div>
  )
}

// --- Skill presets tab -------------------------------------------------------

// The whole Skill presets view — also used as Skill Lab Director's own
// Skill Presets page. `editorBasePath` is where a department's editor lives.
export function PresetsTab({
  departments,
  institutions,
  presets,
  editorBasePath,
}: {
  departments: Department[] | null
  institutions: Institution[]
  presets: CertificateSkillPreset[]
  editorBasePath: string
}) {
  const [year, setYear] = useState<MbbsYear | 'all'>('all')
  const [search, setSearch] = useState('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  // '' = all colleges (the platform view). A college narrows the list to its
  // departments — shared ones switched on there + its own — and shows that
  // college's effective preset on every card.
  const [college, setCollege] = useState('')
  const navigate = useNavigate()

  const collegeName = (id: string) => institutions.find((i) => i.id === id)?.name ?? 'College'
  const sortedColleges = useMemo(() => institutions.slice().sort((a, b) => a.name.localeCompare(b.name)), [institutions])

  const [disabledDepts, setDisabledDepts] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!college) {
      setDisabledDepts(new Set())
      return
    }
    return watchInstitutionDepartmentOverrides(college, (o) => setDisabledDepts(new Set(o.filter((x) => !x.enabled).map((x) => x.departmentId))))
  }, [college])

  const presetFor = (instId: string, d: Department) =>
    presets.find((p) => p.institutionId === instId && p.department === d.name && p.mbbsYear === d.mbbsYear)

  // Per-department preset summary, shared by card, row and stat strip.
  const summaries = useMemo(() => {
    const map = new Map<string, PresetSummary>()
    for (const d of departments ?? []) {
      if (college && d.institutionId === '') {
        const own = presetFor(college, d)
        const global = presetFor('', d)
        map.set(
          d.id,
          hasSkills(own)
            ? { count: own.requiredSkills.length, overrides: 0, own: true, scopeText: `${collegeName(college)} preset` }
            : { count: hasSkills(global) ? global.requiredSkills.length : 0, overrides: 0, own: false, scopeText: 'Uses the global preset' },
        )
        continue
      }
      const own = presetFor(d.institutionId, d)
      const overrides =
        d.institutionId === '' ? presets.filter((p) => p.institutionId !== '' && p.department === d.name && p.mbbsYear === d.mbbsYear && hasSkills(p)).length : 0
      map.set(d.id, { count: hasSkills(own) ? own.requiredSkills.length : 0, overrides, own: d.institutionId !== '' && hasSkills(own) })
    }
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [departments, presets, college, institutions])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (departments ?? [])
      .filter((d) => !college || (d.institutionId === '' ? !disabledDepts.has(d.id) : d.institutionId === college))
      .filter((d) => (year === 'all' || d.mbbsYear === year) && (!q || d.name.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name) || a.institutionId.localeCompare(b.institutionId))
  }, [departments, year, search, college, disabledDepts])
  const editorLink = (d: Department) => `${editorBasePath}/${d.id}${college && d.institutionId === '' ? `?college=${college}` : ''}`

  if (departments === null) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20" />
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    )
  }

  // Stats follow the college filter (but not search/year).
  const scoped = college ? departments.filter((d) => (d.institutionId === '' ? !disabledDepts.has(d.id) : d.institutionId === college)) : departments
  const all = scoped.map((d) => summaries.get(d.id)!).filter(Boolean)
  const configured = all.filter((x) => x.count > 0).length

  return (
    <>
      <StatStrip
        stats={[
          { label: college ? 'Departments with a preset' : 'Presets set', value: configured, accent: true },
          { label: 'Departments', value: scoped.length },
          { label: 'Not set yet', value: scoped.length - configured },
          college
            ? { label: 'College’s own presets', value: all.filter((x) => x.own).length }
            : { label: 'College overrides', value: all.reduce((n, x) => n + x.overrides, 0) },
        ]}
      />

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative w-full sm:w-[260px]">
          <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: 'var(--color-char-soft)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search departments"
            className="w-full pl-8 pr-3 py-2 text-[13.5px] border outline-none bg-transparent transition-colors duration-150 focus:border-[var(--color-gold)]"
            style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
          />
        </div>
        <select
          value={college}
          onChange={(e) => setCollege(e.target.value)}
          className="h-[34px] px-2.5 text-[13px] border outline-none bg-transparent max-w-full sm:max-w-[260px] transition-colors focus:border-[var(--color-gold)]"
          style={{ borderColor: college ? 'var(--color-gold)' : 'var(--color-line)', color: 'var(--color-char)' }}
          title="Filter by college"
        >
          <option value="">All colleges</option>
          {sortedColleges.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <SegGroup
          value={year}
          onChange={setYear}
          options={[{ v: 'all', l: 'All years' }, ...MBBS_YEARS.map((y) => ({ v: y, l: `Y${y}` }))]}
        />
        <div className="inline-flex border rounded-[3px] overflow-hidden shrink-0" style={{ borderColor: 'var(--color-line)' }}>
          {(['grid', 'list'] as const).map((m, i) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              title={m === 'grid' ? 'Grid view' : 'List view'}
              className="h-[34px] w-9 flex items-center justify-center transition-colors"
              style={{
                backgroundColor: viewMode === m ? 'var(--color-ink)' : 'transparent',
                color: viewMode === m ? 'var(--color-frost)' : 'var(--color-char-soft)',
                borderLeft: i > 0 ? '1px solid var(--color-line)' : undefined,
              }}
            >
              <Icon name={m} className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
        {(college || search || year !== 'all') && (
          <button
            onClick={() => {
              setCollege('')
              setSearch('')
              setYear('all')
            }}
            className="text-[11.5px] font-medium hover:opacity-70 transition-opacity"
            style={{ color: 'var(--color-gold)' }}
          >
            Clear filters
          </button>
        )}
        <p className="lg:ml-auto text-[12px] leading-relaxed max-w-[300px]" style={{ color: 'var(--color-char-soft)' }}>
          {college ? `Showing ${collegeName(college)}’s departments and the preset its students follow.` : 'A college preset replaces the global one for that college only.'}
        </p>
      </div>

      {departments.length === 0 ? (
        <Card className="chamfer max-w-lg">
          <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            No departments yet — add one on the Departments page first.
          </p>
        </Card>
      ) : filtered.length === 0 ? (
        <Card className="chamfer max-w-lg">
          <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            No departments match{search ? ` "${search}"` : ''}
            {year !== 'all' ? ` in Year ${year}` : ''}
            {college ? ` at ${collegeName(college)}` : ''}.
          </p>
        </Card>
      ) : (
        <div className="space-y-8">
          {MBBS_YEARS.map((y) => {
            const forYear = filtered.filter((d) => d.mbbsYear === y)
            if (forYear.length === 0) return null
            return (
              <div key={y}>
                <div className="flex items-center gap-2 mb-3">
                  <Badge tone="gold">Year {y}</Badge>
                  <span className="text-[11px]" style={{ color: 'var(--color-char-soft)' }}>
                    {forYear.length} department{forYear.length === 1 ? '' : 's'}
                  </span>
                </div>
                {viewMode === 'grid' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {forYear.map((d, i) => (
                      <PresetCard
                        key={d.id}
                        department={d}
                        summary={summaries.get(d.id)!}
                        collegeName={d.institutionId ? collegeName(d.institutionId) : null}
                        index={i}
                        onOpen={() => navigate(editorLink(d))}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="border rounded-[10px] overflow-hidden" style={{ backgroundColor: 'var(--color-paper)', borderColor: BORDER }}>
                    {forYear.map((d, i) => (
                      <PresetRow
                        key={d.id}
                        department={d}
                        summary={summaries.get(d.id)!}
                        collegeName={d.institutionId ? collegeName(d.institutionId) : null}
                        isLast={i === forYear.length - 1}
                        onOpen={() => navigate(editorLink(d))}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

    </>
  )
}

type PresetSummary = { count: number; overrides: number; own?: boolean; scopeText?: string }

// Small segmented control — same as LogTemplatesPage's SegGroup.
function SegGroup<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T | 'all'
  onChange: (v: T | 'all') => void
  options: { v: T | 'all'; l: string }[]
}) {
  return (
    <div className="inline-flex border rounded-[3px] overflow-hidden" style={{ borderColor: 'var(--color-line)' }}>
      {options.map((o, i) => (
        <button
          key={String(o.v)}
          onClick={() => onChange(o.v)}
          className="px-2.5 py-2 text-[12.5px] font-medium transition-colors duration-150"
          style={{
            backgroundColor: value === o.v ? 'var(--color-ink)' : 'transparent',
            color: value === o.v ? 'var(--color-frost)' : 'var(--color-char-soft)',
            borderRight: i < options.length - 1 ? '1px solid var(--color-line)' : undefined,
          }}
        >
          {o.l}
        </button>
      ))}
    </div>
  )
}

// "12 skills required" pill — the ChecklistBadge look from CompetenciesPage.
function SkillsBadge({ count }: { count: number }) {
  return count > 0 ? (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0"
      style={{ borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)' }}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: 'var(--color-gold)' }} />
      {count} skill{count === 1 ? '' : 's'} required
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0"
      style={{ borderColor: 'var(--color-line)', color: 'var(--color-char-soft)' }}
    >
      Not set yet
    </span>
  )
}

function scopeLine(summary: PresetSummary, collegeName: string | null): string {
  if (summary.scopeText) return summary.scopeText
  if (collegeName) return `${collegeName} only`
  if (summary.overrides > 0) return `Global · ${summary.overrides} college override${summary.overrides === 1 ? '' : 's'}`
  return 'Global catalog'
}

// Card in the Competencies-page style: monogram ring, display-font title,
// a quiet meta line, then the status pill. Edit icon reveals on hover.
function PresetCard({
  department,
  summary,
  collegeName,
  index,
  onOpen,
}: {
  department: Department
  summary: PresetSummary
  collegeName: string | null
  index: number
  onOpen: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className="fade-up group text-left rounded-[10px] border p-4 cursor-pointer transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-14px_rgba(11,18,32,0.35)] hover:border-[var(--color-gold-line)]"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)',
        borderColor: 'var(--color-line)',
        animationDelay: `${index * 35}ms`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 flex items-start gap-3">
          <div
            className="shrink-0 h-10 w-10 rounded-full border-[1.5px] flex items-center justify-center font-display text-[16px]"
            style={{ borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)' }}
          >
            {(department.name.trim()[0] ?? '?').toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="font-display text-[16.5px] font-semibold leading-snug break-words" style={{ color: 'var(--color-char)' }}>
              {department.name}
            </div>
            <div className="mt-1 text-[11.5px] leading-relaxed truncate" style={{ color: 'var(--color-char-soft)' }}>
              {scopeLine(summary, collegeName)}
            </div>
          </div>
        </div>
        <span
          className="h-6 w-6 shrink-0 flex items-center justify-center rounded-[3px] opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: 'var(--color-char-soft)' }}
          title="Edit preset"
        >
          <Icon name="edit" className="h-3.5 w-3.5" />
        </span>
      </div>
      <div className="mt-3">
        <SkillsBadge count={summary.count} />
      </div>
    </div>
  )
}

// Compact row — same as DepartmentListRow: year chip, name + meta, status.
function PresetRow({
  department,
  summary,
  collegeName,
  isLast,
  onOpen,
}: {
  department: Department
  summary: PresetSummary
  collegeName: string | null
  isLast: boolean
  onOpen: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className="group flex items-center gap-3.5 px-4 py-3 cursor-pointer transition-colors hover:bg-black/[0.02]"
      style={{ borderBottom: isLast ? undefined : `1px solid ${ROW_LINE}` }}
    >
      <span
        className="shrink-0 inline-flex items-center font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] px-1.5 py-0.5 rounded-[4px]"
        style={{ color: 'var(--color-gold)', backgroundColor: 'color-mix(in srgb, var(--color-gold) 14%, transparent)' }}
      >
        Year {department.mbbsYear}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-display text-[15.5px] leading-snug truncate" style={{ color: 'var(--color-char)' }}>
          {department.name}
        </div>
        <div className="text-[11.5px] truncate" style={{ color: 'var(--color-char-soft)' }}>
          {scopeLine(summary, collegeName)}
        </div>
      </div>
      <SkillsBadge count={summary.count} />
      <span className="h-7 w-7 shrink-0 flex items-center justify-center opacity-60 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--color-char-soft)' }}>
        <Icon name="edit" className="h-3.5 w-3.5" />
      </span>
    </div>
  )
}
