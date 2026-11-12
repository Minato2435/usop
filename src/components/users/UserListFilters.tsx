import { useEffect, useMemo, useState } from 'react'
import { Icon } from '../../roles/primary-admin/shell/Icon'
import { GhostButton } from '../../roles/primary-admin/shell/ui'
import type { UserStatus } from '../../lib/firestore/users'
import type { AppUser, Department, Institution, InstitutionDepartmentOverride, MbbsYear, Role } from '../../types'

// Filters + sorting shared by the Primary Admin and Institution Admin Users
// pages. Year and department follow the app's own model: a student is in
// one MBBS year and belongs to every department switched on for their
// college in that year; faculty teach their associated years in one
// department; an HOD heads one department (that department's year).

export type UserSort = 'name-asc' | 'name-desc' | 'year-asc' | 'year-desc' | 'reg-asc' | 'reg-desc' | 'department' | 'role' | 'college' | 'status'

export interface UserFilters {
  search: string
  role: Role | 'all'
  institutionId: string // 'all' or an id
  department: string // 'all' or a department name
  year: 'all' | `${MbbsYear}`
  status: 'all' | UserStatus
  sort: UserSort
}
export const DEFAULT_USER_FILTERS: UserFilters = {
  search: '',
  role: 'all',
  institutionId: 'all',
  department: 'all',
  year: 'all',
  status: 'all',
  sort: 'name-asc',
}

const SORT_LABELS: Record<UserSort, string> = {
  'name-asc': 'Name A–Z',
  'name-desc': 'Name Z–A',
  'year-asc': 'Year 1 → 4',
  'year-desc': 'Year 4 → 1',
  'reg-asc': 'Reg. no. ascending',
  'reg-desc': 'Reg. no. descending',
  department: 'Department A–Z',
  role: 'Role (senior first)',
  college: 'College A–Z',
  status: 'Status (active first)',
}
const ROLE_RANK: Record<Role, number> = { primaryAdmin: 0, skillLabDirector: 1, institutionAdmin: 2, principal: 3, hod: 4, faculty: 5, student: 6 }
const STATUS_RANK: Record<UserStatus, number> = { active: 0, paused: 1, rejected: 2 }

export function userStatusOf(u: AppUser): UserStatus {
  if (u.active) return 'active'
  return u.rejected ? 'rejected' : 'paused'
}

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

// Year / department facts for each user, derived from the department list
// and each college's on/off switches.
export function useUserAcademics(departments: Department[], overrides: InstitutionDepartmentOverride[]) {
  return useMemo(() => {
    const deptById = new Map(departments.map((d) => [d.id, d]))
    const off = new Map<string, Set<string>>()
    for (const o of overrides) {
      if (o.enabled) continue
      if (!off.has(o.institutionId)) off.set(o.institutionId, new Set())
      off.get(o.institutionId)!.add(o.departmentId)
    }
    const studentDeptCache = new Map<string, Department[]>()
    function studentDepartments(u: AppUser): Department[] {
      if (!u.mbbsYear || !u.institutionId) return []
      const key = `${u.institutionId}|${u.mbbsYear}`
      let hit = studentDeptCache.get(key)
      if (!hit) {
        const disabled = off.get(u.institutionId)
        hit = departments.filter((d) => (d.institutionId === '' || d.institutionId === u.institutionId) && d.mbbsYear === u.mbbsYear && !disabled?.has(d.id))
        studentDeptCache.set(key, hit)
      }
      return hit
    }
    function years(u: AppUser): MbbsYear[] {
      if (u.role === 'student') return u.mbbsYear ? [u.mbbsYear] : []
      if (u.role === 'faculty') return u.associatedMbbsYears ?? []
      if (u.role === 'hod') {
        const d = u.departmentId ? deptById.get(u.departmentId) : undefined
        return d ? [d.mbbsYear] : []
      }
      return []
    }
    function departmentNames(u: AppUser): string[] {
      if (u.role === 'student') return studentDepartments(u).map((d) => d.name)
      if (u.role === 'faculty' || u.role === 'hod') {
        const d = u.departmentId ? deptById.get(u.departmentId) : undefined
        return d ? [d.name] : []
      }
      return []
    }
    // Two short lines for the table's "Year · Department" column.
    function academic(u: AppUser): { main: string; sub: string | null } {
      if (u.role === 'student') return { main: u.mbbsYear ? `Year ${u.mbbsYear}` : '—', sub: null }
      if (u.role === 'faculty' || u.role === 'hod') {
        const d = u.departmentId ? deptById.get(u.departmentId) : undefined
        const ys = years(u)
        return { main: d?.name ?? '—', sub: ys.length ? `${u.role === 'hod' ? 'HOD · ' : ''}Year${ys.length > 1 ? 's' : ''} ${ys.join(', ')}` : null }
      }
      return { main: '—', sub: null }
    }
    // Department names offered in the filter: the chosen college's switched-on
    // departments (or every department when no college is chosen), narrowed
    // to the chosen year.
    function departmentOptions(institutionId: string | null, year: MbbsYear | null): string[] {
      const disabled = institutionId ? off.get(institutionId) : undefined
      const names = departments
        .filter((d) => (institutionId ? (d.institutionId === '' || d.institutionId === institutionId) && !disabled?.has(d.id) : true))
        .filter((d) => (year ? d.mbbsYear === year : true))
        .map((d) => d.name)
      return [...new Set(names)].sort((a, b) => a.localeCompare(b))
    }
    return { years, departmentNames, academic, departmentOptions }
  }, [departments, overrides])
}
export type UserAcademics = ReturnType<typeof useUserAcademics>

