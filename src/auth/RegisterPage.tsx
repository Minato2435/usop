import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Icon, type IconName } from '../roles/primary-admin/shell/Icon'
import { signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { useAuth } from './AuthContext'
import { AuthCard, ErrorLine, Field, SubmitButton, TextLink, inputCls, inputStyle } from './authUi'
import { describeAuthError, isValidMobile, normalizeMobile, usePhoneOtp } from './phoneOtp'
import { sendVerificationEmail, useEmailVerification } from './emailVerify'
import { suggestEmailFix } from '../lib/emailTypos'
import {
  accountErrorMessage,
  cancelRegistration,
  getRegistrationOptions,
  submitRegistration,
  watchMyRegistration,
  type RegistrationOptions,
} from '../lib/accounts'
import type { MbbsYear, RegistrationRequest, Role } from '../types'
import { regNoHelp } from '../lib/registrationNumber'

// /register — "Create an account". The form opens straight away; the mobile
// number is verified by OTP inside the form (that creates the login), then
// "Send for approval" sends the request. After that this page shows the
// request's status: waiting, or rejected with the reason (edit & resend).
// The moment it's approved the profile appears and "/" takes them home.
//
// The typed details live here, in the page, so they survive the moment the
// OTP signs the person in and the app reloads their (missing) profile.

const REGISTER_ROLES: { role: Role; label: string; hint: string; icon: IconName }[] = [
  { role: 'student', label: 'Student', hint: 'Log activities and track your skills', icon: 'cap' },
  { role: 'faculty', label: 'Faculty', hint: 'Review and assess students', icon: 'users' },
  { role: 'hod', label: 'Head of Department', hint: 'Oversee your department', icon: 'departments' },
  { role: 'principal', label: 'Principal', hint: 'College-wide reports', icon: 'crest' },
  { role: 'institutionAdmin', label: 'Institution Admin', hint: 'Manage your college on USOP', icon: 'institutions' },
]
const ROLE_LABEL: Partial<Record<Role, string>> = Object.fromEntries(REGISTER_ROLES.map((r) => [r.role, r.label]))
const YEARS: MbbsYear[] = [1, 2, 3, 4]
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const fmt = (ms: number) => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

interface Draft {
  role: Role
  name: string
  email: string
  password: string
  mobile: string
  stateFilter: string
  institutionId: string
  mbbsYear: MbbsYear
  rollNumber: string
  associatedYears: MbbsYear[]
  departmentId: string
}

// The half-filled form is kept in this browser (never the password), so
// closing the page and coming back picks up where they left off.
const DRAFT_KEY = 'usop.register.draft'
function loadSavedDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as Partial<Draft>
    const base = draftFrom(null)
    const merged = { ...base, ...d, password: '' }
    // Only worth restoring if something was actually typed.
    return merged.name || merged.email || merged.institutionId || merged.mobile ? merged : null
  } catch {
    return null
  }
}
function saveDraft(d: Draft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...d, password: '' }))
  } catch {
    /* private mode — fine */
  }
}
function clearSavedDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    /* fine */
  }
}

function draftFrom(r: RegistrationRequest | null, mobile = ''): Draft {
  return {
    role: r?.role ?? 'student',
    name: r?.name ?? '',
    email: r?.email ?? '',
    password: '',
    mobile: r?.phone ?? mobile,
    stateFilter: '',
    institutionId: r?.institutionId ?? '',
    mbbsYear: r?.mbbsYear ?? 1,
    rollNumber: r?.rollNumber ?? '',
    associatedYears: r?.associatedMbbsYears ?? [],
    departmentId: r?.departmentId ?? '',
  }
}

