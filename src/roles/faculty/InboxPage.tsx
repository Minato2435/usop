import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { FacultyShell } from './shell/FacultyShell'
import { Card, Skeleton, StatusPill } from './shell/ui'
import { watchFacultyInbox } from '../../lib/firestore/submissions'
import { getAppUserOrNull } from '../../lib/firestore/users'
import { submissionStudent } from '../../lib/submissionStudent'
import type { AppUser, Submission, SubmissionStatus } from '../../types'

const FILTERS: { key: SubmissionStatus | 'all'; label: string }[] = [
  { key: 'submitted', label: 'Pending' },
  { key: 'all', label: 'All' },
  { key: 'approved', label: 'Approved' },
  { key: 'revisionRequested', label: 'Revision requested' },
  { key: 'rejected', label: 'Rejected' },
]

export function FacultyInboxPage() {
  const { appUser } = useAuth()
  const [submissions, setSubmissions] = useState<Submission[] | null>(null)
  const [filter, setFilter] = useState<SubmissionStatus | 'all'>('submitted')
  const [studentsById, setStudentsById] = useState<Record<string, AppUser>>({})

  useEffect(() => {
    if (!appUser) return
    return watchFacultyInbox(appUser.uid, setSubmissions)
  }, [appUser])

  const studentIds = useMemo(() => [...new Set((submissions ?? []).map((s) => s.studentId))], [submissions])
  useEffect(() => {
    const missing = studentIds.filter((id) => !studentsById[id])
    if (missing.length === 0) return
    let cancelled = false
    Promise.all(missing.map((id) => getAppUserOrNull(id))).then((users) => {
      if (cancelled) return
      setStudentsById((prev) => {
        const next = { ...prev }
        users.forEach((u, i) => {
          if (u) next[missing[i]] = u
        })
        return next
      })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentIds.join(',')])

  const filtered = useMemo(() => {
    // A still-editing draft can carry a facultyId once the student picks
    // one, even before they submit — faculty never see drafts regardless
    // of which filter chip is active.
    const list = (submissions ?? []).filter((s) => s.status !== 'draft' && (filter === 'all' || s.status === filter))
    return filter === 'submitted'
      ? list.slice().sort((a, b) => (a.submittedAt ?? 0) - (b.submittedAt ?? 0))
      : list.slice().sort((a, b) => b.updatedAt - a.updatedAt)
  }, [submissions, filter])

  const loading = !submissions

  return (
    <FacultyShell eyebrow="Review queue" title="Student Activities">
      <div className="flex items-center gap-2 flex-wrap mb-5">
        {FILTERS.map((f) => {
          const active = filter === f.key
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="px-3.5 py-1.5 rounded-full text-[11.5px] font-medium border transition-colors duration-150"
              style={{
                borderColor: active ? 'var(--color-gold)' : 'var(--color-line)',
                backgroundColor: active ? 'var(--color-gold-soft)' : 'transparent',
                color: active ? 'var(--color-gold)' : 'var(--color-char-soft)',
              }}
            >
              {f.label}
            </button>
          )
        })}
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
            const student = submissionStudent(s, studentsById[s.studentId])
            return (
              <Link
                key={s.id}
                to={`/faculty/inbox/${s.id}`}
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
                    {s.nodeTitle}
                  </div>
                </div>
                <StatusPill status={s.status} resubmitted={s.resubmittedAfterRevision} />
              </Link>
            )
          })}
        </div>
      )}
    </FacultyShell>
  )
}
