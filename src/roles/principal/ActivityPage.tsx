import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { PrincipalShell } from './shell/PrincipalShell'
import { Card, Skeleton, StatusPill } from './shell/ui'
import { Icon } from '../primary-admin/shell/Icon'
import { DopsChecklistPreview } from '../primary-admin/DopsChecklistPreview'
import { AttachmentGallery } from '../../components/AttachmentGallery'
import { watchInstitutionSubmissions } from '../../lib/firestore/submissions'
import { watchInstitutionUsers } from '../../lib/firestore/users'
import { watchCatalogDepartments, watchInstitutionDepartments } from '../../lib/firestore/departments'
import { watchFormSchema } from '../../lib/firestore/formSchemas'
import { sanitizeRichText } from '../../lib/sanitizeHtml'
import type { AppUser, Department, FormSchema, Submission, SubmissionStatus } from '../../types'

const FILTERS: { key: SubmissionStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'submitted', label: 'Awaiting review' },
  { key: 'approved', label: 'Approved' },
  { key: 'revisionRequested', label: 'Revision requested' },
  { key: 'rejected', label: 'Rejected' },
]

// Institution-wide activity browser — read-only, no decide/fill actions
// anywhere on this page, per the build spec's "this role is read-only
// against operational data... no write/approval actions." Search/filter
// by department + status is the spec's explicit ask ("Search and filter
// records by department, batch, academic year, activity type").
export function PrincipalActivityPage() {
  const { appUser } = useAuth()
  const institutionId = appUser?.institutionId ?? null

  const [submissions, setSubmissions] = useState<Submission[] | null>(null)
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionSubmissions(institutionId, setSubmissions)
  }, [institutionId])

  const [users, setUsers] = useState<AppUser[]>([])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionUsers(institutionId, setUsers)
  }, [institutionId])
  const usersById = useMemo(() => Object.fromEntries(users.map((u) => [u.uid, u])), [users])

  const [catalogDepts, setCatalogDepts] = useState<Department[]>([])
  const [ownDepts, setOwnDepts] = useState<Department[]>([])
  useEffect(() => watchCatalogDepartments(setCatalogDepts), [])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionDepartments(institutionId, setOwnDepts)
  }, [institutionId])
  const departments = useMemo(() => [...catalogDepts, ...ownDepts], [catalogDepts, ownDepts])
  const departmentsInUse = useMemo(() => {
    const ids = new Set((submissions ?? []).map((s) => s.departmentId))
    return departments.filter((d) => ids.has(d.id))
  }, [departments, submissions])

  const [filter, setFilter] = useState<SubmissionStatus | 'all'>('all')
  const [deptFilter, setDeptFilter] = useState<string | 'all'>('all')
  const [openId, setOpenId] = useState<string | null>(null)

  const counts = useMemo(() => {
    const c: Record<SubmissionStatus | 'all', number> = { all: 0, draft: 0, submitted: 0, approved: 0, revisionRequested: 0, rejected: 0 }
    for (const s of submissions ?? []) {
      if (s.status === 'draft') continue
      c.all++
      c[s.status]++
    }
    return c
  }, [submissions])

  const filtered = useMemo(() => {
    return (submissions ?? [])
      .filter((s) => s.status !== 'draft')
      .filter((s) => filter === 'all' || s.status === filter)
      .filter((s) => deptFilter === 'all' || s.departmentId === deptFilter)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }, [submissions, filter, deptFilter])

  const openSubmission = (submissions ?? []).find((s) => s.id === openId) ?? null
  const [schema, setSchema] = useState<FormSchema | null | undefined>(undefined)
  useEffect(() => {
    if (!openSubmission) {
      setSchema(undefined)
      return
    }
    return watchFormSchema(openSubmission.formSchemaId, setSchema)
  }, [openSubmission?.formSchemaId])

  const loading = !submissions

  return (
    <PrincipalShell eyebrow="Institution-wide" title="Activity">
      <div className="flex items-center gap-4 flex-wrap mb-6">
        <div className="flex items-center gap-1 overflow-x-auto" style={{ borderBottom: '1px solid var(--color-line)' }}>
          {FILTERS.map((f) => {
            const active = filter === f.key
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className="shrink-0 whitespace-nowrap px-3.5 py-2.5 text-[12.5px] font-medium border-b-2 transition-colors duration-150"
                style={{
                  borderColor: active ? 'var(--color-gold)' : 'transparent',
                  color: active ? 'var(--color-char)' : 'var(--color-char-soft)',
                }}
              >
                {f.label}
                <span className="ml-1.5 text-[11px] tabular-nums" style={{ color: 'var(--color-char-soft)' }}>
                  {counts[f.key]}
                </span>
              </button>
            )
          })}
        </div>
        {departmentsInUse.length > 0 && (
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className="px-3 py-1.5 text-[12.5px] rounded-full border outline-none transition-colors focus:border-[var(--color-gold)]"
            style={{ borderColor: 'var(--color-line)', backgroundColor: 'var(--color-paper)', color: 'var(--color-char)' }}
          >
            <option value="all">All departments</option>
            {departmentsInUse.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · Year {d.mbbsYear}
              </option>
            ))}
          </select>
        )}
      </div>

      {loading ? (
        <div className="space-y-2.5">
          <Skeleton className="h-16 rounded-[14px]" />
          <Skeleton className="h-16 rounded-[14px]" />
        </div>
      ) : filtered.length === 0 ? (
        <Card elevated className="text-center py-10">
          <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            Nothing matches this filter.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          {filtered.map((s) => {
            const student = usersById[s.studentId]
            const faculty = usersById[s.facultyId]
            const department = departments.find((d) => d.id === s.departmentId)
            const open = openId === s.id
            return (
              <div
                key={s.id}
                className="fade-up rounded-[14px] border transition-all duration-200 ease-out"
                style={{
                  backgroundColor: open ? 'color-mix(in srgb, var(--color-gold) 5%, var(--color-paper-raised) 95%)' : 'var(--color-paper-raised)',
                  borderColor: open ? 'var(--color-gold-line)' : 'var(--color-line)',
                  boxShadow: open ? '0 14px 30px -22px rgba(11,18,32,0.3)' : 'none',
                }}
              >
                <button
                  onClick={() => setOpenId(open ? null : s.id)}
                  className="w-full text-left grid gap-4 px-5 py-4 items-center"
                  style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}
                >
                  <div className="min-w-0">
                    <div className="font-display text-[15.5px] leading-snug truncate" style={{ color: 'var(--color-char)' }}>
                      {s.nodeTitle}
                    </div>
                    <div className="text-[12px] mt-1 truncate" style={{ color: 'var(--color-char-soft)' }}>
                      {student?.name ?? '…'} {department && `· ${department.name}`} {faculty && `· ${s.status === 'submitted' ? 'sent to' : 'reviewed by'} ${faculty.name}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-3.5 shrink-0">
                    <StatusPill status={s.status} resubmitted={s.resubmittedAfterRevision} />
                    <Icon
                      name="chevron"
                      className="h-4 w-4 transition-transform duration-200"
                      style={{ color: 'var(--color-char-soft)', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
                    />
                  </div>
                </button>

                {open && (
                  <div className="fade-up border-t px-5 py-5 flex flex-col gap-5" style={{ borderColor: 'var(--color-line)' }}>
                    {(s.facultyFeedback || s.facultyRemarks) && (
                      <div
                        className="rounded-[10px] p-4"
                        style={{ backgroundColor: 'color-mix(in srgb, var(--color-gold) 7%, var(--color-paper-raised) 93%)', border: '1px solid var(--color-gold-line)' }}
                      >
                        {s.facultyFeedback && (
                          <p className="text-[13px] mb-1.5 leading-relaxed" style={{ color: 'var(--color-char)' }}>
                            {s.facultyFeedback}
                          </p>
                        )}
                        {s.facultyRemarks && (
                          <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--color-char-soft)' }}>
                            {s.facultyRemarks}
                          </p>
                        )}
                      </div>
                    )}

                    {schema === undefined ? (
                      <Skeleton className="h-40 rounded-[10px]" />
                    ) : schema ? (
                      <div className="rounded-[10px] border overflow-hidden" style={{ borderColor: 'var(--color-line)' }}>
                        <DopsChecklistPreview title={s.nodeTitle} fields={schema.fields} mode="review" value={s.answers} />
                      </div>
                    ) : null}

                    {s.description && (
                      <div
                        className="text-[13px] leading-relaxed"
                        style={{ color: 'var(--color-char)' }}
                        dangerouslySetInnerHTML={{ __html: sanitizeRichText(s.description) }}
                      />
                    )}

                    {s.images && s.images.length > 0 && <AttachmentGallery images={s.images} />}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </PrincipalShell>
  )
}
