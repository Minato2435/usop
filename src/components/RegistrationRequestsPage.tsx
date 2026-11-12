import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { Badge, Card, Field, GhostButton, Modal, PrimaryButton, Skeleton, inputClass } from '../roles/primary-admin/shell/ui'
import { Icon } from '../roles/primary-admin/shell/Icon'
import {
  accountErrorMessage,
  decideRegistration,
  syncEmailStatus,
  getRegistrationOptions,
  watchRegistrationRequests,
  type RegistrationOptions,
} from '../lib/accounts'
import { watchInstitutionUsers } from '../lib/firestore/users'
import type { AppUser, MbbsYear, RegistrationRequest, RegistrationStatus, Role } from '../types'

// Self-registrations waiting for approval. Shared by Primary Admin (every
// request — the only approver for Institution Admin / Skill Lab Director,
// backup approver for everything else) and Institution Admin (Principal /
// HOD / Faculty / Student requests for their own college). The server
// function re-checks who may decide, so this page only shapes the view.

type ShellProps = { eyebrow?: string; title: string; actions?: ReactNode; children: ReactNode }

const ROLE_LABELS: Record<Role, string> = {
  primaryAdmin: 'Primary Admin',
  institutionAdmin: 'Institution Admin',
  principal: 'Principal',
  hod: 'HOD',
  faculty: 'Faculty',
  student: 'Student',
  skillLabDirector: 'Skill Lab Director',
}
const COLLEGE_ROLES: Role[] = ['student', 'faculty', 'hod', 'principal']
const ALL_ROLES: Role[] = [...COLLEGE_ROLES, 'institutionAdmin'] // Skill Lab Director: admin-created only
const YEARS: MbbsYear[] = [1, 2, 3, 4]
const TABS: { key: RegistrationStatus; label: string }[] = [
  { key: 'pending', label: 'Waiting' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
]
const fmt = (ms: number | null) =>
  ms ? new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

export function RegistrationRequestsPage({ Shell, institutionId }: { Shell: ComponentType<ShellProps>; institutionId?: string | null }) {
  const isPrimary = institutionId === undefined
  const [requests, setRequests] = useState<RegistrationRequest[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  useEffect(() => {
    if (!isPrimary && !institutionId) return
    return watchRegistrationRequests(isPrimary ? 'all' : { institutionId: institutionId! }, setRequests, () => setLoadError(true))
  }, [isPrimary, institutionId])

  const [options, setOptions] = useState<RegistrationOptions | null>(null)
  useEffect(() => {
    getRegistrationOptions({}).then(setOptions).catch(() => setOptions({ institutions: [], departments: {} }))
  }, [])
  const collegeName = (id: string | null) => (id ? (options?.institutions.find((i) => i.id === id)?.name ?? '…') : 'All colleges (platform-wide)')
  const deptName = (inst: string | null, id: string | null) =>
    inst && id ? (options?.departments[inst]?.find((d) => d.id === id)?.name ?? '…') : null

  const [tab, setTab] = useState<RegistrationStatus>('pending')
  const [search, setSearch] = useState('')
  const [reviewing, setReviewing] = useState<string | null>(null)

  const counts = useMemo(() => {
    const c: Record<RegistrationStatus, number> = { pending: 0, approved: 0, rejected: 0 }
    ;(requests ?? []).forEach((r) => c[r.status]++)
    return c
  }, [requests])

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (requests ?? [])
      .filter((r) => r.status === tab)
      .filter((r) => !q || [r.name, r.email, r.phone, r.rollNumber ?? ''].some((v) => v.toLowerCase().includes(q)))
      .sort((a, b) => (tab === 'pending' ? a.submittedAt - b.submittedAt : (b.decidedAt ?? 0) - (a.decidedAt ?? 0)))
  }, [requests, tab, search])

  const current = reviewing ? (requests ?? []).find((r) => r.uid === reviewing) ?? null : null

  return (
    <Shell eyebrow="People" title="Registration requests">
      <p className="text-[13px] mb-5 -mt-1 max-w-2xl" style={{ color: 'var(--color-char-soft)' }}>
        {isPrimary
          ? 'People who signed up themselves. You approve Institution Admins; college roles are normally approved by the college’s admin, and you can step in for them.'
          : 'Students, faculty, HODs and principals who signed up for your college. Nobody can use USOP until you approve them.'}
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-5">
        <div className="flex gap-5 border-b" style={{ borderColor: 'var(--color-line)' }}>
          {TABS.map((t) => {
            const active = tab === t.key
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="pb-2 -mb-px text-[13.5px] font-medium border-b-2 transition-colors"
                style={{ borderColor: active ? 'var(--color-gold)' : 'transparent', color: active ? 'var(--color-char)' : 'var(--color-char-soft)' }}
              >
                {t.label}
                <span className="ml-1.5 tabular-nums text-[12px]" style={{ color: t.key === 'pending' && counts.pending ? 'var(--color-gold)' : 'inherit' }}>
                  {counts[t.key]}
                </span>
              </button>
            )
          })}
        </div>
        <div className="relative ml-auto w-full sm:w-[260px]">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: 'var(--color-char-soft)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, email, mobile, reg. no."
            className="w-full pl-9 pr-3 py-2 text-[13px] rounded-full border outline-none focus:border-[var(--color-gold)]"
            style={{ borderColor: 'var(--color-line)', backgroundColor: 'var(--color-paper-raised)', color: 'var(--color-char)' }}
          />
        </div>
      </div>

      {loadError ? (
        <Card>
          <p className="text-[13.5px]" style={{ color: 'var(--color-clay)' }}>
            Couldn’t load requests. The new database rules may not be deployed yet.
          </p>
        </Card>
      ) : requests === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : list.length === 0 ? (
        <Card className="text-center py-10">
          <Icon name="inbox" className="h-6 w-6 mx-auto mb-2" style={{ color: 'var(--color-gold)' }} />
          <p className="text-[13.5px]" style={{ color: 'var(--color-char)' }}>
            {tab === 'pending' ? 'No one is waiting for approval.' : `No ${tab} requests${search ? ' match your search' : ''}.`}
          </p>
        </Card>
      ) : (
        <div className="rounded-[6px] border overflow-x-auto" style={{ borderColor: 'var(--color-line)' }}>
          <div className="min-w-[640px]">
            {list.map((r, i) => (
              <div
                key={r.uid}
                className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-black/[0.02]"
                style={{ borderTop: i === 0 ? undefined : '1px solid var(--color-line)' }}
              >
                <div
                  className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center font-display text-[14px] border"
                  style={{ borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)' }}
                >
                  {r.name.trim()[0]?.toUpperCase() ?? '·'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[15.5px] leading-tight truncate" style={{ color: 'var(--color-char)' }}>
                    {r.name}
                  </div>
                  <div className="text-[11.5px] truncate" style={{ color: 'var(--color-char-soft)' }}>
                    +91 {r.phone} · {r.email}
                    {tab === 'pending' && (
                      <span className="ml-1.5 font-medium" style={{ color: r.emailVerified ? 'var(--color-teal)' : 'var(--color-clay)' }}>
                        {r.emailVerified ? '✓ verified' : '⚠ email not verified'}
                      </span>
                    )}
                  </div>
                </div>
                <div className="w-[190px] min-w-0">
                  <Badge tone={r.approver === 'primary' ? 'gold' : 'neutral'}>{ROLE_LABELS[r.role]}</Badge>
                  <div className="text-[11.5px] mt-1 truncate" style={{ color: 'var(--color-char-soft)' }}>
                    {r.role === 'student'
                      ? `Year ${r.mbbsYear} · ${r.rollNumber}`
                      : (deptName(r.institutionId, r.departmentId) ?? (isPrimary ? collegeName(r.institutionId) : ''))}
                  </div>
                </div>
                <div className="w-[130px] text-[11.5px] font-mono" style={{ color: 'var(--color-char-soft)' }}>
                  {fmt(tab === 'pending' ? r.submittedAt : r.decidedAt)}
                </div>
                <div className="w-[96px] flex justify-end">
                  {tab === 'pending' ? (
                    <PrimaryButton onClick={() => setReviewing(r.uid)}>Review</PrimaryButton>
                  ) : (
                    <GhostButton onClick={() => setReviewing(r.uid)}>View</GhostButton>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {current && options && (
        <ReviewModal
          request={current}
          isPrimary={isPrimary}
          options={options}
          collegeName={collegeName}
          deptName={deptName}
          onClose={() => setReviewing(null)}
        />
      )}
    </Shell>
  )
}

function ReviewModal({
  request: r,
  isPrimary,
  options,
  collegeName,
  deptName,
  onClose,
}: {
  request: RegistrationRequest
  isPrimary: boolean
  options: RegistrationOptions
  collegeName: (id: string | null) => string
  deptName: (inst: string | null, id: string | null) => string | null
  onClose: () => void
}) {
  const pending = r.status === 'pending'
  // Editable copy — the approver may correct details before approving.
  const [name, setName] = useState(r.name)
  const [role, setRole] = useState<Role>(r.role)
  const [institutionId, setInstitutionId] = useState(r.institutionId ?? '')
  const [mbbsYear, setMbbsYear] = useState<MbbsYear>(r.mbbsYear ?? 1)
  const [rollNumber, setRollNumber] = useState(r.rollNumber ?? '')
  const [associatedYears, setAssociatedYears] = useState<MbbsYear[]>(r.associatedMbbsYears ?? [])
  const [departmentId, setDepartmentId] = useState(r.departmentId ?? '')
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Ask the server for the live email status (the person may have clicked
  // the link a moment ago); it also updates the request for the list.
  const [emailVerified, setEmailVerified] = useState(r.emailVerified === true)
  const [checkingEmail, setCheckingEmail] = useState(false)
  async function recheckEmail() {
    setCheckingEmail(true)
    try {
      setEmailVerified((await syncEmailStatus({ uid: r.uid })).emailVerified)
    } catch {
      /* keep what we have */
    } finally {
      setCheckingEmail(false)
    }
  }
  useEffect(() => {
    if (r.status === 'pending' && !r.emailVerified) void recheckEmail()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.uid])
  useEffect(() => {
    if (r.emailVerified) setEmailVerified(true)
  }, [r.emailVerified])

  const platformWide = role === 'skillLabDirector'
  const needsDept = role === 'faculty' || role === 'hod'
  const roleChoices = isPrimary ? ALL_ROLES : COLLEGE_ROLES
  const deptOptions = useMemo(() => {
    const all = institutionId ? (options.departments[institutionId] ?? []) : []
    return role === 'faculty' ? all.filter((d) => associatedYears.includes(d.mbbsYear)) : all
  }, [options, institutionId, role, associatedYears])

  // People already in this college, for the duplicate / clash warnings.
  const [collegeUsers, setCollegeUsers] = useState<AppUser[]>([])
  useEffect(() => {
    if (!institutionId || platformWide) {
      setCollegeUsers([])
      return
    }
    return watchInstitutionUsers(institutionId, setCollegeUsers)
  }, [institutionId, platformWide])

  const warnings = useMemo(() => {
    const w: string[] = []
    if (role === 'student' && rollNumber.trim()) {
      const clash = collegeUsers.find((u) => u.rollNumber?.trim().toLowerCase() === rollNumber.trim().toLowerCase())
      if (clash) w.push(`Registration number ${rollNumber.trim()} already belongs to ${clash.name}.`)
    }
    if (role === 'hod' && departmentId) {
      const hod = collegeUsers.find((u) => u.role === 'hod' && u.departmentId === departmentId && u.active)
      if (hod) w.push(`${deptName(institutionId, departmentId)} already has an HOD: ${hod.name}.`)
    }
    if (role === 'principal') {
      const p = collegeUsers.find((u) => u.role === 'principal' && u.active)
      if (p) w.push(`This college already has a Principal: ${p.name}.`)
    }
    if (role === 'institutionAdmin') {
      const a = collegeUsers.filter((u) => u.role === 'institutionAdmin' && u.active)
      if (a.length) w.push(`This college already has ${a.length} Institution Admin${a.length > 1 ? 's' : ''}: ${a.map((u) => u.name).join(', ')}.`)
    }
    if (needsDept && departmentId && !deptOptions.some((d) => d.id === departmentId)) w.push('The chosen department isn’t available for this college / these years.')
    return w
  }, [role, rollNumber, departmentId, institutionId, collegeUsers, deptName, needsDept, deptOptions])

  const valid =
    name.trim() !== '' &&
    (platformWide || institutionId !== '') &&
    (!needsDept || deptOptions.some((d) => d.id === departmentId)) &&
    (role !== 'student' || rollNumber.trim() !== '') &&
    (role !== 'faculty' || associatedYears.length > 0)

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true)
    setError(null)
    try {
      await decideRegistration(
        decision === 'reject'
          ? { uid: r.uid, decision, reason: reason.trim() }
          : {
              uid: r.uid,
              decision,
              edits: {
                name: name.trim(),
                role,
                institutionId: platformWide ? null : institutionId,
                departmentId: needsDept ? departmentId : null,
                mbbsYear: role === 'student' ? mbbsYear : null,
                associatedMbbsYears: role === 'faculty' ? associatedYears : null,
                rollNumber: role === 'student' ? rollNumber.trim() : null,
              },
            },
      )
      onClose()
    } catch (e) {
      setError(accountErrorMessage(e, 'Couldn’t save the decision. Please try again.'))
      setBusy(false)
    }
  }

  const fieldStyle = { borderColor: 'var(--color-line)' }

  return (
    <Modal title={pending ? `Review ${r.name}` : r.name} onClose={onClose} wide>
      <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[13px] mb-5">
        <span style={{ color: 'var(--color-char-soft)' }}>Mobile</span>
        <span className="font-mono" style={{ color: 'var(--color-char)' }}>
          +91 {r.phone} <span className="text-[11px] font-sans" style={{ color: 'var(--color-teal)' }}>· verified by OTP</span>
        </span>
        <span style={{ color: 'var(--color-char-soft)' }}>Email</span>
        <span style={{ color: 'var(--color-char)' }}>
          {r.email}{' '}
          {pending &&
            (emailVerified ? (
              <span className="text-[11px]" style={{ color: 'var(--color-teal)' }}>
                · verified by link
              </span>
            ) : (
              <span className="text-[11px]" style={{ color: 'var(--color-clay)' }}>
                · not verified yet{' '}
                <button type="button" onClick={() => void recheckEmail()} disabled={checkingEmail} className="underline ml-1" style={{ color: 'var(--color-char-soft)' }}>
                  {checkingEmail ? 'checking…' : 'check again'}
                </button>
              </span>
            ))}
        </span>
        <span style={{ color: 'var(--color-char-soft)' }}>Sent</span>
        <span style={{ color: 'var(--color-char)' }}>
          {fmt(r.submittedAt)}
          {r.firstSubmittedAt && r.firstSubmittedAt !== r.submittedAt ? ` (resent — first sent ${fmt(r.firstSubmittedAt)})` : ''}
        </span>
        {!pending && (
          <>
            <span style={{ color: 'var(--color-char-soft)' }}>{r.status === 'approved' ? 'Approved' : 'Rejected'}</span>
            <span style={{ color: 'var(--color-char)' }}>
              {fmt(r.decidedAt)} by {r.decidedByName || '—'}
            </span>
          </>
        )}
        {r.status === 'rejected' && r.reason && (
          <>
            <span style={{ color: 'var(--color-char-soft)' }}>Reason</span>
            <span style={{ color: 'var(--color-clay)' }}>{r.reason}</span>
          </>
        )}
      </div>

      {pending ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5">
          <Field label="Full name">
            <input className={inputClass} style={fieldStyle} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Role">
            <select className={inputClass} style={fieldStyle} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {roleChoices.map((x) => (
                <option key={x} value={x}>
                  {ROLE_LABELS[x]}
                </option>
              ))}
            </select>
          </Field>
          {!platformWide && (
            <Field label="College">
              <select
                className={inputClass}
                style={{ ...fieldStyle, opacity: isPrimary ? 1 : 0.6 }}
                value={institutionId}
                disabled={!isPrimary}
                onChange={(e) => setInstitutionId(e.target.value)}
              >
                <option value="">Select a college</option>
                {options.institutions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {role === 'student' && (
            <>
              <Field label="MBBS year">
                <select className={inputClass} style={fieldStyle} value={mbbsYear} onChange={(e) => setMbbsYear(Number(e.target.value) as MbbsYear)}>
                  {YEARS.map((y) => (
                    <option key={y} value={y}>
                      Year {y}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Registration number">
                <input className={inputClass} style={fieldStyle} value={rollNumber} onChange={(e) => setRollNumber(e.target.value)} />
              </Field>
            </>
          )}
          {role === 'faculty' && (
            <div className="sm:col-span-2 mb-4">
              <span className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                MBBS years they teach
              </span>
              <div className="flex flex-wrap gap-2">
                {YEARS.map((y) => {
                  const on = associatedYears.includes(y)
                  return (
                    <button
                      key={y}
                      type="button"
                      onClick={() => setAssociatedYears((p) => (p.includes(y) ? p.filter((v) => v !== y) : [...p, y].sort()))}
                      className="px-3 py-1.5 text-[12.5px] font-medium border"
                      style={{
                        borderColor: on ? 'var(--color-gold)' : 'var(--color-line)',
                        backgroundColor: on ? 'var(--color-gold-soft)' : 'transparent',
                        color: on ? 'var(--color-gold)' : 'var(--color-char-soft)',
                      }}
                    >
                      Year {y}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {needsDept && (
            <Field label="Department">
              <select className={inputClass} style={fieldStyle} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">Select a department</option>
                {deptOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} — Year {d.mbbsYear}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[13px] mb-4">
          <span style={{ color: 'var(--color-char-soft)' }}>Role</span>
          <span style={{ color: 'var(--color-char)' }}>{ROLE_LABELS[r.role]}</span>
          <span style={{ color: 'var(--color-char-soft)' }}>College</span>
          <span style={{ color: 'var(--color-char)' }}>{collegeName(r.institutionId)}</span>
          {r.role === 'student' && (
            <>
              <span style={{ color: 'var(--color-char-soft)' }}>Year · Reg. no.</span>
              <span style={{ color: 'var(--color-char)' }}>
                Year {r.mbbsYear} · {r.rollNumber}
              </span>
            </>
          )}
          {deptName(r.institutionId, r.departmentId) && (
            <>
              <span style={{ color: 'var(--color-char-soft)' }}>Department</span>
              <span style={{ color: 'var(--color-char)' }}>{deptName(r.institutionId, r.departmentId)}</span>
            </>
          )}
        </div>
      )}

      {pending && warnings.length > 0 && (
        <div className="rounded-[8px] px-3.5 py-2.5 mb-4 text-[12.5px] space-y-1" style={{ backgroundColor: 'var(--color-gold-soft)', color: 'var(--color-char)' }}>
          {warnings.map((w) => (
            <div key={w}>⚠ {w}</div>
          ))}
        </div>
      )}

      {pending && rejecting && (
        <Field label="Reason (the person will see this)">
          <textarea
            autoFocus
            rows={3}
            className={inputClass}
            style={fieldStyle}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Registration number doesn’t match our records — please check it."
          />
        </Field>
      )}

      {pending && !emailVerified && !rejecting && (
        <div className="rounded-[8px] px-3.5 py-2.5 mb-4 text-[12.5px]" style={{ backgroundColor: 'var(--color-clay-soft)', color: 'var(--color-char)' }}>
          Waiting for {r.name.split(' ')[0] || 'them'} to click the link we emailed to <span className="font-medium">{r.email}</span>. You can approve once
          it’s verified — or reject with a reason if the email looks wrong.
        </div>
      )}

      {error && (
        <div className="mb-4">
          <Badge tone="clay">{error}</Badge>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {!pending ? (
          <GhostButton onClick={onClose}>Close</GhostButton>
        ) : rejecting ? (
          <>
            <GhostButton onClick={() => setRejecting(false)} disabled={busy}>
              Back
            </GhostButton>
            <GhostButton tone="danger" onClick={() => decide('reject')} disabled={busy || reason.trim() === ''}>
              {busy ? 'Saving…' : 'Reject request'}
            </GhostButton>
          </>
        ) : (
          <>
            <GhostButton tone="danger" onClick={() => setRejecting(true)} disabled={busy}>
              Reject…
            </GhostButton>
            <PrimaryButton onClick={() => decide('approve')} disabled={busy || !valid || !emailVerified}>
              {busy ? 'Approving…' : 'Approve'}
            </PrimaryButton>
          </>
        )}
      </div>
    </Modal>
  )
}
