import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { useAuth } from './AuthContext'
import { AuthCard, ErrorLine, Field, MobileField, SubmitButton, TextLink, inputCls, inputStyle } from './authUi'
import {
  accountErrorMessage,
  cancelRegistration,
  getRegistrationOptions,
  submitRegistration,
  watchMyRegistration,
  type RegistrationOptions,
} from '../lib/accounts'
import type { MbbsYear, RegistrationRequest, Role } from '../types'

// /register — for someone signed in (their mobile is verified) who has no
// approved profile yet. Shows the registration form, then the request's
// status: waiting for approval, or rejected with the reason (edit & resend).
// The moment it's approved the profile appears and "/" takes them home.

const REGISTER_ROLES: { role: Role; label: string; hint: string }[] = [
  { role: 'student', label: 'Student', hint: 'Approved by your college' },
  { role: 'faculty', label: 'Faculty', hint: 'Approved by your college' },
  { role: 'hod', label: 'Head of Department', hint: 'Approved by your college' },
  { role: 'principal', label: 'Principal', hint: 'Approved by your college' },
  { role: 'institutionAdmin', label: 'Institution Admin', hint: 'Approved by the platform admin' },
  { role: 'skillLabDirector', label: 'Skill Lab Director', hint: 'Approved by the platform admin' },
]
const ROLE_LABEL = Object.fromEntries(REGISTER_ROLES.map((r) => [r.role, r.label])) as Record<Role, string>
const YEARS: MbbsYear[] = [1, 2, 3, 4]
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const fmt = (ms: number) => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function RegisterPage() {
  const { firebaseUser, appUser, loading } = useAuth()
  const uid = firebaseUser?.uid ?? null

  const [request, setRequest] = useState<RegistrationRequest | null | undefined>(undefined)
  useEffect(() => {
    if (!uid) return
    return watchMyRegistration(uid, setRequest, () => setRequest(null))
  }, [uid])

  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)

  if (loading) return null
  if (!firebaseUser) return <Navigate to="/login" replace />
  if (appUser) return <Navigate to="/" replace />

  const mobile = firebaseUser.phoneNumber?.replace(/^\+91/, '') ?? ''

  async function withdraw() {
    setBusy(true)
    setError(null)
    try {
      await cancelRegistration({})
      await signOut(auth).catch(() => {})
    } catch (e) {
      setError(accountErrorMessage(e))
      setBusy(false)
    }
  }

  if (!mobile) {
    return (
      <AuthCard subtitle="Create an account">
        <p className="text-[13.5px] mb-4" style={{ color: 'var(--color-char)' }}>
          This login has no account yet. Ask your administrator, or sign out and create an account with your mobile number.
        </p>
        <SignOutRow />
      </AuthCard>
    )
  }

  if (request === undefined) {
    return (
      <AuthCard subtitle="Create an account">
        <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
          Loading…
        </p>
      </AuthCard>
    )
  }

  const showForm = request === null || editing

  if (showForm) {
    return (
      <AuthCard subtitle={request ? 'Edit your request' : 'Create an account'} wide>
        <RegistrationForm
          mobile={mobile}
          existing={request}
          email={firebaseUser.email ?? ''}
          onDone={() => setEditing(false)}
          onCancelEdit={request ? () => setEditing(false) : undefined}
        />
        {!request && (
          <div className="mt-6 pt-4 border-t text-center text-[12.5px]" style={{ borderColor: 'var(--color-line)', color: 'var(--color-char-soft)' }}>
            Changed your mind? <TextLink tone="soft" onClick={withdraw}>Cancel and remove this number</TextLink>
          </div>
        )}
      </AuthCard>
    )
  }

  const rejected = request.status === 'rejected'
  const approved = request.status === 'approved'
  const approverText = request.approver === 'primary' ? 'the platform admin' : 'your college’s admin'

  return (
    <AuthCard subtitle={approved ? 'Account approved' : rejected ? 'Request not approved' : 'Waiting for approval'} wide>
      <div
        className="rounded-[10px] px-4 py-3.5 mb-5"
        style={{ backgroundColor: approved ? 'var(--color-teal-soft)' : rejected ? 'var(--color-clay-soft)' : 'var(--color-gold-soft)' }}
      >
        <div className="text-[14px] font-medium" style={{ color: approved ? 'var(--color-teal)' : rejected ? 'var(--color-clay)' : 'var(--color-char)' }}>
          {approved ? 'Approved — opening your dashboard…' : rejected ? 'Your request wasn’t approved' : `Sent to ${approverText}`}
        </div>
        <p className="text-[12.5px] mt-1 leading-relaxed" style={{ color: 'var(--color-char)' }}>
          {rejected ? (
            <>
              <span className="font-medium">Reason:</span> {request.reason}
              <br />
              Fix the details below and send it again.
            </>
          ) : approved ? null : (
            <>
              You’ll be able to use USOP as soon as {approverText} approves your account. Keep this page open or come back later — sign in with
              your mobile number or email.
            </>
          )}
        </p>
      </div>

      <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-[13px] mb-6">
        <Row k="Name" v={request.name} />
        <Row k="Role" v={ROLE_LABEL[request.role] ?? request.role} />
        <Row k="Mobile" v={`+91 ${request.phone}`} mono />
        <Row k="Email" v={request.email} />
        {request.role === 'student' && <Row k="Year" v={`Year ${request.mbbsYear} · Reg. no. ${request.rollNumber}`} />}
        <Row k="Sent" v={fmt(request.submittedAt)} />
      </dl>

      <ErrorLine error={error} />

      <div className="flex flex-wrap items-center gap-2 mt-4">
        {!approved && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="chamfer-sm px-4 py-2.5 text-[13px] font-medium"
            style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-frost)' }}
          >
            {rejected ? 'Edit and send again' : 'Edit request'}
          </button>
        )}
        <button
          type="button"
          onClick={() => signOut(auth)}
          className="px-4 py-2.5 text-[13px] font-medium rounded-[6px] border"
          style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
        >
          Sign out
        </button>
        {!approved && (
          <span className="ml-auto text-[12.5px]">
            {confirmCancel ? (
              <span style={{ color: 'var(--color-clay)' }}>
                Withdraw and delete this login?{' '}
                <button type="button" disabled={busy} onClick={withdraw} className="font-medium underline">
                  {busy ? 'Removing…' : 'Yes'}
                </button>{' '}
                <button type="button" onClick={() => setConfirmCancel(false)} className="underline" style={{ color: 'var(--color-char-soft)' }}>
                  No
                </button>
              </span>
            ) : (
              <TextLink tone="soft" onClick={() => setConfirmCancel(true)}>
                Withdraw request
              </TextLink>
            )}
          </span>
        )}
      </div>
    </AuthCard>
  )
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <>
      <dt style={{ color: 'var(--color-char-soft)' }}>{k}</dt>
      <dd className={mono ? 'font-mono' : ''} style={{ color: 'var(--color-char)' }}>
        {v}
      </dd>
    </>
  )
}

