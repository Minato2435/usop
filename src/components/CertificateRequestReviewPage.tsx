import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Icon } from '../roles/primary-admin/shell/Icon'
import { Skeleton } from '../roles/primary-admin/shell/ui'
import { CertificateStatusPill } from './CertificateStatusPill'
import {
  watchCertificateRequest,
  certificateRequestStatus,
  recordSkillLabDirectorDecision,
  recordPrimaryAdminDecision,
} from '../lib/firestore/certificates'
import { watchStudentSubmissions } from '../lib/firestore/submissions'
import { getInstitution } from '../lib/firestore/institutions'
import { getAppUser } from '../lib/firestore/users'
import type { AppUser, CertificateDecision, CertificateRequest, Submission } from '../types'

type ShellProps = { eyebrow?: string; title: string; actions?: ReactNode; children: ReactNode }

const BORDER = 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)'
const ROW_LINE = 'color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)'

const DECISION: Record<CertificateDecision, { label: string; color: string; bg: string }> = {
  pending: { label: 'Pending', color: 'var(--color-char-soft)', bg: 'color-mix(in srgb, var(--color-char-soft) 12%, transparent)' },
  approved: { label: 'Approved', color: 'var(--color-teal)', bg: 'var(--color-teal-soft)' },
  rejected: { label: 'Rejected', color: 'var(--color-clay)', bg: 'var(--color-clay-soft)' },
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}
function formatDateTime(ms: number): string {
  return `${formatDate(ms)}, ${new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
}
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

// Shared by Primary Admin and Skill Lab Director (`approver` decides which
// side is interactive). Laid out after `attaching references/Certificate
// Management - Skill Lab Director.dc.html`: identity header, then required
// skills with their approval evidence on the left, the decisions timeline
// and "Your decision" panel on the right.
export function CertificateRequestReviewPage({
  Shell,
  backTo,
  backLabel,
  approver,
}: {
  Shell: ComponentType<ShellProps>
  backTo: string
  backLabel: string
  approver: 'skillLabDirector' | 'primaryAdmin'
}) {
  const { requestId } = useParams<{ requestId: string }>()
  const navigate = useNavigate()
  const { appUser } = useAuth()

  const [request, setRequest] = useState<CertificateRequest | null | undefined>(undefined)
  useEffect(() => {
    if (!requestId) return
    return watchCertificateRequest(requestId, setRequest)
  }, [requestId])

  const studentId = request?.studentId
  const [student, setStudent] = useState<AppUser | null | undefined>(undefined)
  useEffect(() => {
    if (!studentId) return
    let cancelled = false
    getAppUser(studentId)
      .catch(() => null)
      .then((u) => !cancelled && setStudent(u))
    return () => {
      cancelled = true
    }
  }, [studentId])

  const institutionId = request?.institutionId
  const [collegeName, setCollegeName] = useState<string | null>(null)
  useEffect(() => {
    if (!institutionId) return
    getInstitution(institutionId)
      .catch(() => null)
      .then((i) => setCollegeName(i?.name ?? null))
  }, [institutionId])

  // Evidence: the student's approved submissions, matched to each skill.
  const [submissions, setSubmissions] = useState<Submission[]>([])
  useEffect(() => {
    if (!studentId) return
    return watchStudentSubmissions(studentId, setSubmissions)
  }, [studentId])

  const evidence = useMemo(() => {
    const map = new Map<string, Submission>()
    for (const s of submissions) {
      if (s.status !== 'approved' || s.departmentId !== request?.departmentId) continue
      const prev = map.get(s.nodeId)
      if (!prev || (s.reviewedAt ?? 0) < (prev.reviewedAt ?? 0)) map.set(s.nodeId, s)
    }
    return map
  }, [submissions, request?.departmentId])

  // Names: approving faculty (evidence) and approvers whose name wasn't
  // saved with the decision (decisions recorded before names were stored).
  const [names, setNames] = useState<Record<string, string>>({})
  const uidsToName = useMemo(() => {
    const ids = new Set<string>()
    evidence.forEach((s) => ids.add(s.facultyId))
    if (request?.skillLabDirectorBy && !request.skillLabDirectorName) ids.add(request.skillLabDirectorBy)
    if (request?.primaryAdminBy && !request.primaryAdminName) ids.add(request.primaryAdminBy)
    return [...ids].filter(Boolean)
  }, [evidence, request])
  useEffect(() => {
    const missing = uidsToName.filter((id) => !(id in names))
    if (missing.length === 0) return
    Promise.all(missing.map((id) => getAppUser(id).catch(() => null))).then((users) =>
      setNames((prev) => {
        const next = { ...prev }
        users.forEach((u, i) => (next[missing[i]] = u?.name ?? 'Unknown'))
        return next
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uidsToName.join(',')])

  const [remarks, setRemarks] = useState('')
  const [deciding, setDeciding] = useState(false)
  const [toast, setToast] = useState('')
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(id)
  }, [toast])

  async function decide(decision: 'approved' | 'rejected') {
    if (!requestId || !appUser) return
    setDeciding(true)
    try {
      const note = remarks.trim() || null
      if (approver === 'skillLabDirector') await recordSkillLabDirectorDecision(requestId, decision, note, appUser.uid, appUser.name)
      else await recordPrimaryAdminDecision(requestId, decision, note, appUser.uid, appUser.name)
      setRemarks('')
      setToast(decision === 'approved' ? 'Approval recorded' : 'Rejection recorded')
    } finally {
      setDeciding(false)
    }
  }

  const loading = request === undefined || (request !== null && student === undefined)
  const notFound = request === null || !requestId

  const myDecision = request ? (approver === 'skillLabDirector' ? request.skillLabDirectorDecision : request.primaryAdminDecision) : 'pending'
  const myRemarks = request ? (approver === 'skillLabDirector' ? request.skillLabDirectorRemarks : request.primaryAdminRemarks) : null
  const otherRejected = request ? (approver === 'skillLabDirector' ? request.primaryAdminDecision : request.skillLabDirectorDecision) === 'rejected' : false
  const decided = myDecision !== 'pending'

  return (
    <Shell eyebrow="Certificates" title="Certificate request">
      <button
        onClick={() => navigate(backTo)}
        className="inline-flex items-center gap-2 text-[13px] mb-5 hover:opacity-70 transition-opacity"
        style={{ color: 'var(--color-gold)' }}
      >
        <Icon name="arrowLeft" className="h-3.5 w-3.5" />
        {backLabel}
      </button>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-20 rounded-[10px]" />
          <Skeleton className="h-64 rounded-[10px]" />
        </div>
      ) : notFound ? (
        <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
          This certificate request doesn't exist or isn't visible to you.
        </p>
      ) : (
        <div className="fade-up">
          {/* Identity header */}
          <div className="flex justify-between items-start gap-6 flex-wrap pb-6 border-b" style={{ borderColor: BORDER }}>
            <div className="flex gap-4 items-center min-w-0">
              <div
                className="h-16 w-16 shrink-0 rounded-full flex items-center justify-center font-display text-[26px]"
                style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-gold)' }}
              >
                {student ? initials(student.name) : '·'}
              </div>
              <div className="min-w-0">
                <div className="font-mono text-[11px] tracking-[0.16em] uppercase" style={{ color: 'var(--color-gold)' }}>
                  Request · {request!.id.slice(-6).toUpperCase()}
                </div>
                <h2 className="font-display text-[32px] sm:text-[36px] leading-[1.05] my-1 break-words" style={{ color: 'var(--color-char)' }}>
                  {student?.name ?? 'Unknown student'}
                </h2>
                <div className="text-[13.5px]" style={{ color: 'var(--color-char)' }}>
                  <span className="font-mono text-[12px]">{student?.rollNumber || '—'}</span>
                  {collegeName ? ` · ${collegeName}` : ''}
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-2.5 items-start sm:items-end">
              <CertificateStatusPill status={certificateRequestStatus(request!)} />
              <div className="text-[14px] flex items-center gap-2" style={{ color: 'var(--color-char)' }}>
                {request!.department}
                <span className="font-mono text-[11px] border px-1.5 py-0.5" style={{ borderColor: BORDER, color: 'var(--color-char-soft)' }}>
                  Year {request!.mbbsYear}
                </span>
              </div>
              <div className="font-mono text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
                Requested {formatDate(request!.requestedAt)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,1fr)] gap-8 mt-7 items-start">
            {/* Required skills + evidence */}
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-3 mb-3 flex-wrap">
                <h3 className="font-display text-[26px]" style={{ color: 'var(--color-char)' }}>
                  Required skills
                </h3>
                <span className="font-mono text-[12px]" style={{ color: 'var(--color-teal)' }}>
                  {request!.requiredSkills.filter((sk) => evidence.has(sk.nodeId)).length} of {request!.requiredSkills.length} with approved evidence
                </span>
              </div>
              <div className="rounded-[10px] border overflow-hidden" style={{ borderColor: BORDER, backgroundColor: 'var(--color-paper)' }}>
                {request!.requiredSkills.map((sk, i) => {
                  const ev = evidence.get(sk.nodeId)
                  return (
                    <div
                      key={sk.nodeId}
                      className="grid gap-3.5 px-5 py-3.5 items-start"
                      style={{ gridTemplateColumns: 'auto minmax(0,1fr) auto', borderTop: i > 0 ? `1px solid ${ROW_LINE}` : undefined }}
                    >
                      <span
                        className="h-5 w-5 mt-px rounded-full flex items-center justify-center"
                        style={
                          ev
                            ? { backgroundColor: 'var(--color-teal-soft)', color: 'var(--color-teal)' }
                            : { border: '1.4px solid var(--color-line)', color: 'transparent' }
                        }
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="square">
                          <path d="m5 12 5 5 9-10" />
                        </svg>
                      </span>
                      <div className="min-w-0">
                        <div className="text-[14.5px]" style={{ color: 'var(--color-char)' }}>
                          {sk.nodeTitle}
                          {sk.templateTitle && (
                            <span className="font-mono text-[10.5px] ml-2" style={{ color: 'var(--color-char-soft)' }}>
                              {sk.templateTitle}
                            </span>
                          )}
                        </div>
                        <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
                          {ev ? (
                            <>
                              Approved by {names[ev.facultyId] ?? '…'} ·{' '}
                              <span className="font-mono text-[11px]">ACT-{ev.id.slice(-5).toUpperCase()}</span>
                            </>
                          ) : (
                            'No approved activity found'
                          )}
                        </div>
                      </div>
                      <div className="font-mono text-[11.5px] whitespace-nowrap" style={{ color: 'var(--color-char-soft)' }}>
                        {ev?.reviewedAt ? formatDate(ev.reviewedAt) : '—'}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Decisions + your decision */}
            <div className="flex flex-col gap-7">
              <div>
                <h3 className="font-display text-[26px] mb-3" style={{ color: 'var(--color-char)' }}>
                  Decisions
                </h3>
                <div className="rounded-[10px] border px-5 py-1.5" style={{ borderColor: BORDER, backgroundColor: 'var(--color-paper)' }}>
                  <TimelineEntry
                    who="Skill Lab Director"
                    name={request!.skillLabDirectorName ?? (request!.skillLabDirectorBy ? names[request!.skillLabDirectorBy] : null)}
                    decision={request!.skillLabDirectorDecision}
                    at={request!.skillLabDirectorAt}
                    remark={request!.skillLabDirectorRemarks}
                  />
                  <TimelineEntry
                    who="Primary Admin"
                    name={request!.primaryAdminName ?? (request!.primaryAdminBy ? names[request!.primaryAdminBy] : null)}
                    decision={request!.primaryAdminDecision}
                    at={request!.primaryAdminAt}
                    remark={request!.primaryAdminRemarks}
                    last
                  />
                </div>
              </div>

              <div className="rounded-[10px] border p-[22px]" style={{ borderColor: BORDER, backgroundColor: 'var(--color-paper)' }}>
                <div className="font-mono text-[11px] tracking-[0.16em] uppercase" style={{ color: 'var(--color-gold)' }}>
                  Your decision
                </div>
                <textarea
                  disabled={decided || deciding}
                  value={decided ? myRemarks ?? '' : remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder={decided ? 'No remarks given' : 'Remarks (optional) — the student sees these if you reject'}
                  rows={4}
                  className="w-full mt-3 p-3 text-[14px] border outline-none resize-y transition-colors focus:border-[var(--color-gold)] disabled:opacity-80"
                  style={{
                    borderColor: BORDER,
                    color: 'var(--color-char)',
                    backgroundColor: decided ? 'color-mix(in srgb, var(--color-char-soft) 8%, transparent)' : 'var(--color-paper-raised)',
                  }}
                />
                {decided ? (
                  <p className="mt-3 text-[12.5px] leading-relaxed" style={{ color: 'var(--color-char-soft)' }}>
                    You {myDecision === 'approved' ? 'approved' : 'rejected'} this request. It can only change if the student requests again.
                  </p>
                ) : otherRejected ? (
                  <p className="mt-3 text-[12.5px] leading-relaxed" style={{ color: 'var(--color-clay)' }}>
                    The other approver already rejected this request — it stays rejected whatever you decide.
                  </p>
                ) : null}
                <div className="grid grid-cols-2 gap-2.5 mt-4">
                  <button
                    onClick={() => decide('rejected')}
                    disabled={decided || deciding}
                    className="py-3 text-[14px] border transition-opacity disabled:opacity-45 disabled:cursor-not-allowed"
                    style={{ borderColor: 'var(--color-clay)', color: 'var(--color-clay)' }}
                  >
                    Reject
                  </button>
                  <button
                    onClick={() => decide('approved')}
                    disabled={decided || deciding}
                    className="chamfer-sm py-3 text-[14px] transition-opacity disabled:opacity-45 disabled:cursor-not-allowed"
                    style={{ backgroundColor: 'var(--color-teal)', color: 'var(--color-frost)' }}
                  >
                    {deciding ? 'Saving…' : 'Approve'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast &&
        createPortal(
          <div
            className="fade-up fixed bottom-7 left-1/2 -translate-x-1/2 z-[60] px-5 py-3 text-[13.5px]"
            style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-frost)', borderLeft: '2px solid var(--color-gold)' }}
          >
            {toast}
          </div>,
          document.body,
        )}
    </Shell>
  )
}

function TimelineEntry({
  who,
  name,
  decision,
  at,
  remark,
  last,
}: {
  who: string
  name: string | null | undefined
  decision: CertificateDecision
  at: number | null
  remark: string | null
  last?: boolean
}) {
  const d = DECISION[decision]
  return (
    <div className="grid gap-3.5 py-4" style={{ gridTemplateColumns: 'auto 1fr', borderBottom: last ? undefined : `1px solid ${ROW_LINE}` }}>
      <span
        className="h-3 w-3 rounded-full mt-1.5"
        style={{ backgroundColor: decision === 'pending' ? 'color-mix(in srgb, var(--color-char-soft) 55%, transparent)' : d.color }}
      />
      <div className="min-w-0">
        <div className="flex justify-between gap-2 flex-wrap items-center">
          <span className="text-[14px] font-medium" style={{ color: 'var(--color-char)' }}>
            {who}
          </span>
          <span className="text-[12px] px-2.5 py-0.5 rounded-full" style={{ color: d.color, backgroundColor: d.bg }}>
            {d.label}
          </span>
        </div>
        <div className="font-mono text-[11px] mt-1" style={{ color: 'var(--color-char-soft)' }}>
          {at ? `${name ? `${name} · ` : ''}${formatDateTime(at)}` : 'Awaiting decision'}
        </div>
        {remark && (
          <div className="text-[13.5px] mt-2 leading-relaxed italic" style={{ color: 'var(--color-char)' }}>
            “{remark}”
          </div>
        )}
      </div>
    </div>
  )
}
