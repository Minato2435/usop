import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { HodShell } from './shell/HodShell'
import { Skeleton, inputClass } from './shell/ui'
import { Icon } from '../primary-admin/shell/Icon'
import { watchDepartmentUsers } from '../../lib/firestore/users'
import { watchDepartmentSubmissions } from '../../lib/firestore/submissions'
import type { AppUser, MbbsYear, Submission } from '../../types'

type SortOrder = 'name-asc' | 'name-desc' | 'activities-desc' | 'activities-asc' | 'year-asc' | 'year-desc'
const SORT_LABELS: Record<SortOrder, string> = {
  'name-asc': 'Name (A–Z)',
  'name-desc': 'Name (Z–A)',
  'activities-desc': 'Most activities',
  'activities-asc': 'Fewest activities',
  'year-asc': 'Year (1 → 4)',
  'year-desc': 'Year (4 → 1)',
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((w) => w[0]?.toUpperCase() ?? '').join('') || '—'
}

// Same table-list treatment as Primary Admin's Users page — a bordered
// container sitting directly on the page's own paper background (not a
// white Card), header row + hover rows, rather than a grid of cards —
// per explicit direction to match that admin reference here.
export function HodStudentsPage() {
  const { appUser } = useAuth()
  const institutionId = appUser?.institutionId ?? null
  const departmentId = appUser?.departmentId ?? null

  const [users, setUsers] = useState<AppUser[] | null>(null)
  useEffect(() => {
    if (!institutionId || !departmentId) return
    return watchDepartmentUsers(institutionId, departmentId, setUsers)
  }, [institutionId, departmentId])

  const [submissions, setSubmissions] = useState<Submission[]>([])
  useEffect(() => {
    if (!institutionId || !departmentId) return
    return watchDepartmentSubmissions(institutionId, departmentId, setSubmissions)
  }, [institutionId, departmentId])

  const activityCounts = useMemo(() => {
    const map = new Map<string, { total: number; pending: number }>()
    for (const s of submissions) {
      if (s.status === 'draft') continue
      const row = map.get(s.studentId) ?? { total: 0, pending: 0 }
      row.total++
      if (s.status === 'submitted') row.pending++
      map.set(s.studentId, row)
    }
    return map
  }, [submissions])

  const [search, setSearch] = useState('')
  const [yearFilter, setYearFilter] = useState<MbbsYear | 'all'>('all')
  const [sortOrder, setSortOrder] = useState<SortOrder>('name-asc')

  const students = useMemo(() => (users ?? []).filter((u) => u.role === 'student'), [users])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const list = students.filter(
      (s) =>
        (yearFilter === 'all' || s.mbbsYear === yearFilter) &&
        (term === '' || s.name.toLowerCase().includes(term) || (s.rollNumber ?? '').toLowerCase().includes(term)),
    )
    const total = (uid: string) => activityCounts.get(uid)?.total ?? 0
    return list.sort((a, b) => {
      if (sortOrder === 'name-asc') return a.name.localeCompare(b.name)
      if (sortOrder === 'name-desc') return b.name.localeCompare(a.name)
      if (sortOrder === 'activities-desc') return total(b.uid) - total(a.uid)
      if (sortOrder === 'activities-asc') return total(a.uid) - total(b.uid)
      if (sortOrder === 'year-asc') return (a.mbbsYear ?? 0) - (b.mbbsYear ?? 0)
      return (b.mbbsYear ?? 0) - (a.mbbsYear ?? 0)
    })
  }, [students, search, yearFilter, sortOrder, activityCounts])

  const loading = users === null

  return (
    <HodShell eyebrow={`${students.length} in your department`} title="Students">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative w-full sm:w-[260px]">
          <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: 'var(--color-char-soft)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or registration ID"
            className="w-full pl-8 pr-3 py-2 text-[13.5px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]"
            style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
          />
        </div>
        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value === 'all' ? 'all' : (Number(e.target.value) as MbbsYear))}
          className={inputClass}
          style={{ width: 140, borderColor: 'var(--color-line)', color: 'var(--color-char)', backgroundColor: 'var(--color-paper)' }}
        >
          <option value="all">All years</option>
          {[1, 2, 3, 4].map((y) => (
            <option key={y} value={y}>
              Year {y}
            </option>
          ))}
        </select>
        <select
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value as SortOrder)}
          className={inputClass}
          style={{ width: 172, borderColor: 'var(--color-line)', color: 'var(--color-char)', backgroundColor: 'var(--color-paper)' }}
        >
          {(Object.keys(SORT_LABELS) as SortOrder[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABELS[key]}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-64" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-[10px] border py-10 text-center" style={{ borderColor: 'var(--color-line)' }}>
          <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            {students.length === 0 ? 'No students are assigned to your department yet.' : 'No students match these filters.'}
          </p>
        </div>
      ) : (
        <div
          className="rounded-[10px] overflow-hidden border"
          style={{
            backgroundColor: 'var(--color-paper)',
            borderColor: 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)',
          }}
        >
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div
                className="flex items-center gap-4 px-5 py-3 border-b text-[10.5px] font-semibold uppercase tracking-[0.08em]"
                style={{
                  borderColor: 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)',
                  color: 'var(--color-char-soft)',
                }}
              >
                <div className="flex-[2] min-w-[220px]">Name</div>
                <div className="w-[150px] shrink-0">Registration ID</div>
                <div className="w-[90px] shrink-0">Year</div>
                <div className="w-[150px] shrink-0">Activities</div>
              </div>

              {filtered.map((s) => {
                const counts = activityCounts.get(s.uid)
                return (
                  <div
                    key={s.uid}
                    className="flex items-center gap-4 px-5 py-3.5 border-b last:border-0 transition-colors duration-100 hover:bg-black/[0.015]"
                    style={{ borderColor: 'color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)' }}
                  >
                    <div className="flex-[2] min-w-[220px] flex items-center gap-3">
                      <span
                        className="shrink-0 h-9 w-9 rounded-full border flex items-center justify-center font-display text-[14px]"
                        style={{ borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)' }}
                      >
                        {initials(s.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-display text-[16px] leading-tight truncate" style={{ color: 'var(--color-char)' }}>
                          {s.name}
                        </span>
                        <span className="block font-mono text-[11.5px] truncate" style={{ color: 'var(--color-char-soft)' }}>
                          {s.email}
                        </span>
                      </span>
                    </div>

                    <div className="w-[150px] shrink-0 font-mono text-[12.5px] truncate" style={{ color: 'var(--color-char-soft)' }}>
                      {s.rollNumber ?? '—'}
                    </div>

                    <div className="w-[90px] shrink-0 text-[13px]" style={{ color: 'var(--color-char)' }}>
                      {s.mbbsYear ? `Year ${s.mbbsYear}` : '—'}
                    </div>

                    <div className="w-[150px] shrink-0 text-[12.5px]" style={{ color: 'var(--color-char)' }}>
                      {counts ? (
                        <>
                          {counts.total} logged
                          {counts.pending > 0 && (
                            <span className="ml-1.5" style={{ color: 'var(--color-gold)' }}>
                              · {counts.pending} pending
                            </span>
                          )}
                        </>
                      ) : (
                        <span style={{ color: 'var(--color-char-soft)' }}>None yet</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </HodShell>
  )
}