export function applyUserFilters(users: AppUser[], f: UserFilters, ac: UserAcademics, institutionName: (id: string | null) => string | null): AppUser[] {
  const q = f.search.trim().toLowerCase()
  const qDigits = q.replace(/\D/g, '')
  const year = f.year === 'all' ? null : (Number(f.year) as MbbsYear)
  const out = users.filter((u) => {
    if (f.role !== 'all' && u.role !== f.role) return false
    if (f.institutionId !== 'all' && u.institutionId !== f.institutionId) return false
    if (f.status !== 'all' && userStatusOf(u) !== f.status) return false
    if (year && !ac.years(u).includes(year)) return false
    if (f.department !== 'all' && !ac.departmentNames(u).includes(f.department)) return false
    if (q) {
      const hit =
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        (u.rollNumber ?? '').toLowerCase().includes(q) ||
        (qDigits.length >= 3 && (u.phone ?? '').includes(qDigits))
      if (!hit) return false
    }
    return true
  })

  const byName = (a: AppUser, b: AppUser) => a.name.localeCompare(b.name)
  const firstYear = (u: AppUser) => (ac.years(u)[0] ?? 99) as number
  const lastYear = (u: AppUser) => {
    const ys = ac.years(u)
    return ys.length ? ys[ys.length - 1] : -1
  }
  const dept = (u: AppUser) => (u.role === 'faculty' || u.role === 'hod' ? (ac.departmentNames(u)[0] ?? '') : '')
  // Anyone without the sorted-by value goes last, then by name.
  const lastIfEmpty = (a: string, b: string) => (a && !b ? -1 : !a && b ? 1 : 0)
  const cmp: Record<UserSort, (a: AppUser, b: AppUser) => number> = {
    'name-asc': byName,
    'name-desc': (a, b) => byName(b, a),
    'year-asc': (a, b) => firstYear(a) - firstYear(b) || byName(a, b),
    'year-desc': (a, b) => lastYear(b) - lastYear(a) || byName(a, b),
    'reg-asc': (a, b) => lastIfEmpty(a.rollNumber ?? '', b.rollNumber ?? '') || natural.compare(a.rollNumber ?? '', b.rollNumber ?? '') || byName(a, b),
    'reg-desc': (a, b) => lastIfEmpty(a.rollNumber ?? '', b.rollNumber ?? '') || natural.compare(b.rollNumber ?? '', a.rollNumber ?? '') || byName(a, b),
    department: (a, b) => lastIfEmpty(dept(a), dept(b)) || dept(a).localeCompare(dept(b)) || byName(a, b),
    role: (a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role] || byName(a, b),
    college: (a, b) => {
      const x = institutionName(a.institutionId) ?? ''
      const y = institutionName(b.institutionId) ?? ''
      return lastIfEmpty(x, y) || x.localeCompare(y) || byName(a, b)
    },
    status: (a, b) => STATUS_RANK[userStatusOf(a)] - STATUS_RANK[userStatusOf(b)] || byName(a, b),
  }
  return out.sort(cmp[f.sort])
}

