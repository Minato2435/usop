import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { PrincipalShell } from './shell/PrincipalShell'
import { Card, GhostButton, Skeleton } from './shell/ui'
import { Icon } from '../primary-admin/shell/Icon'
import { watchInstitutionUsers, type UserStatus } from '../../lib/firestore/users'
import { watchInstitutionSubmissions } from '../../lib/firestore/submissions'
import { watchCatalogDepartments, watchInstitutionDepartments, watchInstitutionDepartmentOverrides } from '../../lib/firestore/departments'
import type { AppUser, Department, InstitutionDepartmentOverride, Role, Submission } from '../../types'

// Same table-list treatment as Institution Admin's own Users page — a
// bordered container on the page's own paper background, header row +
// hover rows — per explicit direction to match that reference. Read-only
// throughout (no edit/pause/reject row actions): per the build spec,
// Principal "is read-only against operational data," and that extends to
// account management too — this is a directory to monitor, not administer.
const ROLE_LABELS: Record<Role, string> = {
  primaryAdmin: 'Primary Admin',
  institutionAdmin: 'Institution Admin',
  principal: 'Principal',
  hod: 'HOD',
  faculty: 'Faculty',
  student: 'Student',
  skillLabDirector: 'Skill Lab Director',
}
// primaryAdmin and skillLabDirector never have an institutionId, so
// watchInstitutionUsers never returns either — excluded from the filter
// options for that reason, not a visibility decision.
const DIRECTORY_ROLES: Role[] = ['institutionAdmin', 'principal', 'hod', 'faculty', 'student']

function userStatus(u: AppUser): UserStatus {
  if (u.active) return 'active'
  return u.rejected ? 'rejected' : 'paused'
}
const STATUS_LABELS: Record<UserStatus, string> = { active: 'Active', paused: 'Paused', rejected: 'Rejected' }
const STATUS_COLORS: Record<UserStatus, string> = {
  active: 'var(--color-teal)',
  paused: 'var(--color-char-soft)',
  rejected: 'var(--color-clay)',
}

function initials(name: string): string {
  const cleaned = name.replace(/^Dr\.?\s*/i, '').trim()
  const parts = cleaned.split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((w) => w[0]?.toUpperCase() ?? '').join('') || '—'
}

type SortOrder = 'name-asc' | 'name-desc' | 'activities-desc' | 'activities-asc'
const SORT_LABELS: Record<SortOrder, string> = {
  'name-asc': 'Name (A–Z)',
  'name-desc': 'Name (Z–A)',
  'activities-desc': 'Most activity',
  'activities-asc': 'Least activity',
}

