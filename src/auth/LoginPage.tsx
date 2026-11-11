import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { FirebaseError } from 'firebase/app'
import {
  RecaptchaVerifier,
  deleteUser,
  getAdditionalUserInfo,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
} from 'firebase/auth'
import { auth } from '../lib/firebase'
import { useAuth } from './AuthContext'
import { AuthCard, ErrorLine, Field, MobileField, SubmitButton, TextLink, inputCls, inputStyle } from './authUi'

// Sign in with mobile + OTP (first tab) or email + password, or start a new
// registration.
//
// Admins create accounts through the server functions, which attach the
// mobile number to the login, so mobile + OTP works from day one.
// "Create an account" verifies the mobile number by OTP — that creates the
// login — and then /register collects the details and sends them for
// approval. Signing in (not registering) with a number nobody has would also
// make Firebase create an empty login; that one is deleted straight away.
//
// `hold` stops the page redirecting while the OTP is being confirmed, so an
// unknown number can be cleaned up first.

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
const validMobile = (digits: string) => /^[6-9]\d{9}$/.test(digits)

type Tab = 'phone' | 'email'
type PhoneMode = 'login' | 'register'

export function LoginPage() {
  const { firebaseUser } = useAuth()
  const [tab, setTab] = useState<Tab>('phone')
  const [phoneMode, setPhoneMode] = useState<PhoneMode>('login')
  const [step, setStep] = useState<'enter' | 'code'>('enter')

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mobile, setMobile] = useState('')
  const [code, setCode] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [unknownNumber, setUnknownNumber] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [hold, setHold] = useState(false)

  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null)
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

  // Signed in and nothing in progress — leave /login ("/" routes onward,
  // including to /register for someone without an approved profile).
  // (auth.currentUser guards the moment after an unknown number's login was
  // deleted but before the context has caught up.)
  if (firebaseUser && auth.currentUser && !hold) {
    return <Navigate to="/" replace />
  }

  // A fresh invisible reCAPTCHA per send: a used or failed verifier can't be
  // reused, and rendering twice into one element throws.
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
    setError(null)
    setUnknownNumber(false)
  }

  function goTo(nextTab: Tab, mode: PhoneMode = 'login') {
    setTab(nextTab)
    setPhoneMode(mode)
    resetPhoneFlow()
  }

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

  async function sendCode(e?: FormEvent) {
    e?.preventDefault()
    setError(null)
    setUnknownNumber(false)
    if (!validMobile(mobile)) return setError('Enter a valid 10-digit mobile number.')
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

  async function verifyCode(e: FormEvent) {
    e.preventDefault()
    if (!confirmation) return
    setError(null)
    setSubmitting(true)
    setHold(true)
    try {
      const cred = await confirmation.confirm(code.trim())
      if (phoneMode === 'login' && getAdditionalUserInfo(cred)?.isNewUser) {
        // Nobody has this number — remove the empty login Firebase just made.
        await deleteUser(cred.user).catch(() => signOut(auth))
        resetPhoneFlow()
        setUnknownNumber(true)
        setError('No account uses this mobile number yet.')
      }
      // Registering: keep the new login; "/" sends them on to /register.
      // An existing account (registering again by mistake) just signs in.
    } catch (err) {
      setError(describeAuthError(err))
    } finally {
      setHold(false)
      setSubmitting(false)
    }
  }

  const canResend = now >= resendAt
  const resendIn = Math.max(0, Math.ceil((resendAt - now) / 1000))
  const registering = tab === 'phone' && phoneMode === 'register'

  return (
    <AuthCard subtitle={registering ? 'Create an account' : 'Sign in to your account'}>
      {!registering && (
        <div className="grid grid-cols-2 gap-1 p-1 rounded-full mb-6" style={{ backgroundColor: 'var(--color-paper)' }}>
          {(['phone', 'email'] as const).map((t) => {
            const active = tab === t
            return (
              <button
                key={t}
                type="button"
                onClick={() => goTo(t)}
                className="rounded-full py-2 text-[13px] font-medium transition-colors"
                style={{
                  backgroundColor: active ? 'var(--color-ink)' : 'transparent',
                  color: active ? 'var(--color-frost)' : 'var(--color-char-soft)',
                }}
              >
                {t === 'phone' ? 'Mobile & OTP' : 'Email & password'}
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

      {tab === 'phone' && step === 'enter' && (
        <form onSubmit={sendCode} className="space-y-4">
          {registering && (
            <p className="text-[12.5px] leading-relaxed rounded-[10px] px-3 py-2.5" style={{ backgroundColor: 'var(--color-gold-soft)', color: 'var(--color-char)' }}>
              First we confirm your mobile number with an OTP. Then you fill in your details and your college (or the platform admin) approves
              your account.
            </p>
          )}
          <MobileField value={mobile} onChange={setMobile} />
          <ErrorLine error={error} />
          {unknownNumber && (
            <p className="text-[12.5px]" style={{ color: 'var(--color-char-soft)' }}>
              New here? <TextLink onClick={() => goTo('phone', 'register')}>Create an account</TextLink> with this number.
            </p>
          )}
          <SubmitButton busy={submitting} label="Send OTP" busyLabel="Sending…" />
        </form>
      )}

      {tab === 'phone' && step === 'code' && (
        <form onSubmit={verifyCode} className="space-y-4">
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
          <SubmitButton busy={submitting} disabled={code.length !== 6} label={registering ? 'Verify & continue' : 'Verify & sign in'} busyLabel="Verifying…" />
          <div className="flex items-center justify-between text-[12.5px]">
            <TextLink tone="soft" onClick={resetPhoneFlow}>
              Change number
            </TextLink>
            <button type="button" disabled={!canResend || submitting} onClick={() => sendCode()} className="font-medium disabled:opacity-50" style={{ color: 'var(--color-gold)' }}>
              {canResend ? 'Resend code' : `Resend in ${resendIn}s`}
            </button>
          </div>
        </form>
      )}

      <div className="mt-6 pt-4 border-t text-center text-[12.5px]" style={{ borderColor: 'var(--color-line)', color: 'var(--color-char-soft)' }}>
        {registering ? (
          <>
            Already have an account? <TextLink onClick={() => goTo('phone')}>Sign in</TextLink>
          </>
        ) : (
          <>
            New to USOP? <TextLink onClick={() => goTo('phone', 'register')}>Create an account</TextLink>
          </>
        )}
      </div>

      {/* Invisible reCAPTCHA (Firebase requires it before sending an OTP on the web). */}
      <div ref={recaptchaHost} />
    </AuthCard>
  )
}