export function activeFilterCount(f: UserFilters, ignore: (keyof UserFilters)[] = []): number {
  return (Object.keys(DEFAULT_USER_FILTERS) as (keyof UserFilters)[]).filter((k) => k !== 'sort' && !ignore.includes(k) && f[k] !== DEFAULT_USER_FILTERS[k]).length
}

// Filters survive leaving the page (e.g. to Bulk add and back) for this
// browser tab only.
export function useStoredUserFilters(key: string, { departmentNeedsCollege = false } = {}): [UserFilters, (f: UserFilters) => void] {
  const [f, setF] = useState<UserFilters>(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? '{}') as Record<string, unknown>
      const next = { ...DEFAULT_USER_FILTERS }
      for (const k of Object.keys(DEFAULT_USER_FILTERS) as (keyof UserFilters)[]) {
        if (typeof saved[k] === 'string') (next as Record<string, string>)[k] = saved[k] as string
      }
      if (departmentNeedsCollege && next.institutionId === 'all') next.department = 'all'
      return next
    } catch {
      return DEFAULT_USER_FILTERS
    }
  })
  useEffect(() => {
    try {
      sessionStorage.setItem(key, JSON.stringify(f))
    } catch {
      /* storage unavailable — filters just reset next time */
    }
  }, [key, f])
  return [f, setF]
}

// The table's "Year · Department" cell.
export function AcademicCell({ academic }: { academic: { main: string; sub: string | null } }) {
  return (
    <div className="w-[160px] shrink-0 min-w-0">
      <div className="text-[13px] truncate" style={{ color: academic.main === '—' ? 'var(--color-char-soft)' : 'var(--color-char)' }}>
        {academic.main}
      </div>
      {academic.sub && (
        <div className="font-mono text-[11px] truncate" style={{ color: 'var(--color-char-soft)' }}>
          {academic.sub}
        </div>
      )}
    </div>
  )
}

// ── Toolbar ─────────────────────────────────────────────────────────────

const SELECT = 'h-9 px-2.5 text-[13px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]'
const selectStyle = (on: boolean) => ({
  borderColor: on ? 'var(--color-gold)' : 'var(--color-line)',
  color: on ? 'var(--color-gold)' : 'var(--color-char)',
  backgroundColor: on ? 'color-mix(in srgb, var(--color-gold) 7%, var(--color-paper))' : 'var(--color-paper)',
})

const ROLE_LABELS: Record<Role, string> = {
  primaryAdmin: 'Primary Admin',
  institutionAdmin: 'Institution Admin',
  principal: 'Principal',
  hod: 'HOD',
  faculty: 'Faculty',
  student: 'Student',
  skillLabDirector: 'Skill Lab Director',
}

