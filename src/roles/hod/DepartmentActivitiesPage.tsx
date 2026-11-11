import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { HodShell } from './shell/HodShell'
import { Card, Skeleton, StatusPill, statusRailColor } from './shell/ui'
import { Icon } from '../primary-admin/shell/Icon'
import { watchDepartmentSubmissions } from '../../lib/firestore/submissions'
import { watchDepartmentUsers } from '../../lib/firestore/users'
import { submissionStudent } from '../../lib/submissionStudent'
import type { AppUser, Submission, SubmissionStatus } from '../../types'

const FILTERS: { key: SubmissionStatus | 'all'; label: string }[] = [
  { key: 'submitted', label: 'Pending' },
  { key: 'all', label: 'All' },
  { key: 'approved', label: 'Approved' },
  { key: 'revisionRequested', label: 'Revision requested' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'draft', label: 'Drafts' },
]

function dotColor(key: SubmissionStatus | 'all'): string {
  return key === 'all' ? 'var(--color-char-soft)' : statusRailColor(key)
}

// A custom status-filter trigger + popover rather than a native <select> —
// lets each option show its own colored status dot (the same color
// statusRailColor/StatusPill already use), which a plain <select> can't
// style. Closes on an outside click or on picking an option.
function StatusFilterDropdown({
  value,
  onChange,
  counts,
}: {
  value: SubmissionStatus | 'all'
  onChange: (next: SubmissionStatus | 'all') => void
  counts: Record<SubmissionStatus | 'all', number>
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const current = FILTERS.find((f) => f.key === value)!

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  return (
    <div className="relative" ref={rootRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2.5 rounded-full border pl-3.5 pr-3 py-2 text-[12.5px] font-medium transition-colors"
        style={{
          borderColor: open ? 'var(--color-gold-line)' : 'var(--color-line)',
          backgroundColor: open ? 'var(--color-gold-soft)' : 'var(--color-paper)',
          color: 'var(--color-char)',
        }}
      >
        <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: dotColor(value) }} />
        {current.label}
        <span className="text-[11px] tabular-nums" style={{ color: 'var(--color-char-soft)' }}>
          {counts[value]}
        </span>
        <Icon name="chevron" className="h-3 w-3 transition-transform duration-150" style={{ color: 'var(--color-char-soft)', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }} />
      </button>

      {open && (
        <div
          className="fade-up absolute z-20 top-full left-0 mt-2 w-[230px] rounded-[10px] border overflow-hidden py-1.5"
          style={{ backgroundColor: 'var(--color-paper-raised)', borderColor: 'var(--color-line)', boxShadow: '0 16px 32px -18px rgba(11,18,32,0.35)' }}
        >
          {FILTERS.map((f) => {
            const active = value === f.key
            return (
              <button
                key={f.key}
                onClick={() => {
                  onChange(f.key)
                  setOpen(false)
                }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors"
                style={{ backgroundColor: active ? 'color-mix(in srgb, var(--color-gold) 10%, transparent)' : 'transparent' }}
              >
                <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: dotColor(f.key) }} />
                <span className="flex-1 text-[12.5px]" style={{ color: active ? 'var(--color-char)' : 'var(--color-char-soft)' }}>
                  {f.label}
                </span>
                <span className="text-[11px] tabular-nums" style={{ color: 'var(--color-char-soft)' }}>
                  {counts[f.key]}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function HodDepartmentActivitiesPage() {
  const { appUser } = useAuth()
  const institutionId = appUser?.institutionId ?? null
  const departmentId = appUser?.departmentId ?? null

  const [submissions, setSubmissions] = useState<Submission[] | null>(null)
  useEffect(() => {
    if (!institutionId || !departmentId) return
    return watchDepartmentSubmissions(institutionId, departmentId, setSubmissions)
  }, [institutionId, departmentId])

  const [users, setUsers] = useState<AppUser[]>([])
  useEffect(() => {
    if (!institutionId || !departmentId) return
    return watchDepartmentUsers(institutionId, departmentId, setUsers)
  }, [institutionId, departmentId])

  const usersById = useMemo(() => Object.fromEntries(users.map((u) => [u.uid, u])), [users])

  const [filter, setFilter] = useState<SubmissionStatus | 'all'>('submitted')
  const [search, setSearch] = useState('')

  const counts = useMemo(() => {
    const c: Record<SubmissionStatus | 'all', number> = { all: 0, draft: 0, submitted: 0, approved: 0, revisionRequested: 0, rejected: 0 }
    for (const s of submissions ?? []) {
      if (s.status === 'draft') continue // drafts aren't "activity" until sent — exclude from the All/department counts, only reachable via their own tab
      c.all++
      c[s.status]++
    }
    c.draft = (submissions ?? []).filter((s) => s.status === 'draft').length
    return c
  }, [submissions])

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const byStatus = (submissions ?? []).filter((s) => filter === 'all' ? s.status !== 'draft' : s.status === filter)
    const bySearch = term
      ? byStatus.filter((s) => {
          const student = submissionStudent(s, usersById[s.studentId])?.name.toLowerCase() ?? ''
          return student.includes(term) || s.nodeTitle.toLowerCase().includes(term)
        })
      : byStatus
    return filter === 'submitted' ? bySearch.slice().sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0)) : bySearch.slice().sort((a, b) => b.updatedAt - a.updatedAt)
  }, [submissions, filter, search, usersById])

  const loading = !submissions

  return (
    <HodShell eyebrow="Department-wide" title="Activities">
      <div className="flex items-center gap-3 flex-wrap mb-6">
        <StatusFilterDropdown value={filter} onChange={setFilter} counts={counts} />
        <div className="relative flex-1 min-w-[180px] max-w-[260px]">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: 'var(--color-char-soft)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search student or skill…"
            className="w-full pl-9 pr-3 py-2 text-[12.5px] rounded-full border outline-none transition-colors focus:border-[var(--color-gold)]"
            style={{ borderColor: 'var(--color-line)', backgroundColor: 'var(--color-paper)', color: 'var(--color-char)' }}
          />
        </div>
      </div>

      {loading ? (
        <div className="space-y-2.5">
          <Skeleton className="h-16 rounded-[10px]" />
          <Skeleton className="h-16 rounded-[10px]" />
        </div>
      ) : filtered.length === 0 ? (
        <Card elevated className="text-center py-10">
          <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            {filter === 'submitted' ? 'Nothing waiting for review right now.' : 'Nothing matches this filter.'}
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filtered.map((s, i) => {
            const student = submissionStudent(s, usersById[s.studentId])
            const faculty = usersById[s.facultyId]
            return (
              <Link
                key={s.id}
                to={`/hod/activities/${s.id}`}
                className="fade-up flex items-center gap-4 rounded-[10px] border pl-4 pr-4 py-3.5 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-14px_rgba(11,18,32,0.35)] hover:border-[var(--color-gold-line)]"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)',
                  borderColor: 'var(--color-line)',
                  animationDelay: `${i * 30}ms`,
                }}
              >
                <div
                  className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center font-display text-[13px]"
                  style={{ backgroundColor: 'var(--color-gold-soft)', color: 'var(--color-gold)' }}
                >
                  {(student?.name.trim()[0] ?? '?').toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] truncate" style={{ color: 'var(--color-char)' }}>
                    {student ? `${student.name}${student.rollNumber ? ` · ${student.rollNumber}` : ''}` : 'Loading…'}
                  </div>
                  <div className="text-[12px] truncate mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
                    {s.nodeTitle} {faculty && `· ${s.status === 'submitted' ? 'sent to' : 'reviewed by'} ${faculty.name}`}
                  </div>
                </div>
                <StatusPill status={s.status} resubmitted={s.resubmittedAfterRevision} />
              </Link>
            )
          })}
        </div>
      )}
    </HodShell>
  )
}
