import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import {
  PhoneAuthProvider,
  RecaptchaVerifier,
  deleteUser,
  getAdditionalUserInfo,
  linkWithCredential,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signOut,
  updatePhoneNumber,
  type ConfirmationResult,
} from 'firebase/auth'
import { auth } from '../lib/firebase'
import { useAuth } from './AuthContext'

// Two ways in: email + password, or mobile number + OTP.
//
// Mobile login only works for a number that has been joined ("linked") to
// the user's existing account, because every profile and role hangs off the
// account the admin created with an email. Linking happens once, here, in
// "Set up mobile login": sign in with email + password, verify the number by
// OTP, and it's joined to that same account. Signing in with a number that
// isn't linked would make Firebase create a brand-new empty account — that
// account is deleted straight away and the user is told the number isn't
// registered.
//
// `hold` keeps the page from redirecting while a multi-step flow is still
// running (the user is already signed in during setup, and briefly signed
// in as the throwaway account when an unknown number is rejected).

const RESEND_AFTER_MS = 30_000

function describeAuthError(err: unknown): string {
  if (err instanceof FirebaseError) {
    switch (err.code) {
      case 'auth/invalid-credential':
      case 'auth/invalid-login-credentials':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Invalid email or password.'
      case 'auth/too-many-requests':
        return 'Too many attempts. Please wait a few minutes and try again.'
      case 'auth/invalid-email':
        return 'That email address looks malformed.'
      case 'auth/invalid-phone-number':
      case 'auth/missing-phone-number':
        return 'That mobile number doesn’t look right.'
      case 'auth/invalid-verification-code':
      case 'auth/missing-verification-code':
        return 'That code is incorrect. Check the SMS and try again.'
      case 'auth/code-expired':
        return 'That code has expired. Send a new one.'
      case 'auth/credential-already-in-use':
      case 'auth/account-exists-with-different-credential':
        return 'This mobile number is already used by another account.'
      case 'auth/quota-exceeded':
        return 'The daily SMS limit has been reached. Please sign in with email for now.'
      case 'auth/captcha-check-failed':
        return 'The security check failed. Reload the page and try again.'
      case 'auth/operation-not-allowed':
        return 'Mobile login isn’t switched on for this app yet.'
      case 'auth/network-request-failed':
        return 'Network error. Check your connection and try again.'
      default:
        return `Sign-in failed (${err.code}).`
    }
  }
  return 'Sign-in failed. Please try again.'
}

const toE164 = (digits: string) => `+91${digits}`
const validMobile = (digits: string) => /^\d{10}$/.test(digits)

type Tab = 'email' | 'phone'
type PhoneMode = 'login' | 'setup'
type Step = 'enter' | 'code' | 'done'

