import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { deleteUser, getAdditionalUserInfo, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { useAuth } from './AuthContext'
import { AuthCard, ErrorLine, Field, SubmitButton, TextLink, inputCls, inputStyle } from './authUi'
import { describeAuthError, isEmail, isValidMobile, normalizeMobile, usePhoneOtp } from './phoneOtp'

// One box for "Mobile number or email". As the person types we work out
// which it is; Continue then asks for an OTP (mobile) or the password (email).
//
// Signing in with a number nobody has makes Firebase create an empty login —
// that one is deleted straight away and the person is pointed to Create an
// account. `hold` stops the redirect while that clean-up happens.

type Step = 'id' | 'password' | 'otp'
type Kind = 'mobile' | 'email' | null

function detect(raw: string): Kind {
  const v = raw.trim()
  if (!v) return null
  if (v.includes('@') || /[a-z]/i.test(v)) return 'email'
  return 'mobile'
}

export function LoginPage() {
  const { firebaseUser } = useAuth()
  const navigate = useNavigate()
  const otp = usePhoneOtp()

  const [identifier, setIdentifier] = useState('')
  const [step, setStep] = useState<Step>('id')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [unknownNumber, setUnknownNumber] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hold, setHold] = useState(false)

  // Signed in and nothing in progress — "/" routes onward (to /register for
  // someone without an approved profile). auth.currentUser guards the moment
  // after an unknown number's login was deleted.
  if (firebaseUser && auth.currentUser && !hold) return <Navigate to="/" replace />

  const kind = detect(identifier)
  const mobile = normalizeMobile(identifier)
  const email = identifier.trim().toLowerCase()

  const hint =
    kind === 'mobile'
      ? isValidMobile(mobile)
        ? `We’ll send an OTP to +91 ${mobile}`
        : 'Enter your 10-digit mobile number'
      : kind === 'email'
        ? isEmail(email)
          ? 'Next you’ll enter your password'
          : 'Enter your full email address'
        : 'Use the mobile number or email your account was made with'

  function backToId() {
    setStep('id')
    setPassword('')
    setCode('')
    setError(null)
    otp.reset()
  }

  async function sendOtp() {
    setBusy(true)
    setError(null)
    try {
      await otp.send(mobile)
      setCode('')
      setStep('otp')
    } catch (err) {
      setError(describeAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  async function onContinue(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setUnknownNumber(false)
    if (kind === 'mobile') {
      if (!isValidMobile(mobile)) return setError('Enter a valid 10-digit Indian mobile number.')
      await sendOtp()
    } else if (kind === 'email') {
      if (!isEmail(email)) return setError('Enter a valid email address.')
      setStep('password')
    } else {
      setError('Enter your mobile number or email.')
    }
  }

  async function onPassword(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch (err) {
      setError(describeAuthError(err))
    } finally {
      setBusy(false)
    }
  }

  async function onVerify(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setHold(true)
    try {
      const cred = await otp.confirm(code)
      if (getAdditionalUserInfo(cred)?.isNewUser) {
        await deleteUser(cred.user).catch(() => signOut(auth))
        backToId()
        setUnknownNumber(true)
        setError(`No account uses +91 ${mobile} yet.`)
      }
    } catch (err) {
      setError(describeAuthError(err))
    } finally {
      setHold(false)
      setBusy(false)
    }
  }

  const chip = (
    <div className="flex items-center justify-between gap-3 rounded-full border px-3.5 py-2" style={{ borderColor: 'var(--color-line)', backgroundColor: 'var(--color-paper)' }}>
      <span className="text-[13px] truncate font-mono" style={{ color: 'var(--color-char)' }}>
        {step === 'otp' ? `+91 ${mobile}` : email}
      </span>
      <TextLink tone="soft" onClick={backToId}>
        Change
      </TextLink>
    </div>
  )

  return (
    <AuthCard subtitle="Sign in to your account">
      {step === 'id' && (
        <form onSubmit={onContinue} className="space-y-4">
          <Field label="Mobile number or email" htmlFor="identifier" hint={hint}>
            <div className="relative">
              {kind === 'mobile' && (
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-[14px]" style={{ color: 'var(--color-char-soft)' }}>
                  +91
                </span>
              )}
              <input
                id="identifier"
                autoFocus
                autoComplete="username"
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value)
                  setError(null)
                  setUnknownNumber(false)
                }}
                placeholder="98765 43210 or name@college.edu"
                className={`${inputCls} ${kind === 'mobile' ? 'pl-12 font-mono' : ''}`}
                style={inputStyle}
              />
            </div>
          </Field>
          <ErrorLine error={error} />
          {unknownNumber && (
            <p className="text-[12.5px]" style={{ color: 'var(--color-char-soft)' }}>
              New here? <TextLink onClick={() => navigate(`/register?mobile=${mobile}`)}>Create an account</TextLink> with this number.
            </p>
          )}
          <SubmitButton
            busy={busy}
            label={kind === 'mobile' ? 'Send OTP' : 'Continue'}
            busyLabel={kind === 'mobile' ? 'Sending OTP…' : 'Please wait…'}
          />
        </form>
      )}

      {step === 'password' && (
        <form onSubmit={onPassword} className="space-y-4">
          {chip}
          <Field label="Password" htmlFor="password">
            <input
              id="password"
              type="password"
              autoFocus
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
              style={inputStyle}
            />
          </Field>
          <ErrorLine error={error} />
          <SubmitButton busy={busy} label="Sign in" busyLabel="Signing in…" />
          <p className="text-[12.5px] text-center" style={{ color: 'var(--color-char-soft)' }}>
            Forgot it? Sign in with your <TextLink onClick={backToId}>mobile number and an OTP</TextLink> instead.
          </p>
        </form>
      )}

      {step === 'otp' && (
        <form onSubmit={onVerify} className="space-y-4">
          {chip}
          <Field label="OTP code" htmlFor="otp" hint="Enter the 6-digit code we sent by SMS.">
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
          <SubmitButton busy={busy} disabled={code.length !== 6} label="Verify & sign in" busyLabel="Verifying…" />
          <div className="text-right text-[12.5px]">
            <button type="button" disabled={!otp.canResend || busy} onClick={sendOtp} className="font-medium disabled:opacity-50" style={{ color: 'var(--color-gold)' }}>
              {otp.canResend ? 'Resend code' : `Resend in ${otp.resendIn}s`}
            </button>
          </div>
        </form>
      )}

      <div className="mt-6 pt-4 border-t text-center text-[12.5px]" style={{ borderColor: 'var(--color-line)', color: 'var(--color-char-soft)' }}>
        New to USOP?{' '}
        <Link to="/register" className="font-medium underline underline-offset-2" style={{ color: 'var(--color-gold)' }}>
          Create an account
        </Link>
      </div>

      <div ref={otp.recaptchaHost} />
    </AuthCard>
  )
}