export function UserFilterBar({
  f,
  onChange,
  ac,
  roles,
  institutions,
  lockedInstitutionId,
  shown,
  total,
}: {
  f: UserFilters
  onChange: (next: UserFilters) => void
  ac: UserAcademics
  roles?: Role[] // show a Role select with these options
  institutions?: Institution[] // show a College select
  lockedInstitutionId?: string // Institution Admin's own college (department options)
  shown: number
  total: number
}) {
  const set = <K extends keyof UserFilters>(k: K, v: UserFilters[K]) => onChange({ ...f, [k]: v })
  const college = lockedInstitutionId ?? (f.institutionId === 'all' ? null : f.institutionId)
  const year = f.year === 'all' ? null : (Number(f.year) as MbbsYear)
  const deptOptions = ac.departmentOptions(college, year)
  const count = activeFilterCount(f, institutions ? [] : ['institutionId'])
  const sortedInstitutions = useMemo(() => [...(institutions ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [institutions])

  return (
    <div className="mb-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative w-full sm:w-[280px]">
          <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: 'var(--color-char-soft)' }} />
          <input
            value={f.search}
            onChange={(e) => set('search', e.target.value)}
            placeholder="Search name, email, mobile or reg. no."
            className="w-full h-9 pl-8 pr-8 text-[13.5px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]"
            style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)', backgroundColor: 'var(--color-paper)' }}
          />
          {f.search && (
            <button
              onClick={() => set('search', '')}
              title="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded-[3px] hover:bg-black/[0.06]"
              style={{ color: 'var(--color-char-soft)' }}
            >
              <Icon name="close" className="h-3 w-3" />
            </button>
          )}
        </div>

        {roles && (
          <select value={f.role} onChange={(e) => set('role', e.target.value as Role | 'all')} className={SELECT} style={selectStyle(f.role !== 'all')}>
            <option value="all">All roles</option>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        )}

        {institutions && (
          <select
            value={f.institutionId}
            // A different college has different departments: start the department over.
            onChange={(e) => onChange({ ...f, institutionId: e.target.value, department: 'all' })}
            className={`${SELECT} max-w-[220px]`}
            style={selectStyle(f.institutionId !== 'all')}
          >
            <option value="all">All colleges</option>
            {sortedInstitutions.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        )}

        <select
          value={f.year}
          onChange={(e) => {
            const nextYear = e.target.value as UserFilters['year']
            const opts = ac.departmentOptions(college, nextYear === 'all' ? null : (Number(nextYear) as MbbsYear))
            onChange({ ...f, year: nextYear, department: f.department !== 'all' && !opts.includes(f.department) ? 'all' : f.department })
          }}
          className={SELECT}
          style={selectStyle(f.year !== 'all')}
        >
          <option value="all">All years</option>
          {[1, 2, 3, 4].map((y) => (
            <option key={y} value={y}>
              Year {y}
            </option>
          ))}
        </select>

        {/* Departments differ per college, so this opens only once a college is chosen. */}
        <select
          value={college ? f.department : 'all'}
          onChange={(e) => set('department', e.target.value)}
          disabled={!college}
          title={college ? undefined : 'Choose a college first'}
          className={`${SELECT} max-w-[220px] disabled:opacity-50 disabled:cursor-not-allowed`}
          style={selectStyle(!!college && f.department !== 'all')}
        >
          <option value="all">{college ? 'All departments' : 'Department — pick a college first'}</option>
          {f.department !== 'all' && !deptOptions.includes(f.department) && <option value={f.department}>{f.department}</option>}
          {deptOptions.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>

        <select value={f.status} onChange={(e) => set('status', e.target.value as UserFilters['status'])} className={SELECT} style={selectStyle(f.status !== 'all')}>
          <option value="all">Any status</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="rejected">Rejected</option>
        </select>

        <span className="flex-1" />

        <label className="inline-flex items-center gap-2 text-[12px]" style={{ color: 'var(--color-char-soft)' }}>
          <span className="uppercase tracking-[0.08em] text-[10.5px] font-semibold">Sort</span>
          <select value={f.sort} onChange={(e) => set('sort', e.target.value as UserSort)} className={SELECT} style={selectStyle(false)}>
            {(Object.keys(SORT_LABELS) as UserSort[])
              .filter((s) => s !== 'college' || institutions)
              .map((s) => (
                <option key={s} value={s}>
                  {SORT_LABELS[s]}
                </option>
              ))}
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3 text-[12.5px]" style={{ color: 'var(--color-char-soft)' }}>
        <span>
          Showing <span className="font-mono" style={{ color: 'var(--color-char)' }}>{shown}</span> of <span className="font-mono">{total}</span>
          {count > 0 && ` · ${count} filter${count === 1 ? '' : 's'} on`}
          {f.department !== 'all' && ' · students count in every department of their year'}
        </span>
        {count > 0 && (
          <GhostButton
            onClick={() =>
              onChange({ ...DEFAULT_USER_FILTERS, sort: f.sort, institutionId: institutions ? 'all' : f.institutionId })
            }
          >
            Clear filters
          </GhostButton>
        )}
      </div>
    </div>
  )
}
