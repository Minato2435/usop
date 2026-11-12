import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { HodShell } from './shell/HodShell'
import { Skeleton, inputClass } from './shell/ui'
import { Icon } from '../primary-admin/shell/Icon'
import { watchDepartmentUsers } from '../../lib/firestore/users'
import { watchDepartmentSubmissions } from '../../lib/firestore/submissions'
import type { AppUser, Submission } from '../../types'

type SortOrder = 'name-asc' | 'name-desc' | 'reviewed-desc' | 'reviewed-asc' | 'pending-desc'
const SORT_LABELS: Record<SortOrder, string> = {
  'name-asc': 'Name (A–Z)',
  'name-desc': 'Name (Z–A)',
  'reviewed-desc': 'Most reviewed',
  'reviewed-asc': 'Fewest reviewed',
  'pending-desc': 'Most pending',
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((w) => w[0]?.toUpperCase() ?? '').join('') || '—'
}

// Same table-list treatment as Primary Admin's Users page (and HOD's own
// Students page) — a bordered container on the page's own paper
// background, header row + hover rows, not a grid of cards.
export function HodFacultyPage() {
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

  const reviewCounts = useMemo(() => {
    const map = new Map<string, { reviewed: number; pending: number }>()
    for (const s of submissions) {
      if (s.status === 'draft' || !s.facultyId) continue
      const row = map.get(s.facultyId) ?? { reviewed: 0, pending: 0 }
      if (s.status === 'submitted') row.pending++
      else row.reviewed++
      map.set(s.facultyId, row)
    }
    return map
  }, [submissions])

  const [search, setSearch] = useState('')
  const [sortOrder, setSortOrder] = useState<SortOrder>('name-asc')

  const faculty = useMemo(() => (users ?? []).filter((u) => u.role === 'faculty'), [users])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const list = faculty.filter(
      (f) => term === '' || f.name.toLowerCase().includes(term) || f.email.toLowerCase().includes(term) || (f.rollNumber ?? '').toLowerCase().includes(term),
    )
    const reviewed = (uid: string) => reviewCounts.get(uid)?.reviewed ?? 0
    const pending = (uid: string) => reviewCounts.get(uid)?.pending ?? 0
    return list.sort((a, b) => {
      if (sortOrder === 'name-asc') return a.name.localeCompare(b.name)
      if (sortOrder === 'name-desc') return b.name.localeCompare(a.name)
      if (sortOrder === 'reviewed-desc') return reviewed(b.uid) - reviewed(a.uid)
      if (sortOrder === 'reviewed-asc') return reviewed(a.uid) - reviewed(b.uid)
      return pending(b.uid) - pending(a.uid)
    })
  }, [faculty, search, sortOrder, reviewCounts])

  const loading = users === null

  return (
    <HodShell eyebrow={`${faculty.length} in your department`} title="Faculty">
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative w-full sm:w-[260px]">
          <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: 'var(--color-char-soft)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email or reg. no."
            className="w-full pl-8 pr-3 py-2 text-[13.5px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]"
            style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
          />
        </div>
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
            {faculty.length === 0 ? 'No faculty are assigned to your department yet.' : 'No faculty match this search.'}
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
                <div className="w-[130px] shrink-0">Years</div>
                <div className="w-[180px] shrink-0">Reviews</div>
              </div>

              {filtered.map((f) => {
                const counts = reviewCounts.get(f.uid)
                return (
                  <div
                    key={f.uid}
                    className="flex items-center gap-4 px-5 py-3.5 border-b last:border-0 transition-colors duration-100 hover:bg-black/[0.015]"
                    style={{ borderColor: 'color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)' }}
                  >
                    <div className="flex-[2] min-w-[220px] flex items-center gap-3">
                      <span
                        className="shrink-0 h-9 w-9 rounded-full border flex items-center justify-center font-display text-[14px]"
                        style={{ borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)' }}
                      >
                        {initials(f.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-display text-[16px] leading-tight truncate" style={{ color: 'var(--color-char)' }}>
                          {f.name}
                        </span>
                        <span className="block font-mono text-[11.5px] truncate" style={{ color: 'var(--color-char-soft)' }}>
                          {f.email}
                        </span>
                        {f.rollNumber && (
                          <span className="block font-mono text-[11.5px] truncate" style={{ color: 'var(--color-char-soft)' }}>
                            Reg {f.rollNumber}
                          </span>
                        )}
                      </span>
                    </div>

                    <div className="w-[130px] shrink-0 text-[13px]" style={{ color: 'var(--color-char)' }}>
                      {f.associatedMbbsYears && f.associatedMbbsYears.length > 0 ? f.associatedMbbsYears.map((y) => `Y${y}`).join(', ') : '—'}
                    </div>

                    <div className="w-[180px] shrink-0 text-[12.5px]" style={{ color: 'var(--color-char)' }}>
                      {counts ? (
                        <>
                          {counts.reviewed} reviewed
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
