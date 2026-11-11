import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { Card, Skeleton } from '../../roles/primary-admin/shell/ui'
import { Icon } from '../../roles/primary-admin/shell/Icon'
import { FileKindTile, OpenDownloadButtons, fmtDay } from './ResourceShared'
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
  const kindCounts = useMemo(() => {
    const m = new Map<ResourceKind, number>()
    visible.forEach((r) => m.set(r.kind, (m.get(r.kind) ?? 0) + 1))
    return m
  }, [visible])

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = visible
      .filter((r) => (kind === 'all' || r.kind === kind) && (q === '' || r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)))
      .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt))
    const map = new Map<string, Resource[]>()
    for (const r of list) map.set(r.department, [...(map.get(r.department) ?? []), r])
    const keys = [...map.keys()].sort((a, b) => (a === ALL_DEPARTMENTS ? -1 : b === ALL_DEPARTMENTS ? 1 : a.localeCompare(b)))
    return keys.map((k) => ({ key: k, title: k === ALL_DEPARTMENTS ? 'General' : k, hint: k === ALL_DEPARTMENTS ? 'For every department' : undefined, items: map.get(k)! }))
  }, [visible, search, kind])

  const loading =
    resources === null || overrides === null || (audience === 'student' ? studentDeptsLoading : staffDept === undefined)
  const noProfile = !institutionId || (audience === 'student' && !appUser?.mbbsYear)
  const now = Date.now()

  return (
    <Shell eyebrow={audience === 'student' ? (appUser?.mbbsYear ? `Year ${appUser.mbbsYear}` : 'Study material') : (staffDept?.name ?? 'Study material')} title="Resources">
      <p className="text-[13px] mb-5 -mt-1" style={{ color: 'var(--color-char-soft)' }}>
        Handouts, notes, slides and reference images shared by your college and the platform.
      </p>

      {noProfile ? (
        <Card className="max-w-lg">
          <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            Your profile isn’t linked to a college{audience === 'student' ? ' and year' : ''} yet — ask your institution admin.
          </p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2.5 mb-6">
            <div className="relative flex-1 min-w-[200px] max-w-[320px]">
              <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: 'var(--color-char-soft)' }} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search resources…"
                className="w-full pl-9 pr-3 py-2 text-[13px] rounded-full border outline-none transition-colors focus:border-[var(--color-gold)]"
                style={{ borderColor: 'var(--color-line)', backgroundColor: 'var(--color-paper-raised)', color: 'var(--color-char)' }}
              />
            </div>
            {(['all', ...(Object.keys(RESOURCE_KIND_LABELS) as ResourceKind[])] as const)
              .filter((k) => k === 'all' || kindCounts.has(k))
              .map((k) => {
                const active = kind === k
                return (
                  <button
                    key={k}
                    onClick={() => setKind(k)}
                    className="rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors"
                    style={{
                      borderColor: active ? 'var(--color-ink)' : 'var(--color-line)',
                      backgroundColor: active ? 'var(--color-ink)' : 'var(--color-paper-raised)',
                      color: active ? 'var(--color-frost)' : 'var(--color-char-soft)',
                    }}
                  >
                    {k === 'all' ? 'All' : RESOURCE_KIND_LABELS[k]}
                    <span className="ml-1.5 tabular-nums opacity-70">{k === 'all' ? visible.length : kindCounts.get(k)}</span>
                  </button>
                )
              })}
          </div>

          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-28 rounded-[12px]" />
              <Skeleton className="h-28 rounded-[12px]" />
              <Skeleton className="h-28 rounded-[12px]" />
            </div>
          ) : groups.length === 0 ? (
            <Card className="text-center py-10">
              <Icon name="resources" className="h-6 w-6 mx-auto mb-2" style={{ color: 'var(--color-gold)' }} />
              <p className="text-[13.5px]" style={{ color: 'var(--color-char)' }}>
                {visible.length === 0 ? 'No resources have been shared with you yet.' : 'Nothing matches your search.'}
              </p>
            </Card>
          ) : (
            <div className="flex flex-col gap-8">
              {groups.map((g) => (
                <section key={g.key}>
                  <div className="flex items-baseline gap-3 mb-3">
                    <span className="font-display text-[13px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--color-char)' }}>
                      {g.title}
                    </span>
                    {g.hint && (
                      <span className="text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
                        {g.hint}
                      </span>
                    )}
                    <span className="flex-1 h-px" style={{ backgroundColor: 'var(--color-line)' }} />
                    <span className="text-[11.5px] tabular-nums" style={{ color: 'var(--color-char-soft)' }}>
                      {g.items.length}
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {g.items.map((r, i) => (
                      <article
                        key={r.id}
                        className="fade-up rounded-[12px] border p-4 flex flex-col gap-3 transition-shadow hover:shadow-[0_10px_24px_-16px_rgba(11,18,32,0.35)]"
                        style={{
                          backgroundColor: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)',
                          borderColor: 'var(--color-line)',
                          animationDelay: `${i * 30}ms`,
                        }}
                      >
                        <div className="flex items-start gap-3.5">
                          <FileKindTile kind={r.kind} size={40} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start gap-2">
                              <h3 className="font-display text-[16.5px] leading-snug break-words flex-1" style={{ color: 'var(--color-char)' }}>
                                {r.title}
                              </h3>
                              {now - r.createdAt < NEW_FOR_MS && (
                                <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]" style={{ backgroundColor: 'var(--color-gold-soft)', color: 'var(--color-gold)' }}>
                                  New
                                </span>
                              )}
                            </div>
                            {r.description && (
                              <p className="text-[12.5px] mt-1 leading-relaxed line-clamp-2" style={{ color: 'var(--color-char-soft)' }}>
                                {r.description}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 flex-wrap mt-auto">
                          <span className="font-mono text-[11px] flex-1 min-w-0 truncate" style={{ color: 'var(--color-char-soft)' }}>
                            {RESOURCE_KIND_LABELS[r.kind]} · {formatBytes(r.size)} · {fmtDay(r.updatedAt ?? r.createdAt)}
                            {r.institutionId ? ' · Your college' : ''}
                          </span>
                          <OpenDownloadButtons resource={r} compact />
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </>
      )}
    </Shell>
  )
}
