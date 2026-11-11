import { useEffect, useRef, useState } from 'react'
import { FirebaseError } from 'firebase/app'
import { RecaptchaVerifier, signInWithPhoneNumber, type ConfirmationResult, type UserCredential } from 'firebase/auth'
import { auth } from '../lib/firebase'

// Shared by the sign-in page and the registration form: sending an OTP to a
// +91 number and confirming it (which signs that number in).

export const RESEND_AFTER_MS = 30_000

// "98765 43210", "+91 98765-43210", "919876543210" → "9876543210".
export function normalizeMobile(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits
}
export const isValidMobile = (digits: string) => /^[6-9]\d{9}$/.test(digits)
export const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())

export function describeAuthError(err: unknown): string {
  if (err instanceof FirebaseError) {
    switch (err.code) {
      case 'auth/invalid-credential':
      case 'auth/invalid-login-credentials':
      case 'auth/wrong-password':
      case 'auth/user-not-found':
        return 'Incorrect email or password.'
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
        return 'The daily SMS limit has been reached. Please try again tomorrow or sign in with email.'
      case 'auth/invalid-app-credential':
        return window.location.hostname === 'localhost'
          ? 'Real numbers can’t receive an OTP on localhost (a Firebase rule). Use a test number here, or the live site.'
          : 'The security check failed. Reload the page and try again.'
      case 'auth/captcha-check-failed':
        return 'The security check failed. Reload the page and try again.'
      case 'auth/operation-not-allowed':
        return 'Mobile sign-in isn’t switched on for this app yet.'
      case 'auth/network-request-failed':
        return 'Network error. Check your connection and try again.'
      default:
        return `Something went wrong (${err.code}).`
    }
  }
  return 'Something went wrong. Please try again.'
}

export function usePhoneOtp() {
  // Render <div ref={recaptchaHost} /> somewhere on the page: Firebase needs
  // an (invisible) reCAPTCHA before it sends an SMS from a browser.
  const recaptchaHost = useRef<HTMLDivElement>(null)
  const verifierRef = useRef<RecaptchaVerifier | null>(null)
  const [confirmation, setConfirmation] = useState<ConfirmationResult | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [resendAt, setResendAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!confirmation) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [confirmation])

  // Build (and pre-render) a fresh invisible verifier. Done ahead of time —
  // on page load and again straight after every send — so clicking
  // "Send OTP" doesn't first wait for Google's reCAPTCHA script to download
  // and start. A used or failed verifier can't be reused, and rendering twice
  // into one element throws, so each one gets a new child element.
  function prepare(): RecaptchaVerifier | null {
    const host = recaptchaHost.current
    if (!host) return null
    verifierRef.current?.clear()
    host.innerHTML = ''
    const el = document.createElement('div')
    host.appendChild(el)
    const verifier = new RecaptchaVerifier(auth, el, { size: 'invisible' })
    verifierRef.current = verifier
    verifier.render().catch(() => {
      // Network hiccup: send() will build another one.
      if (verifierRef.current === verifier) verifierRef.current = null
    })
    return verifier
  }

  useEffect(() => {
    prepare()
    return () => {
      verifierRef.current?.clear()
      verifierRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function send(mobile: string): Promise<void> {
    const verifier = verifierRef.current ?? prepare()
    if (!verifier) throw new Error('The page isn’t ready yet. Try again in a moment.')
    try {
      const result = await signInWithPhoneNumber(auth, `+91${mobile}`, verifier)
      setConfirmation(result)
      setSentTo(mobile)
      setNow(Date.now())
      setResendAt(Date.now() + RESEND_AFTER_MS)
    } finally {
      // Ready a new one for "Resend" or a retry, in the background.
      prepare()
    }
  }

  async function confirm(code: string): Promise<UserCredential> {
    if (!confirmation) throw new Error('Send the code first.')
    return confirmation.confirm(code.trim())
  }

  function reset() {
    setConfirmation(null)
    setSentTo(null)
  }

  return {
    recaptchaHost,
    send,
    confirm,
    reset,
    codeSent: confirmation !== null,
    sentTo,
    canResend: now >= resendAt,
    resendIn: Math.max(0, Math.ceil((resendAt - now) / 1000)),
  }
}
