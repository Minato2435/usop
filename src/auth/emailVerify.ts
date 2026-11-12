import { useEffect, useRef, useState } from 'react'
import { FirebaseError } from 'firebase/app'
import { sendEmailVerification } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { syncEmailStatus } from '../lib/accounts'

// Email verification for self-registered accounts. Firebase emails a link;
// clicking it (on any device) marks the login verified. The registration
// status page watches for that and copies it onto the request so approvers
// see it. Admin-created emails are trusted and never need this.

export const RESEND_EMAIL_AFTER_MS = 60_000
const sentKey = (uid: string) => `usop.verifyEmailSent.${uid}`

// When we last sent a link to this uid + email (this browser only).
function lastSent(uid: string, email: string): number | null {
  try {
    const [e, at] = (localStorage.getItem(sentKey(uid)) ?? '').split('|')
    return e && e.toLowerCase() === email.toLowerCase() && at ? Number(at) : null
  } catch {
    return null
  }
}

// One send at a time: a second caller while a send is running (e.g. the
// status page appearing while "Send for approval" is still sending) gets
// the same send instead of emailing a second link.
let inFlight: Promise<void> | null = null
export function sendVerificationEmail(): Promise<void> {
  if (!inFlight) inFlight = doSend().finally(() => { inFlight = null })
  return inFlight
}

async function doSend(): Promise<void> {
  const user = auth.currentUser
  if (!user) throw new Error('Please sign in again.')
  // The server just changed the email on this login; refresh so Firebase
  // sends to the new address.
  await user.reload()
  await user.getIdToken(true)
  if (!user.email) throw new Error('No email on this account yet.')
  await sendEmailVerification(user, { url: `${window.location.origin}/register` })
  try {
    localStorage.setItem(sentKey(user.uid), `${user.email}|${Date.now()}`)
  } catch {
    /* private mode — fine */
  }
}

export function describeEmailError(err: unknown): string {
  if (err instanceof FirebaseError && err.code === 'auth/too-many-requests') {
    return 'We’ve sent several links already. Wait a few minutes, then try again.'
  }
  return 'Couldn’t send the email. Check your connection and try again.'
}

// For the "Waiting for approval" page: is the email verified yet, plus a
// Resend action. Checks every few seconds while the page is open, and when
// the tab comes back into focus (e.g. after clicking the link in Gmail).
export function useEmailVerification(email: string | null, serverSaysVerified: boolean) {
  const uid = auth.currentUser?.uid ?? null  // Verified = the server says so for this request, or this browser's login
  // says so *for this exact address* (after an email change the old
  // "verified" must not carry over).
  const sameAddress = (u: typeof auth.currentUser) => !!u && !!email && (u.email ?? '').toLowerCase() === email.toLowerCase()
  const [localVerified, setLocalVerified] = useState(() => sameAddress(auth.currentUser) && auth.currentUser?.emailVerified === true)
  const verified = serverSaysVerified || localVerified
  const [sentAt, setSentAt] = useState<number | null>(() => (uid && email ? lastSent(uid, email) : null))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const synced = useRef(false)

  // A different address (the request was edited) starts over.
  useEffect(() => {
    setLocalVerified(sameAddress(auth.currentUser) && auth.currentUser?.emailVerified === true)
    synced.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email])

  // Tell the server once we see it verified, so the approver sees it too.
  useEffect(() => {
    if (!verified || serverSaysVerified || synced.current) return
    synced.current = true
    syncEmailStatus({}).catch(() => {
      synced.current = false
    })
  }, [verified, serverSaysVerified])

  // Poll while waiting.
  useEffect(() => {
    if (verified) return
    let stopped = false
    const check = async () => {
      const user = auth.currentUser
      if (!user || document.visibilityState !== 'visible') return
      try {
        await user.reload()
        if (!stopped && sameAddress(user) && user.emailVerified) setLocalVerified(true)
      } catch {
        /* offline — try again next tick */
      }
    }
    const id = setInterval(check, 5000)
    window.addEventListener('focus', check)
    void check()
    return () => {
      stopped = true
      clearInterval(id)
      window.removeEventListener('focus', check)
    }
  }, [verified])

  async function send() {
    setSending(true)
    setError(null)
    try {
      await sendVerificationEmail()
      setSentAt(Date.now())
      setNow(Date.now())
    } catch (err) {
      setError(describeEmailError(err))
    } finally {
      setSending(false)
    }
  }

  // No link sent for this address from this browser yet (e.g. the send
  // after "Send for approval" failed, or they changed the email) → send one.
  const autoSent = useRef(false)
  useEffect(() => {
    if (verified || sentAt !== null || autoSent.current || !email) return
    autoSent.current = true
    void (async () => {
      // A send already under way (from "Send for approval")? Wait for it and
      // use it rather than sending another link.
      if (inFlight) {
        await inFlight.catch(() => {})
        const u = auth.currentUser
        const at = u ? lastSent(u.uid, email) : null
        if (at !== null) {
          setSentAt(at)
          setNow(Date.now())
          return
        }
      }
      await send()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verified, sentAt, email])

  // Countdown for Resend.
  useEffect(() => {
    if (verified || sentAt === null) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [verified, sentAt])

  const waitMs = sentAt === null ? 0 : Math.max(0, sentAt + RESEND_EMAIL_AFTER_MS - now)
  return { verified, sentAt, sending, error, send, canResend: waitMs === 0 && !sending, resendIn: Math.ceil(waitMs / 1000) }
}
