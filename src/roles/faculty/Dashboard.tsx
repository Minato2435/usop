import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { FacultyShell } from './shell/FacultyShell'
import { Card, Skeleton, StatTile } from './shell/ui'
import { watchFacultyInbox } from '../../lib/firestore/submissions'
import type { Submission } from '../../types'

function startOfWeek(): number {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  return new Date(d.getFullYear(), d.getMonth(), diff).getTime()
}

export function FacultyDashboard() {
  const { appUser } = useAuth()
  const [submissions, setSubmissions] = useState<Submission[] | null>(null)

  useEffect(() => {
    if (!appUser) return
    return watchFacultyInbox(appUser.uid, setSubmissions)
  }, [appUser])

  const loading = !submissions
  const pending = useMemo(() => (submissions ?? []).filter((s) => s.status === 'submitted'), [submissions])
  const reviewedThisWeek = useMemo(() => {
    const start = startOfWeek()
    return (submissions ?? []).filter((s) => s.reviewedAt != null && s.reviewedAt >= start).length
  }, [submissions])
  const studentsInQueue = useMemo(() => new Set(pending.map((s) => s.studentId)).size, [pending])

  return (
    <FacultyShell eyebrow={appUser?.departmentId ? 'Your department' : undefined} title={`Welcome, ${appUser?.name?.split(' ')[0] ?? 'there'}`}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mb-4">
        <StatTile icon="inbox" label="Pending review" value={pending.length} loading={loading} />
        <StatTile icon="checkCircle" label="Reviewed this week" value={reviewedThisWeek} loading={loading} />
        <StatTile icon="users" label="Students in queue" value={studentsInQueue} loading={loading} />
      </div>

      <Card elevated>
        <div className="flex items-center justify-between mb-3">
          <span className="font-display text-[15.5px]" style={{ color: 'var(--color-char)' }}>
            Next up
          </span>
          <Link to="/faculty/inbox" className="text-[12px] font-medium" style={{ color: 'var(--color-gold)' }}>
            Open inbox →
          </Link>
        </div>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-11 rounded-[8px]" />
            <Skeleton className="h-11 rounded-[8px]" />
          </div>
        ) : pending.length === 0 ? (
          <p className="text-[13px] py-4 text-center" style={{ color: 'var(--color-char-soft)' }}>
            Nothing waiting for review right now.
          </p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {pending.slice(0, 5).map((s) => (
              <Link
                key={s.id}
                to={`/faculty/inbox/${s.id}`}
                className="flex items-center justify-between gap-3 rounded-[8px] px-3 py-2.5 transition-colors hover:bg-black/[0.02]"
                style={{ backgroundColor: 'var(--color-paper)' }}
              >
                <span className="text-[13px] truncate" style={{ color: 'var(--color-char)' }}>
                  {s.nodeTitle}
                </span>
                <span className="text-[11px] shrink-0 font-mono" style={{ color: 'var(--color-char-soft)' }}>
                  {s.submittedAt ? new Date(s.submittedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </FacultyShell>
  )
}
