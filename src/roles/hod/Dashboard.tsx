import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { HodShell } from './shell/HodShell'
import { Card, StatTile, Skeleton } from './shell/ui'
import { StatusPill } from '../../components/StatusPill'
import { watchDepartmentSubmissions } from '../../lib/firestore/submissions'
import { watchDepartmentUsers } from '../../lib/firestore/users'
import { watchInstitutionDepartments } from '../../lib/firestore/departments'
import type { AppUser, Submission } from '../../types'

function startOfMonth(): number {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime()
}

// Department-wide — not scoped to HOD's own uid the way Faculty's
// dashboard is scoped to facultyId, per the build spec's "HOD oversees all
// faculty reviews... within the department."
export function HodDashboard() {
  const { appUser } = useAuth()
  const institutionId = appUser?.institutionId ?? null
  const departmentId = appUser?.departmentId ?? null

  const [submissions, setSubmissions] = useState<Submission[] | null>(null)
  useEffect(() => {
    if (!institutionId || !departmentId) return
    return watchDepartmentSubmissions(institutionId, departmentId, setSubmissions)
  }, [institutionId, departmentId])

  const [users, setUsers] = useState<AppUser[] | null>(null)
  useEffect(() => {
    if (!institutionId || !departmentId) return
    return watchDepartmentUsers(institutionId, departmentId, setUsers)
  }, [institutionId, departmentId])

  const [departmentName, setDepartmentName] = useState<string | null>(null)
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionDepartments(institutionId, (depts) => {
      const match = depts.find((d) => d.id === departmentId)
      if (match) setDepartmentName(match.name)
    })
  }, [institutionId, departmentId])

  const loading = submissions === null || users === null
  const pending = useMemo(() => (submissions ?? []).filter((s) => s.status === 'submitted'), [submissions])
  const approvedThisMonth = useMemo(() => {
    const start = startOfMonth()
    return (submissions ?? []).filter((s) => s.status === 'approved' && s.reviewedAt != null && s.reviewedAt >= start).length
  }, [submissions])
  const studentCount = useMemo(() => (users ?? []).filter((u) => u.role === 'student').length, [users])
  const facultyCount = useMemo(() => (users ?? []).filter((u) => u.role === 'faculty').length, [users])

  const facultyNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const u of users ?? []) if (u.role === 'faculty') map[u.uid] = u.name
    return map
  }, [users])
  const studentNames = useMemo(() => {
    const map: Record<string, string> = {}
    for (const u of users ?? []) if (u.role === 'student') map[u.uid] = u.name
    return map
  }, [users])

  return (
    <HodShell eyebrow={departmentName ?? 'Your department'} title={`Welcome, ${appUser?.name?.split(' ')[0] ?? 'there'}`}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mb-4">
        <StatTile icon="users" label="Students" value={studentCount} loading={loading} />
        <StatTile icon="cap" label="Faculty" value={facultyCount} loading={loading} />
        <StatTile icon="inbox" label="Pending review" value={pending.length} loading={loading} />
        <StatTile icon="checkCircle" label="Approved this month" value={approvedThisMonth} loading={loading} />
      </div>

      <Card elevated>
        <div className="flex items-center justify-between mb-3">
          <span className="font-display text-[15.5px]" style={{ color: 'var(--color-char)' }}>
            Next up
          </span>
          <Link to="/hod/activities" className="text-[12px] font-medium" style={{ color: 'var(--color-gold)' }}>
            Open department activities →
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
            {pending.slice(0, 6).map((s) => (
              <Link
                key={s.id}
                to={`/hod/activities/${s.id}`}
                className="flex items-center justify-between gap-3 rounded-[8px] px-3 py-2.5 transition-colors hover:bg-black/[0.02]"
                style={{ backgroundColor: 'var(--color-paper)' }}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] truncate" style={{ color: 'var(--color-char)' }}>
                    {s.nodeTitle}
                  </div>
                  <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--color-char-soft)' }}>
                    {studentNames[s.studentId] ?? '…'} · sent to {facultyNames[s.facultyId] ?? '…'}
                  </div>
                </div>
                <span className="text-[11px] shrink-0 font-mono" style={{ color: 'var(--color-char-soft)' }}>
                  {s.submittedAt ? new Date(s.submittedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {!loading && (submissions ?? []).some((s) => s.status === 'revisionRequested' || s.status === 'rejected') && (
        <Card elevated className="mt-4">
          <div className="font-display text-[15.5px] mb-3" style={{ color: 'var(--color-char)' }}>
            Needs attention
          </div>
          <div className="flex flex-col gap-1.5">
            {(submissions ?? [])
              .filter((s) => s.status === 'revisionRequested' || s.status === 'rejected')
              .slice(0, 5)
              .map((s) => (
                <Link
                  key={s.id}
                  to={`/hod/activities/${s.id}`}
                  className="flex items-center justify-between gap-3 rounded-[8px] px-3 py-2.5 transition-colors hover:bg-black/[0.02]"
                  style={{ backgroundColor: 'var(--color-paper)' }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] truncate" style={{ color: 'var(--color-char)' }}>
                      {s.nodeTitle}
                    </div>
                    <div className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--color-char-soft)' }}>
                      {studentNames[s.studentId] ?? '…'}
                    </div>
                  </div>
                  <StatusPill status={s.status} resubmitted={s.resubmittedAfterRevision} />
                </Link>
              ))}
          </div>
        </Card>
      )}
    </HodShell>
  )
}