export function LoginPage() {
  const { firebaseUser } = useAuth()
  const [tab, setTab] = useState<Tab>('email')
  const [phoneMode, setPhoneMode] = useState<PhoneMode>('login')
  const [step, setStep] = useState<Step>('enter')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mobile, setMobile] = useState('')
  const [code, setCode] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [hold, setHold] = useState(false)

  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null)
  const [verificationId, setVerificationId] = useState<string | null>(null)
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  const recaptchaHost = useRef<HTMLDivElement>(null)
  const verifierRef = useRef<RecaptchaVerifier | null>(null)

  useEffect(() => {
    if (step !== 'code') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [step])

  useEffect(() => () => verifierRef.current?.clear(), [])

  // Already signed in and no flow in progress — leave /login.
  if (firebaseUser && !hold) {
    return <Navigate to="/" replace />
  }

  // A fresh invisible reCAPTCHA per send: a used or failed verifier can't be
  // reused, and rendering twice into one element throws, so each gets its own
  // new child element.
  function freshVerifier(): RecaptchaVerifier {
    verifierRef.current?.clear()
    const host = recaptchaHost.current!
    host.innerHTML = ''
    const el = document.createElement('div')
    host.appendChild(el)
    verifierRef.current = new RecaptchaVerifier(auth, el, { size: 'invisible' })
    return verifierRef.current
  }

  function resetPhoneFlow() {
    setStep('enter')
    setCode('')
    setConfirmation(null)
    setVerificationId(null)
    setError(null)
  }

  function switchTab(next: Tab) {
    setTab(next)
    setPhoneMode('login')
    resetPhoneFlow()
  }

  async function cancelSetup() {
    resetPhoneFlow()
    if (auth.currentUser) await signOut(auth).catch(() => {})
    setHold(false)
  }

  // ── Email + password ──────────────────────────────────────────────────
  async function handleEmail(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password)
    } catch (err) {
      setError(describeAuthError(err))
    } finally {
      setSubmitting(false)
    }
  }

  // ── Mobile + OTP: sign in ─────────────────────────────────────────────
  async function sendLoginCode(e?: FormEvent) {
    e?.preventDefault()
    setError(null)
    if (!validMobile(mobile)) return setError('Enter your 10-digit mobile number.')
    setSubmitting(true)
    try {
      const result = await signInWithPhoneNumber(auth, toE164(mobile), freshVerifier())
      setConfirmation(result)
      setCode('')
      setStep('code')
      setResendAt(Date.now() + RESEND_AFTER_MS)
    } catch (err) {
      setError(describeAuthError(err))
    } finally {
      setSubmitting(false)
    }
  }

  async function verifyLoginCode(e: FormEvent) {
    e.preventDefault()
    if (!confirmation) return
    setError(null)
    setSubmitting(true)
    setHold(true)
    try {
      const cred = await confirmation.confirm(code.trim())
      if (getAdditionalUserInfo(cred)?.isNewUser) {
        // Not linked to anyone — remove the empty account Firebase just made.
        await deleteUser(cred.user).catch(() => signOut(auth))
        resetPhoneFlow()
        setError(
          'This mobile number isn’t registered. Sign in with your email once and use “Set up mobile login” to add it.',
        )
        setHold(false)
        return
      }
      setHold(false)
    } catch (err) {
      setError(describeAuthError(err))
      setHold(false)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Mobile + OTP: one-time setup (link to the email account) ──────────
  async function sendSetupCode(e?: FormEvent) {
    e?.preventDefault()
    setError(null)
    if (!validMobile(mobile)) return setError('Enter your 10-digit mobile number.')
    setSubmitting(true)
    setHold(true)
    try {
      const signedIn = auth.currentUser?.email?.toLowerCase() === email.trim().toLowerCase()
      const user = signedIn ? auth.currentUser! : (await signInWithEmailAndPassword(auth, email.trim(), password)).user
      if (user.phoneNumber === toE164(mobile)) {
        setStep('done')
        return
      }
      const id = await new PhoneAuthProvider(auth).verifyPhoneNumber(toE164(mobile), freshVerifier())
      setVerificationId(id)
      setCode('')
      setStep('code')
      setResendAt(Date.now() + RESEND_AFTER_MS)
    } catch (err) {
      setError(describeAuthError(err))
      if (auth.currentUser) await signOut(auth).catch(() => {})
      setHold(false)
    } finally {
      setSubmitting(false)
    }
  }

  async function verifySetupCode(e: FormEvent) {
    e.preventDefault()
    const user = auth.currentUser
    if (!verificationId || !user) return
    setError(null)
    setSubmitting(true)
    try {
      const cred = PhoneAuthProvider.credential(verificationId, code.trim())
      // Already has a number → replace it; otherwise add one.
      if (user.providerData.some((p) => p.providerId === 'phone')) await updatePhoneNumber(user, cred)
      else await linkWithCredential(user, cred)
      setStep('done')
    } catch (err) {
      setError(describeAuthError(err))
    } finally {
      setSubmitting(false)
    }
  }

  const canResend = now >= resendAt
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000))
  const isSetup = tab === 'phone' && phoneMode === 'setup'

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" style={{ backgroundColor: 'var(--color-paper)' }}>
      <div
        className="w-full max-w-[400px] rounded-[14px] border p-7 sm:p-8 shadow-[0_24px_48px_-32px_rgba(11,18,32,0.45)]"
        style={{ backgroundColor: 'var(--color-paper-raised)', borderColor: 'var(--color-line)' }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="chamfer-sm h-10 w-10 flex items-center justify-center font-display text-[18px]" style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-gold)' }}>
            U
          </div>
          <div>
            <h1 className="font-display text-[22px] leading-tight" style={{ color: 'var(--color-char)' }}>
              USOP
            </h1>
            <p className="text-[12.5px]" style={{ color: 'var(--color-char-soft)' }}>
              {isSetup ? 'Set up mobile login' : 'Sign in to your account'}
            </p>
          </div>
        </div>

        {!isSetup && (
          <div className="grid grid-cols-2 gap-1 p-1 rounded-full mb-6" style={{ backgroundColor: 'var(--color-paper)' }}>
            {(['email', 'phone'] as const).map((t) => {
              const active = tab === t
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => switchTab(t)}
                  className="rounded-full py-2 text-[13px] font-medium transition-colors"
                  style={{
                    backgroundColor: active ? 'var(--color-ink)' : 'transparent',
                    color: active ? 'var(--color-frost)' : 'var(--color-char-soft)',
                  }}
                >
                  {t === 'email' ? 'Email & password' : 'Mobile & OTP'}
                </button>
              )
            })}
          </div>
        )}

        {tab === 'email' && (
          <form onSubmit={handleEmail} className="space-y-4">
            <Field label="Email" htmlFor="email">
              <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} style={inputStyle} />
            </Field>
            <Field label="Password" htmlFor="password">
              <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} style={inputStyle} />
            </Field>
            <ErrorLine error={error} />
            <SubmitButton busy={submitting} label="Sign in" busyLabel="Signing in…" />
          </form>
        )}

        {tab === 'phone' && phoneMode === 'login' && step === 'enter' && (
          <form onSubmit={sendLoginCode} className="space-y-4">
            <MobileField value={mobile} onChange={setMobile} />
            <ErrorLine error={error} />
            <SubmitButton busy={submitting} label="Send OTP" busyLabel="Sending…" />
            <p className="text-[12.5px] text-center pt-1" style={{ color: 'var(--color-char-soft)' }}>
              First time using your mobile?{' '}
              <button type="button" onClick={() => { setPhoneMode('setup'); resetPhoneFlow() }} className="font-medium underline underline-offset-2" style={{ color: 'var(--color-gold)' }}>
                Set up mobile login
              </button>
            </p>
          </form>
        )}

        {tab === 'phone' && step === 'code' && (
          <form onSubmit={phoneMode === 'login' ? verifyLoginCode : verifySetupCode} className="space-y-4">
            <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
              We sent a 6-digit code to <span className="font-mono" style={{ color: 'var(--color-char)' }}>+91 {mobile}</span>.
            </p>
            <Field label="OTP code" htmlFor="otp">
              <input
                id="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={6}
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className={`${inputCls} font-mono tracking-[0.5em] text-center text-[18px]`}
                style={inputStyle}
              />
            </Field>
            <ErrorLine error={error} />
            <SubmitButton busy={submitting} disabled={code.length !== 6} label={phoneMode === 'login' ? 'Verify & sign in' : 'Verify & turn on'} busyLabel="Verifying…" />
            <div className="flex items-center justify-between text-[12.5px]">
              <button
                type="button"
                onClick={() => (phoneMode === 'login' ? resetPhoneFlow() : cancelSetup())}
                className="underline underline-offset-2"
                style={{ color: 'var(--color-char-soft)' }}
              >
                {phoneMode === 'login' ? 'Change number' : 'Cancel'}
              </button>
              <button
                type="button"
                disabled={!canResend || submitting}
                onClick={() => (phoneMode === 'login' ? sendLoginCode() : sendSetupCode())}
                className="font-medium disabled:opacity-50"
                style={{ color: 'var(--color-gold)' }}
              >
                {canResend ? 'Resend code' : `Resend in ${resendIn}s`}
              </button>
            </div>
          </form>
        )}

        {isSetup && step === 'enter' && (
          <form onSubmit={sendSetupCode} className="space-y-4">
            <p className="text-[12.5px] leading-relaxed rounded-[10px] px-3 py-2.5" style={{ backgroundColor: 'var(--color-gold-soft)', color: 'var(--color-char)' }}>
              Confirm it’s you with your email and password once. After that you can sign in with just your mobile number and an OTP.
            </p>
            <Field label="Email" htmlFor="setup-email">
              <input id="setup-email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} style={inputStyle} />
            </Field>
            <Field label="Password" htmlFor="setup-password">
              <input id="setup-password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} style={inputStyle} />
            </Field>
            <MobileField value={mobile} onChange={setMobile} />
            <ErrorLine error={error} />
            <SubmitButton busy={submitting} label="Send OTP" busyLabel="Checking…" />
            <p className="text-[12.5px] text-center" style={{ color: 'var(--color-char-soft)' }}>
              <button type="button" onClick={() => { setPhoneMode('login'); resetPhoneFlow() }} className="underline underline-offset-2">
                Back to mobile sign-in
              </button>
            </p>
          </form>
        )}

        {isSetup && step === 'done' && (
          <div className="space-y-4">
            <div className="rounded-[10px] px-4 py-3.5" style={{ backgroundColor: 'var(--color-teal-soft)' }}>
              <div className="text-[14px] font-medium" style={{ color: 'var(--color-teal)' }}>
                Mobile login is on
              </div>
              <p className="text-[12.5px] mt-1" style={{ color: 'var(--color-char)' }}>
                Next time, choose “Mobile &amp; OTP” and enter <span className="font-mono">+91 {mobile}</span>. Your email and password still work too.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setHold(false)}
              className="chamfer-sm w-full py-2.5 text-[13.5px] font-medium"
              style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-frost)' }}
            >
              Continue
            </button>
          </div>
        )}

        {/* Invisible reCAPTCHA lives here (required by Firebase before sending an OTP on the web). */}
        <div ref={recaptchaHost} />
      </div>
    </div>
  )
}

