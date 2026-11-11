import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { PrincipalShell } from './shell/PrincipalShell'
import { Card, StatTile, Skeleton } from './shell/ui'
import { watchInstitutionSubmissions } from '../../lib/firestore/submissions'
import { watchInstitutionUsers } from '../../lib/firestore/users'
import { watchCatalogDepartments, watchInstitutionDepartments, watchInstitutionDepartmentOverrides } from '../../lib/firestore/departments'
import type { AppUser, Department, InstitutionDepartmentOverride, Submission } from '../../types'

// Institution-wide, read-only — per the build spec, Principal is "read-only
// against operational data... no write/approval actions," built as a
// reporting/analytics interface rather than an inbox/queue like Faculty/HOD.
export function PrincipalDashboard() {
  const { appUser } = useAuth()
  const institutionId = appUser?.institutionId ?? null

  const [submissions, setSubmissions] = useState<Submission[] | null>(null)
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionSubmissions(institutionId, setSubmissions)
  }, [institutionId])

  const [users, setUsers] = useState<AppUser[] | null>(null)
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionUsers(institutionId, setUsers)
  }, [institutionId])

  const [catalogDepts, setCatalogDepts] = useState<Department[]>([])
  const [ownDepts, setOwnDepts] = useState<Department[]>([])
  useEffect(() => watchCatalogDepartments(setCatalogDepts), [])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionDepartments(institutionId, setOwnDepts)
  }, [institutionId])
  const [overrides, setOverrides] = useState<InstitutionDepartmentOverride[]>([])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionDepartmentOverrides(institutionId, setOverrides)
  }, [institutionId])
  // Only departments actually switched on for this college.
  const departments = useMemo(() => {
    const disabled = new Set(overrides.filter((o) => !o.enabled).map((o) => o.departmentId))
    return [...catalogDepts, ...ownDepts].filter((d) => !disabled.has(d.id))
  }, [catalogDepts, ownDepts, overrides])

  const loading = submissions === null || users === null
  const decided = useMemo(() => (submissions ?? []).filter((s) => s.status === 'approved' || s.status === 'rejected'), [submissions])
  const approvalRate = decided.length > 0 ? Math.round((decided.filter((s) => s.status === 'approved').length / decided.length) * 100) : 0
  const studentCount = useMemo(() => (users ?? []).filter((u) => u.role === 'student').length, [users])
  const facultyCount = useMemo(() => (users ?? []).filter((u) => u.role === 'faculty' || u.role === 'hod').length, [users])
  const pendingCount = useMemo(() => (submissions ?? []).filter((s) => s.status === 'submitted').length, [submissions])

  const breakdown = useMemo(() => {
    const byDept = new Map<string, { department: Department; students: number; submissions: number; approved: number; pending: number }>()
    for (const d of departments) {
      if (!byDept.has(d.id)) byDept.set(d.id, { department: d, students: 0, submissions: 0, approved: 0, pending: 0 })
    }
    for (const u of users ?? []) {
      // A student is bound by year only — every enabled department of
      // their year applies, so they count toward each one's total.
      if (u.role !== 'student' || !u.mbbsYear) continue
      for (const row of byDept.values()) {
        if (row.department.mbbsYear === u.mbbsYear) row.students++
      }
    }
    for (const s of submissions ?? []) {
      const row = byDept.get(s.departmentId)
      if (!row) continue
      row.submissions++
      if (s.status === 'approved') row.approved++
      if (s.status === 'submitted') row.pending++
    }
    return [...byDept.values()].filter((r) => r.students > 0 || r.submissions > 0).sort((a, b) => b.submissions - a.submissions)
  }, [departments, users, submissions])

  return (
    <PrincipalShell eyebrow="Institution-wide" title={`Welcome, ${appUser?.name?.split(' ')[0] ?? 'there'}`}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5 mb-6">
        <StatTile icon="users" label="Students" value={studentCount} loading={loading} />
        <StatTile icon="cap" label="Faculty & HOD" value={facultyCount} loading={loading} />
        <StatTile icon="inbox" label="Awaiting review" value={pendingCount} loading={loading} />
        <StatTile icon="checkCircle" label="Approval rate %" value={approvalRate} loading={loading} />
      </div>

      <Card elevated>
        <div className="font-display text-[15.5px] mb-4" style={{ color: 'var(--color-char)' }}>
          Departmental performance
        </div>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-11 rounded-[8px]" />
            <Skeleton className="h-11 rounded-[8px]" />
          </div>
        ) : breakdown.length === 0 ? (
          <p className="text-[13px] py-4 text-center" style={{ color: 'var(--color-char-soft)' }}>
            No department activity recorded yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-[13px]">
              <thead>
                <tr className="text-left border-b" style={{ borderColor: 'var(--color-line)' }}>
                  <th className="pb-2.5 font-medium" style={{ color: 'var(--color-char-soft)' }}>
                    Department
                  </th>
                  <th className="pb-2.5 font-medium text-right" style={{ color: 'var(--color-char-soft)' }}>
                    Students
                  </th>
                  <th className="pb-2.5 font-medium text-right" style={{ color: 'var(--color-char-soft)' }}>
                    Activities
                  </th>
                  <th className="pb-2.5 font-medium text-right" style={{ color: 'var(--color-char-soft)' }}>
                    Approved
                  </th>
                  <th className="pb-2.5 font-medium text-right" style={{ color: 'var(--color-char-soft)' }}>
                    Pending
                  </th>
                </tr>
              </thead>
              <tbody>
                {breakdown.map((row) => (
                  <tr key={row.department.id} className="border-b last:border-0" style={{ borderColor: 'var(--color-line)' }}>
                    <td className="py-2.5" style={{ color: 'var(--color-char)' }}>
                      {row.department.name}
                      <span className="ml-1.5 text-[11px]" style={{ color: 'var(--color-char-soft)' }}>
                        Year {row.department.mbbsYear}
                      </span>
                    </td>
                    <td className="py-2.5 text-right tabular-nums" style={{ color: 'var(--color-char)' }}>
                      {row.students}
                    </td>
                    <td className="py-2.5 text-right tabular-nums" style={{ color: 'var(--color-char)' }}>
                      {row.submissions}
                    </td>
                    <td className="py-2.5 text-right tabular-nums" style={{ color: 'var(--color-teal)' }}>
                      {row.approved}
                    </td>
                    <td className="py-2.5 text-right tabular-nums" style={{ color: row.pending > 0 ? 'var(--color-gold)' : 'var(--color-char-soft)' }}>
                      {row.pending}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PrincipalShell>
  )
}
