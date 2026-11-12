import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { deleteUser, getAdditionalUserInfo, sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { checkMobile, passwordResetAllowed } from '../lib/accounts'
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
  // A message passed from another page, e.g. "Signed out. Your request is
  // still waiting…" from the registration status page.
  const notice = (useLocation().state as { notice?: string } | null)?.notice ?? null
  const otp = usePhoneOtp()

  const [identifier, setIdentifier] = useState('')
  const [step, setStep] = useState<Step>('id')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [unknownNumber, setUnknownNumber] = useState(false)
  const [busy, setBusy] = useState(false)
  const [hold, setHold] = useState(false)
  const [sending, setSending] = useState(false)
  // "Forgot password?": null = not asked, 'busy', or the message to show.
  const [reset, setReset] = useState<null | 'busy' | { ok: boolean; text: string }>(null)
  const lastTried = useRef('')

  const kind = detect(identifier)
  const mobile = normalizeMobile(identifier)
  const email = identifier.trim().toLowerCase()
  const mobileReady = kind === 'mobile' && isValidMobile(mobile)

  // Start the invisible security check as soon as the number is complete,
  // so pressing "Send OTP" only has to send.
  // …and ask the server whether the number has an account, so an
  // unregistered number is told so without an SMS being sent. Cached per
  // number; a failed check returns null (then we just send, as before).
  const lookups = useRef(new Map<string, Promise<boolean | null>>())
  function lookup(m: string) {
    let p = lookups.current.get(m)
    if (!p) {
      p = checkMobile({ mobile: m }).then((r) => r.exists, () => null)
      lookups.current.set(m, p)
      void p.then((v) => { if (v === null) lookups.current.delete(m) })
    }
    return p
  }
  useEffect(() => {
    if (!mobileReady) return
    otp.warm()
    void lookup(mobile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobileReady, mobile])

  // Sign in as soon as the 6th digit is typed (or pasted / auto-filled).
  useEffect(() => {
    if (step === 'otp' && code.length === 6 && otp.codeSent && !sending && !busy && lastTried.current !== code) {
      void verify()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, code, otp.codeSent, sending, busy])

  // Signed in and nothing in progress — "/" routes onward (to /register for
  // someone without an approved profile). auth.currentUser guards the moment
  // after an unknown number's login was deleted.
  if (firebaseUser && auth.currentUser && !hold) return <Navigate to="/" replace />

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

  // Only a verified email gets a reset link (admin-added emails count as
  // verified), so a mistyped address never receives someone's reset.
  async function forgotPassword() {
    setReset('busy')
    setError(null)
    try {
      const { allowed } = await passwordResetAllowed({ email })
      if (allowed) {
        await sendPasswordResetEmail(auth, email, { url: `${window.location.origin}/login` })
        setReset({ ok: true, text: `We sent a password reset link to ${email}. Check your inbox (and Spam), then come back to sign in.` })
      } else {
        setReset({
          ok: false,
          text: 'We can’t send a reset link to this email — it isn’t a verified email on any account. Sign in with your mobile number and an OTP instead.',
        })
      }
    } catch {
      setReset({ ok: false, text: 'Couldn’t send the reset link. Check your connection and try again.' })
    }
  }

  function backToId() {
    setReset(null)
    setStep('id')
    setPassword('')
    setCode('')
    setError(null)
    otp.reset()
  }

  // The code screen opens straight away (the SMS usually lands within a
  // couple of seconds anyway); the person can start typing while we send.
  async function sendOtp() {
    setSending(true)
    setError(null)
    setCode('')
    lastTried.current = ''
    setStep('otp')
    const resend = otp.codeSent
    try {
      await otp.send(mobile)
    } catch (err) {
      if (!resend) setStep('id')
      setError(describeAuthError(err))
    } finally {
      setSending(false)
    }
  }

  async function onContinue(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setUnknownNumber(false)
    if (kind === 'mobile') {
      if (!isValidMobile(mobile)) return setError('Enter a valid 10-digit Indian mobile number.')
      setBusy(true)
      const exists = await lookup(mobile)
      setBusy(false)
      if (exists === false) {
        setUnknownNumber(true)
        return setError(`No account uses +91 ${mobile} yet.`)
      }
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

  function onVerify(e: FormEvent) {
    e.preventDefault()
    if (code.length === 6 && otp.codeSent && !sending) void verify()
  }

  async function verify() {
    lastTried.current = code
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
          {notice && !error && (
            <p className="text-[12.5px] rounded-[8px] px-3 py-2 leading-relaxed" style={{ backgroundColor: 'var(--color-gold-soft)', color: 'var(--color-char)' }}>
              {notice}
            </p>
          )}
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
            busyLabel={kind === 'mobile' ? 'Checking…' : 'Please wait…'}
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
          {reset && reset !== 'busy' ? (
            <p
              className="text-[12.5px] rounded-[8px] px-3 py-2 leading-relaxed"
              style={{ backgroundColor: reset.ok ? 'var(--color-teal-soft)' : 'var(--color-gold-soft)', color: 'var(--color-char)' }}
            >
              {reset.text}
            </p>
          ) : (
            <p className="text-[12.5px] text-center" style={{ color: 'var(--color-char-soft)' }}>
              Forgot it?{' '}
              {reset === 'busy' ? (
                <span>Sending a reset link…</span>
              ) : (
                <TextLink onClick={() => void forgotPassword()}>Email me a reset link</TextLink>
              )}{' '}
              or sign in with your <TextLink onClick={backToId}>mobile number and an OTP</TextLink>.
            </p>
          )}
        </form>
      )}

      {step === 'otp' && (
        <form onSubmit={onVerify} className="space-y-4">
          {chip}
          <Field label="OTP code" htmlFor="otp" hint={sending ? `Sending a code to +91 ${mobile}…` : 'Enter the 6-digit code we sent by SMS. You’ll be signed in as soon as it’s complete.'}>
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
          <SubmitButton
            busy={busy || sending}
            disabled={code.length !== 6}
            label="Verify & sign in"
            busyLabel={sending ? 'Sending code…' : 'Signing you in…'}
          />
          <div className="text-right text-[12.5px]">
            <button type="button" disabled={!otp.canResend || busy || sending} onClick={sendOtp} className="font-medium disabled:opacity-50" style={{ color: 'var(--color-gold)' }}>
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
