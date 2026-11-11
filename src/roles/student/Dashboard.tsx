import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { StudentShell } from './shell/StudentShell'
import { Card, PrimaryButton, ProgressRing, Skeleton, StatTile, StatusPill } from './shell/ui'
import { Icon } from '../primary-admin/shell/Icon'
import { watchStudentSubmissions } from '../../lib/firestore/submissions'
import type { Submission } from '../../types'

function startOfMonth(): number {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

export function StudentDashboard() {
  const { appUser } = useAuth()
  const [submissions, setSubmissions] = useState<Submission[] | null>(null)

  useEffect(() => {
    if (!appUser) return
    return watchStudentSubmissions(appUser.uid, setSubmissions)
  }, [appUser])

  const loading = !submissions

  const pendingReview = useMemo(() => (submissions ?? []).filter((s) => s.status === 'submitted').length, [submissions])
  const approvedThisMonth = useMemo(() => {
    const start = startOfMonth()
    return (submissions ?? []).filter((s) => s.status === 'approved' && (s.reviewedAt ?? 0) >= start).length
  }, [submissions])
  const totalLogged = submissions?.length ?? 0
  const approvedTotal = useMemo(() => (submissions ?? []).filter((s) => s.status === 'approved').length, [submissions])
  const completionPct = totalLogged > 0 ? Math.round((approvedTotal / totalLogged) * 100) : 0

  const recent = useMemo(() => (submissions ?? []).slice(0, 5), [submissions])

  return (
    <StudentShell
      eyebrow={appUser?.mbbsYear ? `Year ${appUser.mbbsYear}` : undefined}
      title={`Welcome, ${appUser?.name?.split(' ')[0] ?? 'there'}`}
      actions={
        <Link to="/student/activities">
          <PrimaryButton>
            <Icon name="plus" className="h-3.5 w-3.5" />
            New activity
          </PrimaryButton>
        </Link>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatTile icon="checkCircle" label="Skills logged" value={totalLogged} loading={loading} />
        <StatTile icon="inbox" label="Pending review" value={pendingReview} loading={loading} />
        <StatTile icon="flag" label="Approved this month" value={approvedThisMonth} loading={loading} />
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-stretch">
        <Card elevated>
          <div className="flex items-center justify-between mb-4">
            <span className="font-display text-[16.5px]" style={{ color: 'var(--color-char)' }}>
              Recent activity
            </span>
            <Link to="/student/my-activity" className="text-[12px] font-medium" style={{ color: 'var(--color-gold)' }}>
              View all →
            </Link>
          </div>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 rounded-[10px]" />
              <Skeleton className="h-12 rounded-[10px]" />
            </div>
          ) : recent.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-[13px] mb-3" style={{ color: 'var(--color-char-soft)' }}>
                You haven't logged any activities yet.
              </p>
              <Link to="/student/activities" className="text-[12.5px] font-semibold" style={{ color: 'var(--color-gold)' }}>
                Start a new activity →
              </Link>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {recent.map((s) => (
                <div key={s.id} className="flex items-center gap-3 rounded-[10px] px-3 py-2.5" style={{ backgroundColor: 'var(--color-paper)' }}>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] truncate" style={{ color: 'var(--color-char)' }}>
                      {s.nodeTitle}
                    </div>
                  </div>
                  <StatusPill status={s.status} />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card elevated className="flex flex-col items-center justify-center text-center">
          <ProgressRing value={completionPct} size={72} />
          <div className="mt-3 text-[11.5px] leading-relaxed" style={{ color: 'var(--color-char-soft)' }}>
            {approvedTotal} of {totalLogged} logged skills approved
          </div>
        </Card>
      </div>
    </StudentShell>
  )
}