export function PrincipalDirectoryPage() {
  const { appUser } = useAuth()
  const institutionId = appUser?.institutionId ?? null

  const [users, setUsers] = useState<AppUser[] | null>(null)
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionUsers(institutionId, setUsers)
  }, [institutionId])

  const [submissions, setSubmissions] = useState<Submission[]>([])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionSubmissions(institutionId, setSubmissions)
  }, [institutionId])

  const [catalogDepts, setCatalogDepts] = useState<Department[]>([])
  const [ownDepts, setOwnDepts] = useState<Department[]>([])
  const [overrides, setOverrides] = useState<InstitutionDepartmentOverride[]>([])
  useEffect(() => watchCatalogDepartments(setCatalogDepts), [])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionDepartments(institutionId, setOwnDepts)
  }, [institutionId])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionDepartmentOverrides(institutionId, setOverrides)
  }, [institutionId])

  // The department filter only lists departments actually available to
  // this institution right now — a catalog department the institution (or
  // Primary Admin) has excluded via override doesn't belong in the list,
  // same "absence of an override means included" rule the toggle pages
  // use — applied to the institution's own departments too, since their
  // toggle lives in the same override collection.
  const availableDepartments = useMemo(() => {
    const isEnabled = (id: string) => overrides.find((o) => o.departmentId === id)?.enabled ?? true
    return [...catalogDepts, ...ownDepts].filter((d) => isEnabled(d.id)).sort((a, b) => a.name.localeCompare(b.name))
  }, [catalogDepts, ownDepts, overrides])
  const departmentName = useMemo(() => {
    const map = new Map([...catalogDepts, ...ownDepts].map((d) => [d.id, d.name]))
    return (id: string | null) => (id ? map.get(id) ?? '—' : null)
  }, [catalogDepts, ownDepts])
  // A student is bound by year only — every department enabled for the
  // college in their year applies — so a student "belongs" to a department
  // exactly when their year matches it. Every other role still uses its
  // own departmentId.
  const departmentDisplay = useMemo(() => {
    return (u: AppUser) => (u.role === 'student' ? (u.mbbsYear ? `All Year ${u.mbbsYear}` : null) : departmentName(u.departmentId))
  }, [departmentName])
  const departmentYear = useMemo(() => {
    const map = new Map([...catalogDepts, ...ownDepts].map((d) => [d.id, d.mbbsYear]))
    return (id: string) => map.get(id) ?? null
  }, [catalogDepts, ownDepts])

  const activityCounts = useMemo(() => {
    const map = new Map<string, { total: number; pending: number; asFaculty: boolean }>()
    for (const s of submissions) {
      if (s.status !== 'draft' && s.studentId) {
        const row = map.get(s.studentId) ?? { total: 0, pending: 0, asFaculty: false }
        row.total++
        if (s.status === 'submitted') row.pending++
        map.set(s.studentId, row)
      }
      if (s.status !== 'draft' && s.facultyId) {
        const row = map.get(s.facultyId) ?? { total: 0, pending: 0, asFaculty: true }
        row.total++
        row.asFaculty = true
        if (s.status === 'submitted') row.pending++
        map.set(s.facultyId, row)
      }
    }
    return map
  }, [submissions])

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all')
  const [departmentFilter, setDepartmentFilter] = useState<string | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | UserStatus>('all')
  const [sortOrder, setSortOrder] = useState<SortOrder>('name-asc')

  const loading = users === null
  const list = users ?? []

  const term = search.trim().toLowerCase()
  const activityOf = (uid: string) => activityCounts.get(uid)?.total ?? 0
  const filtered = list
    .filter(
      (u) =>
        (roleFilter === 'all' || u.role === roleFilter) &&
        (departmentFilter === 'all' ||
          (u.role === 'student' ? u.mbbsYear != null && u.mbbsYear === departmentYear(departmentFilter) : u.departmentId === departmentFilter)) &&
        (statusFilter === 'all' || userStatus(u) === statusFilter) &&
        (term === '' || u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term) || (u.phone ?? '').includes(term)),
    )
    .sort((a, b) => {
      if (sortOrder === 'name-asc') return a.name.localeCompare(b.name)
      if (sortOrder === 'name-desc') return b.name.localeCompare(a.name)
      if (sortOrder === 'activities-desc') return activityOf(b.uid) - activityOf(a.uid)
      return activityOf(a.uid) - activityOf(b.uid)
    })

  const filtersActive = roleFilter !== 'all' || departmentFilter !== 'all' || statusFilter !== 'all' || search !== ''

  return (
    <PrincipalShell eyebrow="Institution-wide" title="Institution Directory">
      {!loading && (
        <p className="text-[13px] mb-5" style={{ color: 'var(--color-char-soft)' }}>
          {filtered.length} of {list.length} account{list.length === 1 ? '' : 's'}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative w-full sm:w-[240px]">
          <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: 'var(--color-char-soft)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, or phone"
            className="w-full pl-8 pr-3 py-2 text-[13.5px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]"
            style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as Role | 'all')}
          className="px-3 py-2 text-[13px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]"
          style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)', backgroundColor: 'var(--color-paper)' }}
        >
          <option value="all">All roles</option>
          {DIRECTORY_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <select
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          className="px-3 py-2 text-[13px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]"
          style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)', backgroundColor: 'var(--color-paper)' }}
        >
          <option value="all">All departments</option>
          {availableDepartments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} · Year {d.mbbsYear}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | UserStatus)}
          className="px-3 py-2 text-[13px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]"
          style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)', backgroundColor: 'var(--color-paper)' }}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="rejected">Rejected</option>
        </select>
        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as SortOrder)}
          className="px-3 py-2 text-[13px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]"
          style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)', backgroundColor: 'var(--color-paper)' }}
        >
          {(Object.keys(SORT_LABELS) as SortOrder[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>
        {filtersActive && (
          <GhostButton
            onClick={() => {
              setRoleFilter('all')
              setDepartmentFilter('all')
              setStatusFilter('all')
              setSearch('')
            }}
          >
            Clear filters
          </GhostButton>
        )}
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-64" />
        </div>
      ) : filtered.length === 0 ? (
        <Card elevated>
          <div className="text-center py-8">
            <div className="font-display text-[20px] mb-1.5" style={{ color: 'var(--color-char)' }}>
              No one matches these filters
            </div>
            <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
              Clear the filters to see everyone again.
            </p>
          </div>
        </Card>
      ) : (
        <div
          className="rounded-[10px] overflow-hidden border"
          style={{ backgroundColor: 'var(--color-paper)', borderColor: 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)' }}
        >
          <div className="overflow-x-auto">
            <div className="min-w-[920px]">
              <div
                className="flex items-center gap-4 px-5 py-3 border-b text-[10.5px] font-semibold uppercase tracking-[0.08em]"
                style={{ borderColor: 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)', color: 'var(--color-char-soft)' }}
              >
                <div className="flex-[2] min-w-[220px]">Name</div>
                <div className="w-[130px] shrink-0">Role</div>
                <div className="w-[160px] shrink-0">Department</div>
                <div className="w-[150px] shrink-0">Activities</div>
                <div className="w-[92px] shrink-0">Status</div>
              </div>

              {filtered.map((u) => {
                const status = userStatus(u)
                const counts = activityCounts.get(u.uid)
                return (
                  <div
                    key={u.uid}
                    className="flex items-center gap-4 px-5 py-3.5 border-b last:border-0 transition-colors duration-100 hover:bg-black/[0.015]"
                    style={{ borderColor: 'color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)' }}
                  >
                    <div className="flex-[2] min-w-[220px] flex items-center gap-3">
                      <span
                        className="shrink-0 h-9 w-9 rounded-full border flex items-center justify-center font-display text-[14px]"
                        style={{ borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)' }}
                      >
                        {initials(u.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-display text-[16px] leading-tight truncate" style={{ color: 'var(--color-char)' }}>
                          {u.name}
                        </span>
                        <span className="block font-mono text-[11.5px] truncate" style={{ color: 'var(--color-char-soft)' }}>
                          {u.email}
                        </span>
                        {u.phone && (
                          <span className="block font-mono text-[11.5px] truncate" style={{ color: 'var(--color-char-soft)' }}>
                            +91 {u.phone}
                          </span>
                        )}
                      </span>
                    </div>

                    <div className="w-[130px] shrink-0">
                      <span
                        className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border"
                        style={{ borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)' }}
                      >
                        {ROLE_LABELS[u.role]}
                      </span>
                    </div>

                    <div className="w-[160px] shrink-0 text-[13px] truncate" style={{ color: 'var(--color-char-soft)' }}>
                      {departmentDisplay(u) ?? '—'}
                    </div>

                    <div className="w-[150px] shrink-0 text-[12.5px]" style={{ color: 'var(--color-char)' }}>
                      {counts ? (
                        <>
                          {counts.total} {counts.asFaculty ? 'reviewed' : 'logged'}
                          {counts.pending > 0 && (
                            <span className="ml-1.5" style={{ color: 'var(--color-gold)' }}>
                              · {counts.pending} pending
                            </span>
                          )}
                        </>
                      ) : (
                        <span style={{ color: 'var(--color-char-soft)' }}>—</span>
                      )}
                    </div>

                    <div className="w-[92px] shrink-0">
                      <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: STATUS_COLORS[status] }}>
                        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLORS[status] }} />
                        {STATUS_LABELS[status]}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </PrincipalShell>
  )
}
