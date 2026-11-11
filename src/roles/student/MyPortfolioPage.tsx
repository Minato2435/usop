import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { StudentShell } from './shell/StudentShell'
import { Card, Skeleton } from './shell/ui'
import { Icon } from '../primary-admin/shell/Icon'
import { useStudentDepartments } from '../../lib/enabledDepartments'
import { watchStudentSubmissions } from '../../lib/firestore/submissions'
import { getInstitution } from '../../lib/firestore/institutions'
import { watchTemplate } from '../../lib/firestore/logTemplates'
import { downloadElementAsPdf, certificateFileName } from '../../lib/certificatePdf'
import {
  watchCertificateSkillPreset,
  watchMyCertificateRequest,
  createCertificateRequest,
  resubmitCertificateRequest,
  certificateRequestStatus,
  certificateNumber,
} from '../../lib/firestore/certificates'
import type { AppUser, CertificateDecision, CertificateRequest, CertificateSkillPreset, Department, Submission } from '../../types'

const BORDER = 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)'
const ROW_LINE = 'color-mix(in srgb, var(--color-char-soft) 14%, var(--color-line) 86%)'

type CardState = 'unset' | 'locked' | 'ready' | 'pending' | 'rejected' | 'issued'

const KICKER: Record<CardState, string> = {
  unset: 'Not set up yet',
  locked: 'In progress',
  ready: 'Ready to request',
  pending: 'In review',
  rejected: 'Needs attention',
  issued: 'Issued',
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

// Laid out after `attaching references/Certificate Management - Student.dc.html`.
// A student is bound by year — every department enabled for their college in
// that year applies — so there's one card per department: progress ring +
// required skills on top, a state band below (locked → ready → in review →
// rejected / issued), and the formal certificate once both approvers agree.
// A skill counts once faculty has APPROVED at least one activity against it.
export function StudentMyPortfolioPage() {
  const { appUser } = useAuth()
  const { departments: myDepartments, loading: departmentsLoading } = useStudentDepartments(appUser?.institutionId ?? null, appUser?.mbbsYear ?? null)

  const [submissions, setSubmissions] = useState<Submission[] | null>(null)
  useEffect(() => {
    if (!appUser) return
    return watchStudentSubmissions(appUser.uid, setSubmissions)
  }, [appUser])

  const [collegeName, setCollegeName] = useState<string | null>(null)
  useEffect(() => {
    if (!appUser?.institutionId) return
    getInstitution(appUser.institutionId)
      .catch(() => null)
      .then((i) => setCollegeName(i?.name ?? null))
  }, [appUser?.institutionId])

  // Each department card reports its state up for the summary line.
  const [states, setStates] = useState<Record<string, CardState>>({})
  const reportState = useCallback((id: string, st: CardState) => setStates((prev) => (prev[id] === st ? prev : { ...prev, [id]: st })), [])
  const issuedCount = myDepartments.filter((d) => states[d.id] === 'issued').length

  const loading = submissions === null || departmentsLoading

  return (
    <StudentShell eyebrow="Certificates" title="My Portfolio">
      <div className="flex flex-wrap gap-x-[18px] gap-y-2 items-center text-[13.5px]" style={{ color: 'var(--color-char)' }}>
        {collegeName && <span>{collegeName}</span>}
        {appUser?.mbbsYear && (
          <span className="font-mono text-[11px] border px-2 py-0.5" style={{ borderColor: BORDER, color: 'var(--color-char-soft)' }}>
            Year {appUser.mbbsYear}
          </span>
        )}
        {!loading && myDepartments.length > 0 && (
          <span style={{ color: 'var(--color-char-soft)' }}>
            {issuedCount} of {myDepartments.length} certificate{myDepartments.length === 1 ? '' : 's'} issued
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-4 mt-7">
          <Skeleton className="h-48 rounded-[10px]" />
          <Skeleton className="h-48 rounded-[10px]" />
        </div>
      ) : myDepartments.length === 0 ? (
        <Card className="max-w-lg mt-7">
          <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            No departments are enabled for your year at your college yet — ask your institution admin.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-[22px] mt-7">
          {myDepartments.map((d, i) => (
            <DepartmentCard
              key={d.id}
              department={d}
              appUser={appUser!}
              collegeName={collegeName}
              submissions={submissions}
              index={i}
              onState={reportState}
            />
          ))}
        </div>
      )}
    </StudentShell>
  )
}

function DepartmentCard({
  department,
  appUser,
  collegeName,
  submissions,
  index,
  onState,
}: {
  department: Department
  appUser: AppUser
  collegeName: string | null
  submissions: Submission[]
  index: number
  onState: (id: string, st: CardState) => void
}) {
  const [preset, setPreset] = useState<CertificateSkillPreset | null | undefined>(undefined)
  useEffect(() => {
    if (!appUser.institutionId || !appUser.mbbsYear) return
    return watchCertificateSkillPreset(appUser.institutionId, department.name, appUser.mbbsYear, setPreset)
  }, [appUser.institutionId, appUser.mbbsYear, department.name])

  const [request, setRequest] = useState<CertificateRequest | null | undefined>(undefined)
  useEffect(() => watchMyCertificateRequest(appUser.uid, department.id, setRequest), [appUser.uid, department.id])

  // First faculty approval per skill, in this department.
  const approvedAt = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of submissions) {
      if (s.status !== 'approved' || s.departmentId !== department.id) continue
      const at = s.reviewedAt ?? s.updatedAt
      const prev = map.get(s.nodeId)
      if (prev === undefined || at < prev) map.set(s.nodeId, at)
    }
    return map
  }, [submissions, department.id])

  const skills = useMemo(() => preset?.requiredSkills ?? [], [preset])

  // Log name per skill — saved on the preset; older presets fall back to a
  // lookup of the template itself.
  const [logTitles, setLogTitles] = useState<Record<string, string>>({})
  const missingLogIds = useMemo(() => [...new Set(skills.filter((sk) => !sk.templateTitle).map((sk) => sk.templateId))], [skills])
  useEffect(() => {
    const unsubs = missingLogIds.map((id) => watchTemplate(id, (t) => setLogTitles((prev) => ({ ...prev, [id]: t?.title ?? '' }))))
    return () => unsubs.forEach((u) => u())
  }, [missingLogIds])
  const logName = (sk: (typeof skills)[number]) => sk.templateTitle || logTitles[sk.templateId] || ''
  const done = skills.filter((sk) => approvedAt.has(sk.nodeId)).length
  const total = skills.length
  const status = request ? certificateRequestStatus(request) : null

  const state: CardState =
    total === 0 ? 'unset' : status === 'issued' ? 'issued' : status === 'rejected' ? 'rejected' : status === 'pending' ? 'pending' : done === total ? 'ready' : 'locked'

  useEffect(() => {
    if (preset !== undefined && request !== undefined) onState(department.id, state)
  }, [state, preset, request, department.id, onState])

  const [busy, setBusy] = useState(false)
  async function requestCertificate() {
    if (!preset) return
    setBusy(true)
    try {
      if (request) await resubmitCertificateRequest(appUser.uid, department.id)
      else
        await createCertificateRequest({
          studentId: appUser.uid,
          institutionId: appUser.institutionId!,
          departmentId: department.id,
          department: department.name,
          mbbsYear: appUser.mbbsYear!,
          presetId: preset.id,
          requiredSkills: preset.requiredSkills,
        })
    } finally {
      setBusy(false)
    }
  }

  const [certOpen, setCertOpen] = useState(false)
  const certRef = useRef<HTMLDivElement>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')
  async function downloadPdf() {
    if (!request) return
    setDownloading(true)
    setDownloadError('')
    try {
      // The certificate has to be on screen to be captured — open it first.
      if (!certRef.current) {
        setCertOpen(true)
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      }
      if (!certRef.current) throw new Error('Certificate not rendered')
      await downloadElementAsPdf(
        certRef.current,
        certificateFileName([department.name, `Year-${request.mbbsYear}`, appUser.rollNumber || appUser.name]),
        `${appUser.name} — ${department.name} certificate`,
      )
    } catch {
      setDownloadError('Couldn’t create the PDF — please try again.')
    } finally {
      setDownloading(false)
    }
  }

  if (preset === undefined || request === undefined) return <Skeleton className="h-48 rounded-[10px]" />

  const pct = total ? done / total : 0
  const ringColor = state === 'issued' || state === 'ready' ? 'var(--color-teal)' : state === 'rejected' ? 'var(--color-clay)' : 'var(--color-gold)'
  const bandBg =
    state === 'rejected'
      ? 'color-mix(in srgb, var(--color-clay) 6%, var(--color-paper))'
      : state === 'ready'
        ? 'color-mix(in srgb, var(--color-gold) 9%, var(--color-paper))'
        : 'color-mix(in srgb, var(--color-char-soft) 5%, var(--color-paper))'
  const left = total - done

  return (
    <article
      className="fade-up rounded-[10px] border overflow-hidden"
      style={{ borderColor: BORDER, backgroundColor: 'var(--color-paper-raised)', animationDelay: `${index * 70}ms` }}
    >
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))' }}>
        {/* Ring + name */}
        <div className="p-5 sm:px-7 sm:py-[26px] flex gap-5 items-center">
          <ProgressRing pct={pct} color={ringColor} done={done} total={total} />
          <div className="min-w-0">
            <div className="font-mono text-[10.5px] tracking-[0.12em] uppercase" style={{ color: 'var(--color-gold)' }}>
              {KICKER[state]}
            </div>
            <div className="font-display text-[30px] leading-[1.1] mt-0.5 mb-1.5 break-words" style={{ color: 'var(--color-char)' }}>
              {department.name}
            </div>
            <span className="font-mono text-[11px] border px-1.5 py-0.5" style={{ borderColor: BORDER, color: 'var(--color-char-soft)' }}>
              Year {department.mbbsYear}
            </span>
          </div>
        </div>

        {/* Required skills */}
        <div className="p-5 sm:px-7 sm:py-[26px] border-t md:border-t-0 md:border-l" style={{ borderColor: ROW_LINE }}>
          <div className="font-mono text-[10.5px] tracking-[0.12em] uppercase mb-2" style={{ color: 'var(--color-char-soft)' }}>
            Required skills
          </div>
          {total === 0 ? (
            <p className="text-[13px] py-2" style={{ color: 'var(--color-char-soft)' }}>
              The skills for this department’s certificate haven’t been chosen yet.
            </p>
          ) : (
            skills.map((sk) => {
              const at = approvedAt.get(sk.nodeId)
              return (
                <div key={sk.nodeId} className="flex items-center gap-3 py-[7px]" style={{ borderBottom: `1px solid ${ROW_LINE}` }}>
                  <span
                    className="h-[18px] w-[18px] shrink-0 rounded-full flex items-center justify-center"
                    style={{
                      backgroundColor: at ? 'var(--color-teal-soft)' : 'transparent',
                      color: 'var(--color-teal)',
                      border: `1.4px solid ${at ? 'var(--color-teal)' : 'var(--color-line)'}`,
                    }}
                  >
                    {at && (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="square">
                        <path d="m5 12 5 5 9-10" />
                      </svg>
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13.5px] leading-snug" style={{ color: at ? 'var(--color-char)' : 'var(--color-char-soft)' }}>
                      {sk.nodeTitle}
                    </span>
                    {logName(sk) && (
                      <span className="block font-mono text-[10.5px] mt-0.5 truncate" style={{ color: 'var(--color-char-soft)' }}>
                        {logName(sk)}
                      </span>
                    )}
                  </span>
                  <span className="font-mono text-[11px] whitespace-nowrap" style={{ color: 'var(--color-char-soft)' }}>
                    {at ? formatDate(at) : 'Pending'}
                  </span>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* State band */}
      <div className="border-t px-5 py-[18px] sm:px-7 sm:py-5 flex gap-x-7 gap-y-4 items-center justify-between flex-wrap" style={{ borderColor: BORDER, backgroundColor: bandBg }}>
        {state === 'unset' && (
          <BandMessage icon="clock" title="Not available yet" sub="Your admin hasn’t set the required skills for this department." />
        )}

        {state === 'locked' && (
          <>
            <BandMessage
              icon="lock"
              title="Certificate locked"
              sub={`${left} more ${left === 1 ? 'skill needs' : 'skills need'} a faculty-approved activity before you can request.`}
            />
            <button disabled className="chamfer-sm px-[22px] py-[11px] text-[14px] cursor-not-allowed" style={{ backgroundColor: 'var(--color-line)', color: 'var(--color-char-soft)' }}>
              Request certificate
            </button>
          </>
        )}

        {state === 'ready' && (
          <>
            <BandMessage
              icon="certificate"
              iconColor="var(--color-gold)"
              title="All required skills completed"
              sub="One request is sent for this department. The Skill Lab Director and Primary Admin both review it."
            />
            <button
              onClick={requestCertificate}
              disabled={busy}
              className="chamfer-sm px-6 py-[11px] text-[14px] font-semibold transition-opacity disabled:opacity-60"
              style={{ backgroundColor: 'var(--color-gold)', color: 'var(--color-ink)' }}
            >
              {busy ? 'Sending…' : 'Request certificate'}
            </button>
          </>
        )}

        {state === 'pending' && request && (
          <>
            <div>
              <div className="text-[14px]" style={{ color: 'var(--color-char)' }}>
                Request submitted · <span className="font-mono text-[12px]">{formatDate(request.requestedAt)}</span>
              </div>
              <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
                Waiting for both approvals.
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              <ApprovalChip label="Skill Lab" decision={request.skillLabDirectorDecision} />
              <ApprovalChip label="Admin" decision={request.primaryAdminDecision} />
            </div>
          </>
        )}

        {state === 'rejected' && request && (
          <>
            <div className="flex-1 min-w-[240px]">
              {(() => {
                const bySld = request.skillLabDirectorDecision === 'rejected'
                const at = bySld ? request.skillLabDirectorAt : request.primaryAdminAt
                const remark = bySld ? request.skillLabDirectorRemarks : request.primaryAdminRemarks
                return (
                  <>
                    <div className="flex gap-2.5 items-center flex-wrap">
                      <span className="text-[14px]" style={{ color: 'var(--color-clay)' }}>
                        Rejected by {bySld ? 'Skill Lab Director' : 'Primary Admin'}
                      </span>
                      {at && (
                        <span className="font-mono text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
                          {formatDate(at)}
                        </span>
                      )}
                    </div>
                    <div className="text-[13.5px] mt-2 leading-relaxed italic" style={{ color: 'var(--color-char)' }}>
                      {remark ? `“${remark}”` : 'No remarks were given.'}
                    </div>
                  </>
                )
              })()}
              <div className="flex gap-2 mt-3 flex-wrap">
                <ApprovalChip label="Skill Lab" decision={request.skillLabDirectorDecision} />
                <ApprovalChip label="Admin" decision={request.primaryAdminDecision} />
              </div>
            </div>
            <button
              onClick={requestCertificate}
              disabled={busy || done < total}
              title={done < total ? 'Complete every required skill first' : undefined}
              className="px-6 py-[11px] text-[14px] border transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ borderColor: 'var(--color-clay)', color: 'var(--color-clay)' }}
            >
              {busy ? 'Sending…' : 'Request again'}
            </button>
          </>
        )}

        {state === 'issued' && request && (
          <>
            <div className="flex gap-3.5 items-center">
              <span className="h-[34px] w-[34px] rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-teal-soft)', color: 'var(--color-teal)' }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="square">
                  <path d="m5 12 5 5 9-10" />
                </svg>
              </span>
              <div>
                <div className="text-[14px]" style={{ color: 'var(--color-teal)' }}>
                  Certificate issued
                </div>
                <div className="font-mono text-[11.5px] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
                  {formatDate(Math.max(request.skillLabDirectorAt ?? 0, request.primaryAdminAt ?? 0))} · {certificateNumber(request)}
                </div>
              </div>
            </div>
            <div className="flex gap-2.5 flex-wrap">
              <button
                onClick={() => setCertOpen((o) => !o)}
                className="px-5 py-2.5 text-[14px] border transition-colors hover:border-[var(--color-gold)]"
                style={{ borderColor: BORDER, color: 'var(--color-char)' }}
              >
                {certOpen ? 'Hide certificate' : 'View certificate'}
              </button>
              <button
                onClick={downloadPdf}
                disabled={downloading}
                className="chamfer-sm px-5 py-2.5 text-[14px] font-semibold flex gap-2 items-center transition-opacity disabled:opacity-60"
                style={{ backgroundColor: 'var(--color-gold)', color: 'var(--color-ink)' }}
              >
                <Icon name="upload" className="h-3.5 w-3.5 rotate-180" />
                {downloading ? 'Preparing PDF…' : 'Download PDF'}
              </button>
            </div>
            {downloadError && (
              <p className="w-full text-[12.5px]" style={{ color: 'var(--color-clay)' }}>
                {downloadError}
              </p>
            )}
          </>
        )}
      </div>

      {state === 'issued' && certOpen && request && (
        <CertificateDocument
          docRef={certRef}
          request={request}
          studentName={appUser.name}
          rollNumber={appUser.rollNumber ?? null}
          collegeName={collegeName}
        />
      )}
    </article>
  )
}

function ProgressRing({ pct, color, done, total }: { pct: number; color: string; done: number; total: number }) {
  const C = 2 * Math.PI * 34
  return (
    <div className="relative h-[84px] w-[84px] shrink-0">
      <svg width="84" height="84" viewBox="0 0 84 84" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="42" cy="42" r="34" fill="none" stroke="var(--color-line)" strokeWidth="5" />
        <circle
          cx="42"
          cy="42"
          r="34"
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeDasharray={`${(pct * C).toFixed(1)} ${C.toFixed(1)}`}
          style={{ transition: 'stroke-dasharray 600ms ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="font-display text-[26px] leading-none" style={{ color }}>
          {done}
          <span className="text-[15px]" style={{ color: 'var(--color-char-soft)' }}>
            /{total}
          </span>
        </div>
      </div>
    </div>
  )
}

function BandMessage({ icon, iconColor, title, sub }: { icon: 'lock' | 'certificate' | 'clock'; iconColor?: string; title: string; sub: string }) {
  return (
    <div className="flex gap-3.5 items-center min-w-0">
      <span className="flex shrink-0" style={{ color: iconColor ?? 'var(--color-char-soft)' }}>
        {icon === 'lock' ? (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square">
            <rect x="5" y="11" width="14" height="9" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
        ) : (
          <Icon name={icon} className="h-[22px] w-[22px]" />
        )}
      </span>
      <div>
        <div className="text-[14px]" style={{ color: 'var(--color-char)' }}>
          {title}
        </div>
        <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
          {sub}
        </div>
      </div>
    </div>
  )
}

function ApprovalChip({ label, decision }: { label: string; decision: CertificateDecision }) {
  const color = decision === 'approved' ? 'var(--color-teal)' : decision === 'rejected' ? 'var(--color-clay)' : 'var(--color-char-soft)'
  const text = decision === 'approved' ? 'Approved' : decision === 'rejected' ? 'Rejected' : 'Pending'
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11.5px] font-medium border whitespace-nowrap"
      style={{ borderColor: `color-mix(in srgb, ${color} 40%, transparent)`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label} · {text}
    </span>
  )
}

// The issued certificate — a formal, print-styled document: double gold
// frame, corner marks, seal, both approvers' signature lines. Uses fixed
// warm paper tones so it reads as a document whatever the app theme is.
function CertificateDocument({
  docRef,
  request,
  studentName,
  rollNumber,
  collegeName,
}: {
  docRef: RefObject<HTMLDivElement | null>
  request: CertificateRequest
  studentName: string
  rollNumber: string | null
  collegeName: string | null
}) {
  const issuedAt = Math.max(request.skillLabDirectorAt ?? 0, request.primaryAdminAt ?? 0)
  const GOLD = '#B8863B'
  const GOLD_DARK = '#8A6228'
  const INK = '#0B1220'
  const corner = (pos: string) => <div className={`absolute h-7 w-7 ${pos}`} style={{ borderColor: GOLD }} />
  return (
    <div className="border-t px-2 py-4 sm:px-6 sm:py-8 overflow-x-auto" style={{ borderColor: BORDER, backgroundColor: '#E9E5D8' }}>
      <div ref={docRef} className="fade-up max-w-[860px] mx-auto p-2" style={{ backgroundColor: '#FFFEFA', border: `1px solid ${GOLD}`, boxShadow: '0 10px 30px rgba(11,18,32,.12)' }}>
        <div className="relative text-center px-[18px] pt-[34px] pb-[26px] sm:px-12 sm:pt-11 sm:pb-[34px]" style={{ border: `2px solid ${GOLD}`, color: '#1A1F2B' }}>
          {corner('top-2.5 left-2.5 border-t border-l')}
          {corner('top-2.5 right-2.5 border-t border-r')}
          {corner('bottom-2.5 left-2.5 border-b border-l')}
          {corner('bottom-2.5 right-2.5 border-b border-r')}

          <div className="h-11 w-11 mx-auto flex items-center justify-center font-display text-[24px]" style={{ border: `1.6px solid ${GOLD}`, color: GOLD }}>
            U
          </div>
          <div className="font-mono text-[10.5px] tracking-[0.24em] mt-3.5" style={{ color: GOLD_DARK }}>
            USOP · CLINICAL SKILLS REGISTER
          </div>
          <div className="font-display text-[30px] sm:text-[44px] leading-[1.05] mt-2.5" style={{ color: INK }}>
            Certificate of Skill Completion
          </div>
          <div className="text-[13.5px] mt-5 italic" style={{ color: '#5B6272' }}>
            This certifies that
          </div>
          <div className="font-display text-[34px] sm:text-[46px] leading-[1.1] mt-2" style={{ color: INK }}>
            {studentName}
          </div>
          {rollNumber && (
            <div className="font-mono text-[12px] mt-1.5" style={{ color: '#5B6272' }}>
              Roll No. {rollNumber}
            </div>
          )}
          <div className="text-[14px] leading-[1.7] mt-[18px] mx-auto max-w-[560px]" style={{ color: '#3A4152' }}>
            {collegeName ? `of ${collegeName}, ` : ''}has completed every clinical skill required by the Department of{' '}
            <strong className="font-semibold" style={{ color: INK }}>
              {request.department}
            </strong>{' '}
            for MBBS <span className="font-mono text-[12.5px]">Year {request.mbbsYear}</span>, each demonstrated and approved by faculty.
          </div>

          <div className="h-px mx-auto mt-6 mb-4 max-w-[420px]" style={{ backgroundColor: '#E1D7BF' }} />
          <div className="font-mono text-[10px] tracking-[0.18em]" style={{ color: GOLD_DARK }}>
            SKILLS COMPLETED
          </div>
          <div className="grid gap-x-7 gap-y-1.5 mt-3 mx-auto max-w-[640px] text-left" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
            {request.requiredSkills.map((sk) => (
              <div key={sk.nodeId} className="flex gap-2.5 text-[12.5px] leading-snug">
                <span style={{ color: GOLD }}>◆</span>
                <span className="flex-1">{sk.nodeTitle}</span>
              </div>
            ))}
          </div>

          <div className="grid gap-[26px] mt-[34px] mx-auto max-w-[640px] items-end" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))' }}>
            <Signature name={request.skillLabDirectorName ?? 'Skill Lab Director'} role="Skill Lab Director" at={request.skillLabDirectorAt} color={GOLD_DARK} ink={INK} />
            <div className="flex justify-center">
              <div className="h-[72px] w-[72px] rounded-full flex items-center justify-center" style={{ border: `1.6px solid ${GOLD}` }}>
                <div className="h-[58px] w-[58px] rounded-full flex flex-col items-center justify-center" style={{ border: `1px dashed ${GOLD}`, color: GOLD_DARK }}>
                  <div className="font-display text-[20px] leading-none">U</div>
                  <div className="font-mono text-[7px] tracking-[0.12em] mt-0.5">VERIFIED</div>
                </div>
              </div>
            </div>
            <Signature name={request.primaryAdminName ?? 'USOP Administration'} role="Primary Admin" at={request.primaryAdminAt} color={GOLD_DARK} ink={INK} />
          </div>

          <div className="flex justify-between flex-wrap gap-2 mt-[30px] font-mono text-[10.5px]" style={{ color: '#5B6272' }}>
            <span>Issued {issuedAt ? formatDate(issuedAt) : ''}</span>
            <span>No. {certificateNumber(request)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Signature({ name, role, at, color, ink }: { name: string; role: string; at: number | null; color: string; ink: string }) {
  return (
    <div>
      <div className="font-display text-[22px] italic pb-1 break-words" style={{ color: ink, borderBottom: `1px solid ${color}` }}>
        {name}
      </div>
      <div className="text-[12px] mt-1.5">{role}</div>
      {at && (
        <div className="font-mono text-[10.5px] mt-0.5" style={{ color: '#5B6272' }}>
          {formatDate(at)}
        </div>
      )}
    </div>
  )
}