const inputCls = 'w-full rounded-[8px] border px-3 py-2.5 text-[14px] outline-none transition-colors focus:border-[var(--color-gold)]'
const inputStyle = { borderColor: 'var(--color-line)', backgroundColor: 'var(--color-paper-raised)', color: 'var(--color-char)' }

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block font-display text-[14px] mb-1.5" style={{ color: 'var(--color-char)' }}>
        {label}
      </label>
      {children}
    </div>
  )
}

function MobileField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="Mobile number" htmlFor="mobile">
      <div className="flex rounded-[8px] border overflow-hidden focus-within:border-[var(--color-gold)]" style={{ borderColor: 'var(--color-line)' }}>
        <span className="px-3 flex items-center font-mono text-[14px] border-r" style={{ backgroundColor: 'var(--color-paper)', borderColor: 'var(--color-line)', color: 'var(--color-char-soft)' }}>
          +91
        </span>
        <input
          id="mobile"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          maxLength={10}
          required
          placeholder="10-digit number"
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 10))}
          className="flex-1 min-w-0 px-3 py-2.5 text-[14px] font-mono outline-none"
          style={{ backgroundColor: 'var(--color-paper-raised)', color: 'var(--color-char)' }}
        />
      </div>
    </Field>
  )
}

function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p className="text-[12.5px] rounded-[8px] px-3 py-2" style={{ backgroundColor: 'var(--color-clay-soft)', color: 'var(--color-clay)' }}>
      {error}
    </p>
  )
}

function SubmitButton({ busy, disabled, label, busyLabel }: { busy: boolean; disabled?: boolean; label: string; busyLabel: string }) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="chamfer-sm w-full py-2.5 text-[13.5px] font-medium transition-opacity disabled:opacity-50"
      style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-frost)' }}
    >
      {busy ? busyLabel : label}
    </button>
  )
}