export function RegisterPage() {
  const { firebaseUser, appUser, loading } = useAuth()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const uid = firebaseUser?.uid ?? null

  const [initial] = useState(() => {
    const fromLink = normalizeMobile(params.get('mobile') ?? '').slice(0, 10)
    const saved = loadSavedDraft()
    return saved && (!fromLink || fromLink === saved.mobile) ? { draft: saved, restored: true } : { draft: draftFrom(null, fromLink), restored: false }
  })
  const [restored, setRestored] = useState(initial.restored)
  const [draft, setDraft] = useState<Draft>(initial.draft)
  const [request, setRequest] = useState<RegistrationRequest | null | undefined>(undefined)
  useEffect(() => {
    if (!uid) {
      setRequest(undefined)
      return
    }
    return watchMyRegistration(uid, setRequest, () => setRequest(null))
  }, [uid])

  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [leaving, setLeaving] = useState(false)
  // Just sent: wait until the saved request (new submittedAt) arrives, so the
  // old one — e.g. its old, verified email — never flashes on screen.
  const [awaiting, setAwaiting] = useState<{ prev: number | null } | null>(null)
  // "Send for approval" is running: keep the form on screen until it has
  // finished (re-sign-in + verification email), so the status page doesn't
  // appear half-way and send a second link.
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => {
    if (awaiting && request && request.submittedAt !== awaiting.prev) setAwaiting(null)
  }, [awaiting, request])
  useEffect(() => {
    if (!awaiting) return
    const t = setTimeout(() => setAwaiting(null), 8000) // never wait forever
    return () => clearTimeout(t)
  }, [awaiting])

  // Keep the new (not yet sent) form saved while they type.
  const sentAlready = !!request
  useEffect(() => {
    if (!sentAlready) saveDraft(draft)
  }, [draft, sentAlready])

  if (appUser) return <Navigate to="/" replace />
  // Signing out from the status view: don't flash the empty form meanwhile.
  if (leaving) return <AuthCard subtitle="Signing out…"><p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>Signing out…</p></AuthCard>

  const verifiedMobile = firebaseUser?.phoneNumber?.replace(/^\+91/, '') ?? null

  async function withdraw() {
    setBusy(true)
    setError(null)
    try {
      await cancelRegistration({})
      clearSavedDraft()
      await signOut(auth).catch(() => {})
      setDraft((d) => ({ ...d, mobile: '' }))
      setConfirmCancel(false)
    } catch (e) {
      setError(accountErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  // Signed in with email but there's no profile and no mobile on this login
  // (e.g. a half-made account) — nothing to register from here.
  if (firebaseUser && !verifiedMobile && !loading && !submitting) {
    return (
      <AuthCard subtitle="Create an account">
        <p className="text-[13.5px] mb-4" style={{ color: 'var(--color-char)' }}>
          This login has no account yet. Sign out and create an account with your mobile number, or ask your administrator.
        </p>
        <TextLink tone="soft" onClick={() => signOut(auth)}>
          Sign out
        </TextLink>
      </AuthCard>
    )
  }

  // Waiting for the app to load the request after signing in.
  if (firebaseUser && (loading || request === undefined) && !submitting) {
    return (
      <AuthCard subtitle="Create an account">
        <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
          Loading…
        </p>
      </AuthCard>
    )
  }

  if (awaiting) {
    return (
      <AuthCard subtitle="Sending your request…">
        <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
          Sending your request…
        </p>
      </AuthCard>
    )
  }

  const showForm = !firebaseUser || !request || editing || submitting

  if (showForm) {
    return (
      <AuthCard subtitle={request ? 'Edit your request' : 'Create an account'} wide>
        {restored && !request && (
          <div className="mb-5 flex items-center gap-3 rounded-[10px] px-3.5 py-2.5 text-[12.5px]" style={{ backgroundColor: 'var(--color-gold-soft)', color: 'var(--color-char)' }}>
            <span className="flex-1">Picked up where you left off.</span>
            <TextLink
              tone="soft"
              onClick={() => {
                clearSavedDraft()
                setRestored(false)
                setDraft((d) => ({ ...draftFrom(null), mobile: firebaseUser ? d.mobile : '' }))
              }}
            >
              Start over
            </TextLink>
          </div>
        )}
        <RegistrationForm
          draft={draft}
          setDraft={setDraft}
          verifiedMobile={verifiedMobile}
          existing={request ?? null}
          onDone={(prev) => {
            clearSavedDraft()
            setRestored(false)
            setAwaiting({ prev })
            setEditing(false)
          }}
          onBusy={setSubmitting}
          onUseOtherNumber={withdraw}
          onCancelEdit={request ? () => setEditing(false) : undefined}
        />
        <div className="mt-6 pt-4 border-t text-center text-[12.5px]" style={{ borderColor: 'var(--color-line)', color: 'var(--color-char-soft)' }}>
          {firebaseUser ? (
            <>
              Changed your mind? <TextLink tone="soft" onClick={withdraw}>Cancel and remove this number</TextLink>
            </>
          ) : (
            <>
              Already have an account?{' '}
              <Link to="/login" className="font-medium underline underline-offset-2" style={{ color: 'var(--color-gold)' }}>
                Sign in
              </Link>
            </>
          )}
        </div>
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
        {!approved && (
          <p className="text-[12.5px] mt-1 leading-relaxed" style={{ color: 'var(--color-char)' }}>
            {rejected ? (
              <>
                <span className="font-medium">Reason:</span> {request.reason}
                <br />
                Fix the details and send it again.
              </>
            ) : (
              <>
                You’ll be able to use USOP as soon as {approverText} approves your account. You can close this page — sign in later with your
                mobile number or email to check.
              </>
            )}
          </p>
        )}
      </div>

      {!approved && <EmailStep key={request.email} email={request.email} serverSaysVerified={request.emailVerified === true} onEdit={() => {
        setDraft(draftFrom(request))
        setEditing(true)
      }} />}

      <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 text-[13px] mb-6">
        <Row k="Name" v={request.name} />
        <Row k="Role" v={ROLE_LABEL[request.role] ?? request.role} />
        <Row k="Mobile" v={`+91 ${request.phone}`} mono />
        <Row k="Email" v={request.email} />
        {request.role === 'student' && <Row k="Year" v={`Year ${request.mbbsYear}`} />}
        {request.rollNumber && <Row k="Reg. no." v={request.rollNumber} mono />}
        <Row k="Sent" v={fmt(request.submittedAt)} />
      </dl>

      <ErrorLine error={error} />

      <div className="flex flex-wrap items-center gap-2 mt-4">
        {!approved && (
          <button
            type="button"
            onClick={() => {
              setDraft(draftFrom(request))
              setEditing(true)
            }}
            className="chamfer-sm px-4 py-2.5 text-[13px] font-medium"
            style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-frost)' }}
          >
            {rejected ? 'Edit and send again' : 'Edit request'}
          </button>
        )}
        <button
          type="button"
          onClick={async () => {
            // Leave for the sign-in page (not back to an empty form): the
            // request stays saved and they can sign in any time to check it.
            // Sign out first — /login sends a signed-in visitor straight back.
            const notice = approved
              ? 'Signed out.'
              : rejected
                ? 'Signed out. Sign in again with your mobile number or email to fix and resend your request.'
                : 'Signed out. Your request is still waiting for approval — sign in any time with your mobile number or email to check on it.'
            setLeaving(true)
            await signOut(auth).catch(() => {})
            clearSavedDraft()
            setDraft(draftFrom(null))
            navigate('/login', { replace: true, state: { notice } })
          }}
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

// The email step on the "Waiting for approval" page.
function EmailStep({ email, serverSaysVerified, onEdit }: { email: string; serverSaysVerified: boolean; onEdit: () => void }) {
  const v = useEmailVerification(email, serverSaysVerified)
  if (v.verified) {
    return (
      <div className="flex items-center gap-3 rounded-[10px] border px-4 py-3 mb-5" style={{ borderColor: 'color-mix(in srgb, var(--color-teal) 35%, transparent)', backgroundColor: 'var(--color-teal-soft)' }}>
        <span className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-teal)', color: 'var(--color-paper-raised)' }}>
          <Icon name="checkCircle" className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <div className="text-[13.5px] font-medium" style={{ color: 'var(--color-teal)' }}>
            Email verified
          </div>
          <div className="text-[12px] truncate" style={{ color: 'var(--color-char)' }}>
            {email}
          </div>
        </div>
      </div>
    )
  }
  return (
    <div className="rounded-[10px] border px-4 py-3.5 mb-5" style={{ borderColor: 'var(--color-gold)', backgroundColor: 'var(--color-paper)' }}>
      <div className="flex items-start gap-3">
        <span className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-gold-soft)', color: 'var(--color-gold)' }}>
          <Icon name="inbox" className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-medium" style={{ color: 'var(--color-char)' }}>
            Verify your email
          </div>
          <p className="text-[12.5px] mt-0.5 leading-relaxed" style={{ color: 'var(--color-char-soft)' }}>
            {v.sending && v.sentAt === null ? (
              'Sending a link…'
            ) : (
              <>
                We sent a link to <span className="font-medium" style={{ color: 'var(--color-char)' }}>{email}</span>. Click it to verify — your request can’t
                be approved until you do. Not there? Check Spam or Promotions.
              </>
            )}
          </p>
          {v.error && (
            <p className="text-[12px] mt-1.5" style={{ color: 'var(--color-clay)' }}>
              {v.error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-[12.5px]">
            <button type="button" disabled={!v.canResend} onClick={() => void v.send()} className="font-medium disabled:opacity-50" style={{ color: 'var(--color-gold)' }}>
              {v.sending ? 'Sending…' : v.canResend ? 'Resend email' : `Resend in ${v.resendIn}s`}
            </button>
            <TextLink tone="soft" onClick={onEdit}>
              Wrong email? Change it
            </TextLink>
            <span className="text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
              This page updates by itself once you click the link.
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// The "I am a" picker: a button showing the chosen role, opening a list of
// roles with an icon and a one-line description each. Keyboard: ↑/↓ to move,
// Enter to pick, Esc to close.
function RoleSelect({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const current = REGISTER_ROLES.find((r) => r.role === value) ?? REGISTER_ROLES[0]

  useEffect(() => {
    if (!open) return
    setActive(Math.max(0, REGISTER_ROLES.findIndex((r) => r.role === value)))
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, value])

  function pick(r: Role) {
    onChange(r)
    setOpen(false)
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') return setOpen(false)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) return setOpen(true)
      const d = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i + d + REGISTER_ROLES.length) % REGISTER_ROLES.length)
    }
    if ((e.key === 'Enter' || e.key === ' ') && open) {
      e.preventDefault()
      pick(REGISTER_ROLES[active].role)
    }
  }

  const badge = (icon: IconName, on: boolean) => (
    <span
      className="h-9 w-9 shrink-0 rounded-full flex items-center justify-center"
      style={{
        backgroundColor: on ? 'var(--color-gold)' : 'var(--color-gold-soft)',
        color: on ? 'var(--color-paper-raised)' : 'var(--color-gold)',
      }}
    >
      <Icon name={icon} className="h-[18px] w-[18px]" />
    </span>
  )

  return (
    <div ref={wrapRef} className="relative" onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left transition-colors"
        style={{
          borderColor: open ? 'var(--color-gold)' : 'var(--color-line)',
          backgroundColor: 'var(--color-paper-raised)',
          boxShadow: open ? '0 0 0 3px color-mix(in srgb, var(--color-gold) 18%, transparent)' : undefined,
        }}
      >
        {badge(current.icon, true)}
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium" style={{ color: 'var(--color-char)' }}>
            {current.label}
          </span>
          <span className="block text-[11.5px] truncate" style={{ color: 'var(--color-char-soft)' }}>
            {current.hint}
          </span>
        </span>
        <Icon
          name="chevron"
          className="h-4 w-4 shrink-0 transition-transform"
          style={{ color: 'var(--color-char-soft)', transform: open ? 'rotate(-90deg)' : 'rotate(90deg)' }}
        />
      </button>

      {open && (
        <ul
          role="listbox"
          className="absolute z-30 left-0 right-0 mt-2 rounded-[12px] border p-1.5 fade-up"
          style={{
            backgroundColor: 'var(--color-paper-raised)',
            borderColor: 'var(--color-line)',
            boxShadow: '0 24px 48px -20px rgba(11,18,32,0.35)',
            animationDuration: '160ms',
          }}
        >
          {REGISTER_ROLES.map((r, i) => {
            const selected = r.role === value
            return (
              <li key={r.role} role="option" aria-selected={selected}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(r.role)}
                  className="w-full flex items-center gap-3 rounded-[8px] px-2.5 py-2 text-left transition-colors"
                  style={{ backgroundColor: i === active ? 'var(--color-gold-soft)' : 'transparent' }}
                >
                  {badge(r.icon, selected)}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-medium" style={{ color: 'var(--color-char)' }}>
                      {r.label}
                    </span>
                    <span className="block text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
                      {r.hint}
                    </span>
                  </span>
                  {selected && (
                    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="var(--color-gold)" strokeWidth={2.2} strokeLinecap="square">
                      <path d="M5 12.5 10 17.5 19 7" />
                    </svg>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
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

function RegistrationForm({
  draft,
  setDraft,
  verifiedMobile,
  existing,
  onDone,
  onBusy,
  onUseOtherNumber,
  onCancelEdit,
}: {
  draft: Draft
  setDraft: (fn: (d: Draft) => Draft) => void
  verifiedMobile: string | null
  existing: RegistrationRequest | null
  onDone: (prevSubmittedAt: number | null) => void
  onBusy: (busy: boolean) => void
  onUseOtherNumber: () => void
  onCancelEdit?: () => void
}) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }))
  const { role, name, email, password, mobile, stateFilter, institutionId, mbbsYear, rollNumber, associatedYears, departmentId } = draft

  const [options, setOptions] = useState<RegistrationOptions | null>(null)
  const [optionsError, setOptionsError] = useState<string | null>(null)
  useEffect(() => {
    getRegistrationOptions({})
      .then(setOptions)
      .catch((e) => setOptionsError(accountErrorMessage(e, 'Couldn’t load the list of colleges. Reload the page to try again.')))
  }, [])

  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Mobile verification (inside the form) ──
  const otp = usePhoneOtp()
  const [code, setCode] = useState('')
  const [otpBusy, setOtpBusy] = useState(false)
  const [otpError, setOtpError] = useState<string | null>(null)
  const verified = verifiedMobile !== null
  const lastTried = useRef('')

  // Run the invisible security check as soon as the number is complete, so
  // "Send OTP" only has to send.
  const mobileReady = isValidMobile(mobile)
  useEffect(() => {
    if (mobileReady && !verified) otp.warm()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileReady, verified])

  // Verify as soon as the 6th digit is typed (or auto-filled).
  useEffect(() => {
    if (otp.codeSent && code.length === 6 && !otpBusy && lastTried.current !== code) void verifyOtp()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, otp.codeSent, otpBusy])

  async function sendOtp() {
    setOtpError(null)
    if (!isValidMobile(mobile)) return setOtpError('Enter a valid 10-digit Indian mobile number.')
    setOtpBusy(true)
    try {
      setCode('')
      lastTried.current = ''
      await otp.send(mobile)
    } catch (err) {
      setOtpError(describeAuthError(err))
    } finally {
      setOtpBusy(false)
    }
  }

  async function verifyOtp() {
    lastTried.current = code
    setOtpError(null)
    setOtpBusy(true)
    try {
      // Signs this number in. A brand-new number becomes their login; a number
      // that already has an account signs into it (and the page follows).
      await otp.confirm(code)
    } catch (err) {
      setOtpError(describeAuthError(err))
    } finally {
      setOtpBusy(false)
    }
  }

  // ── The rest of the form ──
  const platformWide = false
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

  useEffect(() => {
    if (departmentId && options && !deptOptions.some((d) => d.id === departmentId)) setDraft((d) => ({ ...d, departmentId: '' }))
  }, [deptOptions, departmentId, options, setDraft])

  // Changing the email (or setting a password) on the login ends this
  // browser's session — Firebase does that for security — so we sign straight
  // back in with the email + password. A changed email therefore needs the
  // password typed too.
  const emailChanged = !!existing && email.trim().toLowerCase() !== existing.email
  const needsPassword = !existing || emailChanged
  const detailsValid =
    name.trim() !== '' &&
    EMAIL_RE.test(email.trim()) &&
    (needsPassword ? password.length >= 6 : password === '' || password.length >= 6) &&
    (platformWide || institutionId !== '') &&
    (!needsDept || departmentId !== '') &&
    rollNumber.trim() !== '' &&
    (role !== 'faculty' || associatedYears.length > 0)

  const submitHint = !detailsValid ? 'Fill in every field above.' : !verified ? 'Verify your mobile number to continue.' : null

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!verified || !detailsValid || busy) return
    // The request's submittedAt before this send — the page waits until the
    // saved request shows a different one.
    const prevSubmittedAt = existing?.submittedAt ?? null
    setBusy(true)
    onBusy(true)
    setError(null)
    try {
      const res = await submitRegistration({
        role,
        name: name.trim(),
        email: email.trim().toLowerCase(),
        institutionId,
        departmentId: needsDept ? departmentId : null,
        mbbsYear: role === 'student' ? mbbsYear : null,
        associatedMbbsYears: role === 'faculty' ? associatedYears : null,
        rollNumber: rollNumber.trim().replace(/\s+/g, ' '),
        ...(password ? { password } : {}),
      })
      // Stay signed in: the server's change to the email / password ended
      // this session, so sign back in to the same account right away.
      if (password) await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password).catch(() => {})
      setDraft((d) => ({ ...d, password: '' }))
      // New or changed email → email the verification link now. If this
      // fails, the status page notices no link went out and sends one.
      if (!res.emailVerified) await sendVerificationEmail().catch(() => {})
      onDone(prevSubmittedAt)
    } catch (err) {
      setError(accountErrorMessage(err, 'Couldn’t send your request. Please try again.'))
    } finally {
      setBusy(false)
      onBusy(false)
    }
  }

  const selectCls = `${inputCls} appearance-auto`
  const sectionTitle = (n: string, t: string) => (
    <div className="flex items-center gap-2 pt-1">
      <span className="font-mono text-[11px]" style={{ color: 'var(--color-gold)' }}>
        {n}
      </span>
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em]" style={{ color: 'var(--color-char-soft)' }}>
        {t}
      </span>
      <span className="flex-1 h-px" style={{ backgroundColor: 'var(--color-line)' }} />
    </div>
  )

  return (
    <form onSubmit={submit} className="space-y-4">
      {sectionTitle('01', 'About you')}
      <Field
        label="I am a"
        hint={role === 'institutionAdmin' ? 'Your request goes to the platform admin.' : 'Your request goes to your college’s admin.'}
      >
        <RoleSelect value={role} onChange={(r) => set('role', r)} />
      </Field>

      <Field label="Full name" htmlFor="reg-name">
        <input id="reg-name" value={name} onChange={(e) => set('name', e.target.value)} placeholder="As on your college records" className={inputCls} style={inputStyle} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Email"
          htmlFor="reg-email"
          hint={
            suggestEmailFix(email) ? (
              <span style={{ color: 'var(--color-clay)' }}>
                Did you mean <span className="font-medium">{suggestEmailFix(email)}</span>?{' '}
                <button type="button" className="underline font-medium" onClick={() => set('email', suggestEmailFix(email)!)}>
                  Use this
                </button>
              </span>
            ) : (
              'We’ll email you a link to verify it. You can also sign in with it.'
            )
          }
        >
          <input id="reg-email" type="email" autoComplete="email" value={email} onChange={(e) => set('email', e.target.value)} className={inputCls} style={inputStyle} />
        </Field>
        <Field
          label={emailChanged ? 'Password (needed to change the email)' : needsPassword ? 'Password' : 'New password (optional)'}
          htmlFor="reg-password"
          hint={
            emailChanged
              ? 'Type your current password, or a new one (6+ characters).'
              : needsPassword
                ? 'At least 6 characters.'
                : 'Leave blank to keep your current one.'
          }
        >
          <div className="relative">
            <input
              id="reg-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(e) => set('password', e.target.value)}
              className={`${inputCls} pr-14`}
              style={inputStyle}
            />
            <button type="button" onClick={() => setShowPassword((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </Field>
      </div>

      {sectionTitle('02', 'Your college')}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="State" htmlFor="reg-state">
          <select id="reg-state" value={stateFilter} onChange={(e) => set('stateFilter', e.target.value)} className={selectCls} style={inputStyle} disabled={!options}>
            <option value="">All states</option>
            {states.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="College" htmlFor="reg-college">
          <select id="reg-college" value={institutionId} onChange={(e) => set('institutionId', e.target.value)} className={selectCls} style={inputStyle} disabled={!options}>
            <option value="">{options ? 'Select your college' : 'Loading…'}</option>
            {colleges.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.city ? ` — ${c.city}` : ''}
              </option>
            ))}
            {institutionId && !colleges.some((c) => c.id === institutionId) && (
              <option value={institutionId}>{options?.institutions.find((c) => c.id === institutionId)?.name ?? 'Selected college'}</option>
            )}
          </select>
        </Field>
      </div>

      {role === 'student' && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="MBBS year" htmlFor="reg-year">
            <select id="reg-year" value={mbbsYear} onChange={(e) => set('mbbsYear', Number(e.target.value) as MbbsYear)} className={selectCls} style={inputStyle}>
              {YEARS.map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Registration number" htmlFor="reg-roll">
            <input id="reg-roll" value={rollNumber} onChange={(e) => set('rollNumber', e.target.value)} placeholder={regNoHelp(role).placeholder} className={inputCls} style={inputStyle} />
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
                  onClick={() => set('associatedYears', active ? associatedYears.filter((v) => v !== y) : [...associatedYears, y].sort())}
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
            value={departmentId}
            onChange={(e) => set('departmentId', e.target.value)}
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

      {role !== 'student' && (
        <Field label="Registration number" htmlFor="reg-roll">
          <input id="reg-roll" value={rollNumber} onChange={(e) => set('rollNumber', e.target.value)} placeholder={regNoHelp(role).placeholder} className={inputCls} style={inputStyle} />
          <p className="mt-1 text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
            {regNoHelp(role).hint}
          </p>
        </Field>
      )}

      {sectionTitle('03', 'Verify your mobile number')}
      {verified ? (
        <div className="flex items-center justify-between gap-3 rounded-[10px] border px-3.5 py-2.5" style={{ borderColor: 'var(--color-teal)', backgroundColor: 'var(--color-teal-soft)' }}>
          <div>
            <div className="font-mono text-[14px]" style={{ color: 'var(--color-char)' }}>
              +91 {verifiedMobile}
            </div>
            <div className="text-[11.5px] font-medium" style={{ color: 'var(--color-teal)' }}>
              ✓ Verified
            </div>
          </div>
          {!existing && (
            <TextLink tone="soft" onClick={onUseOtherNumber}>
              Use a different number
            </TextLink>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <div
              className="flex flex-1 min-w-0 rounded-[8px] border overflow-hidden focus-within:border-[var(--color-gold)]"
              style={{ borderColor: 'var(--color-line)', opacity: otp.codeSent ? 0.7 : 1 }}
            >
              <span className="px-3 flex items-center font-mono text-[14px] border-r" style={{ backgroundColor: 'var(--color-paper)', borderColor: 'var(--color-line)', color: 'var(--color-char-soft)' }}>
                +91
              </span>
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                maxLength={10}
                disabled={otp.codeSent}
                placeholder="10-digit mobile number"
                value={mobile}
                onChange={(e) => set('mobile', e.target.value.replace(/\D/g, '').slice(0, 10))}
                className="flex-1 min-w-0 px-3 py-2.5 text-[14px] font-mono outline-none"
                style={{ backgroundColor: 'var(--color-paper-raised)', color: 'var(--color-char)' }}
              />
            </div>
            {!otp.codeSent ? (
              <button
                type="button"
                onClick={sendOtp}
                disabled={otpBusy || !isValidMobile(mobile)}
                className="shrink-0 rounded-[8px] px-4 text-[13px] font-medium disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-gold)', color: 'var(--color-paper-raised)' }}
              >
                {otpBusy ? 'Sending…' : 'Send OTP'}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  otp.reset()
                  setCode('')
                  setOtpError(null)
                }}
                className="shrink-0 rounded-[8px] border px-3 text-[12.5px]"
                style={{ borderColor: 'var(--color-line)', color: 'var(--color-char-soft)' }}
              >
                Change
              </button>
            )}
          </div>

          {otp.codeSent && (
            <div className="rounded-[10px] px-3.5 py-3 space-y-2.5" style={{ backgroundColor: 'var(--color-gold-soft)' }}>
              <p className="text-[12.5px]" style={{ color: 'var(--color-char)' }}>
                Enter the 6-digit code sent to <span className="font-mono">+91 {otp.sentTo}</span>.
              </p>
              <div className="flex gap-2">
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      if (code.length === 6) void verifyOtp()
                    }
                  }}
                  className={`${inputCls} font-mono tracking-[0.45em] text-center text-[16px]`}
                  style={inputStyle}
                />
                <button
                  type="button"
                  onClick={verifyOtp}
                  disabled={otpBusy || code.length !== 6}
                  className="shrink-0 rounded-[8px] px-4 text-[13px] font-medium disabled:opacity-50"
                  style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-frost)' }}
                >
                  {otpBusy ? 'Checking…' : 'Verify'}
                </button>
              </div>
              <div className="text-right text-[12px]">
                <button type="button" disabled={!otp.canResend || otpBusy} onClick={sendOtp} className="font-medium disabled:opacity-50" style={{ color: 'var(--color-gold)' }}>
                  {otp.canResend ? 'Resend code' : `Resend in ${otp.resendIn}s`}
                </button>
              </div>
            </div>
          )}
          <ErrorLine error={otpError} />
        </div>
      )}

      <ErrorLine error={optionsError ?? error} />
      <SubmitButton busy={busy} disabled={!verified || !detailsValid} label={existing ? 'Send again for approval' : 'Send for approval'} busyLabel="Sending…" />
      {submitHint && (
        <p className="text-center text-[12px] -mt-1" style={{ color: 'var(--color-char-soft)' }}>
          {submitHint}
        </p>
      )}
      {onCancelEdit && (
        <p className="text-center text-[12.5px]">
          <TextLink tone="soft" onClick={onCancelEdit}>
            Back without changes
          </TextLink>
        </p>
      )}
      <div ref={otp.recaptchaHost} />
    </form>
  )
}