function SignOutRow() {
  return <TextLink tone="soft" onClick={() => signOut(auth)}>Sign out</TextLink>
}

function RegistrationForm({
  mobile,
  existing,
  email: authEmail,
  onDone,
  onCancelEdit,
}: {
  mobile: string
  existing: RegistrationRequest | null
  email: string
  onDone: () => void
  onCancelEdit?: () => void
}) {
  const [options, setOptions] = useState<RegistrationOptions | null>(null)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  useEffect(() => {
    getRegistrationOptions({})
      .then(setOptions)
      .catch((e) => setOptionsError(accountErrorMessage(e, 'Couldn’t load the list of colleges. Reload the page to try again.')))
  }, [])

  const [role, setRole] = useState<Role>(existing?.role ?? 'student')
  const [name, setName] = useState(existing?.name ?? '')
  const [email, setEmail] = useState(existing?.email ?? authEmail)
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [stateFilter, setStateFilter] = useState('')
  const [institutionId, setInstitutionId] = useState(existing?.institutionId ?? '')
  const [mbbsYear, setMbbsYear] = useState<MbbsYear>(existing?.mbbsYear ?? 1)
  const [rollNumber, setRollNumber] = useState(existing?.rollNumber ?? '')
  const [associatedYears, setAssociatedYears] = useState<MbbsYear[]>(existing?.associatedMbbsYears ?? [])
  const [departmentId, setDepartmentId] = useState(existing?.departmentId ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const platformWide = role === 'skillLabDirector'
  const needsDept = role === 'faculty' || role === 'hod'
  const states = useMemo(() => [...new Set((options?.institutions ?? []).map((i) => i.state).filter(Boolean))].sort(), [options])
  const colleges = useMemo(
    () => (options?.institutions ?? []).filter((i) => stateFilter === '' || i.state === stateFilter),
    [options, stateFilter],
  )
  const deptOptions = useMemo(() => {
    const all = institutionId ? (options?.departments[institutionId] ?? []) : []
    return role === 'faculty' ? all.filter((d) => associatedYears.includes(d.mbbsYear)) : all
  }, [options, institutionId, role, associatedYears])

  // Keep the department valid as the college / years change.
  useEffect(() => {
    if (departmentId && options && !deptOptions.some((d) => d.id === departmentId)) setDepartmentId('')
  }, [deptOptions, departmentId, options])

  const needsPassword = !existing
  const valid =
    name.trim() !== '' &&
    EMAIL_RE.test(email.trim()) &&
    (needsPassword ? password.length >= 6 : password === '' || password.length >= 6) &&
    (platformWide || institutionId !== '') &&
    (!needsDept || departmentId !== '') &&
    (role !== 'student' || rollNumber.trim() !== '') &&
    (role !== 'faculty' || associatedYears.length > 0)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setError(null)
    try {
      await submitRegistration({
        role,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        institutionId: platformWide ? null : institutionId,
        departmentId: needsDept ? departmentId : null,
        mbbsYear: role === 'student' ? mbbsYear : null,
        associatedMbbsYears: role === 'faculty' ? associatedYears : null,
        rollNumber: role === 'student' ? rollNumber.trim() : null,
        ...(password ? { password } : {}),
      })
      onDone()
    } catch (err) {
      setError(accountErrorMessage(err, 'Couldn’t send your request. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  const selectCls = `${inputCls} appearance-auto`

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="I am a">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {REGISTER_ROLES.map((r) => {
            const active = role === r.role
            return (
              <button
                key={r.role}
                type="button"
                onClick={() => setRole(r.role)}
                className="rounded-[10px] border px-3 py-2 text-left transition-colors"
                style={{
                  borderColor: active ? 'var(--color-gold)' : 'var(--color-line)',
                  backgroundColor: active ? 'var(--color-gold-soft)' : 'var(--color-paper-raised)',
                }}
              >
                <div className="text-[13px] font-medium" style={{ color: 'var(--color-char)' }}>
                  {r.label}
                </div>
                <div className="text-[10.5px]" style={{ color: 'var(--color-char-soft)' }}>
                  {r.hint}
                </div>
              </button>
            )
          })}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Full name" htmlFor="reg-name">
          <input id="reg-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="As on your college records" className={inputCls} style={inputStyle} />
        </Field>
        <MobileField value={mobile} disabled />
        <Field label="Email" htmlFor="reg-email" hint="You can also sign in with this email.">
          <input id="reg-email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} style={inputStyle} />
        </Field>
        <Field label={needsPassword ? 'Password' : 'New password (optional)'} htmlFor="reg-password" hint={needsPassword ? 'At least 6 characters.' : 'Leave blank to keep your current one.'}>
          <div className="relative">
            <input
              id="reg-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${inputCls} pr-14`}
              style={inputStyle}
            />
            <button type="button" onClick={() => setShowPassword((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </Field>
      </div>

      {!platformWide && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="State" htmlFor="reg-state">
            <select id="reg-state" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className={selectCls} style={inputStyle} disabled={!options}>
              <option value="">All states</option>
              {states.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Field>
          <Field label="College" htmlFor="reg-college">
            <select id="reg-college" required value={institutionId} onChange={(e) => setInstitutionId(e.target.value)} className={selectCls} style={inputStyle} disabled={!options}>
              <option value="">{options ? 'Select your college' : 'Loading…'}</option>
              {colleges.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.city ? ` — ${c.city}` : ''}
                </option>
              ))}
              {/* Keep a picked college visible even when the state filter hides it. */}
              {institutionId && !colleges.some((c) => c.id === institutionId) && (
                <option value={institutionId}>{options?.institutions.find((c) => c.id === institutionId)?.name ?? 'Selected college'}</option>
              )}
            </select>
          </Field>
        </div>
      )}

      {role === 'student' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="MBBS year" htmlFor="reg-year">
            <select id="reg-year" value={mbbsYear} onChange={(e) => setMbbsYear(Number(e.target.value) as MbbsYear)} className={selectCls} style={inputStyle}>
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Registration number" htmlFor="reg-roll">
            <input id="reg-roll" required value={rollNumber} onChange={(e) => setRollNumber(e.target.value)} placeholder="e.g. MBBS2026-0142" className={inputCls} style={inputStyle} />
          </Field>
        </div>
      )}

      {role === 'faculty' && (
        <Field label="MBBS years you teach">
          <div className="flex flex-wrap gap-2">
            {YEARS.map((y) => {
              const active = associatedYears.includes(y)
              return (
                <button
                  key={y}
                  type="button"
                  onClick={() => setAssociatedYears((p) => (p.includes(y) ? p.filter((v) => v !== y) : [...p, y].sort()))}
                  className="rounded-full border px-3.5 py-1.5 text-[12.5px] font-medium"
                  style={{
                    borderColor: active ? 'var(--color-gold)' : 'var(--color-line)',
                    backgroundColor: active ? 'var(--color-gold-soft)' : 'transparent',
                    color: active ? 'var(--color-gold)' : 'var(--color-char-soft)',
                  }}
                >
                  Year {y}
                </button>
              )
            })}
          </div>
        </Field>
      )}

      {needsDept && (
        <Field label="Department" htmlFor="reg-dept">
          <select
            id="reg-dept"
            required
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className={selectCls}
            style={inputStyle}
            disabled={!institutionId || (role === 'faculty' && associatedYears.length === 0)}
          >
            <option value="">
              {!institutionId
                ? 'Select your college first'
                : role === 'faculty' && associatedYears.length === 0
                  ? 'Select your years first'
                  : deptOptions.length === 0
                    ? 'No departments available'
                    : 'Select your department'}
            </option>
            {deptOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} — Year {d.mbbsYear}
              </option>
            ))}
          </select>
        </Field>
      )}

      <ErrorLine error={optionsError ?? error} />
      <SubmitButton busy={busy} disabled={!valid} label={existing ? 'Send again for approval' : 'Send for approval'} busyLabel="Sending…" />
      {onCancelEdit && (
        <p className="text-center text-[12.5px]">
          <TextLink tone="soft" onClick={onCancelEdit}>
            Back without changes
          </TextLink>
        </p>
      )}
    </form>
  )
}
