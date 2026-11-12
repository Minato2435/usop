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
    return e === email && at ? Number(at) : null
  } catch {
    return null
  }
}

export async function sendVerificationEmail(): Promise<void> {
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
  const uid = auth.currentUser?.uid ?? null
  const [verified, setVerified] = useState(serverSaysVerified || auth.currentUser?.emailVerified === true)
  const [sentAt, setSentAt] = useState<number | null>(() => (uid && email ? lastSent(uid, email) : null))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const synced = useRef(false)

  useEffect(() => {
    if (serverSaysVerified) setVerified(true)
  }, [serverSaysVerified])

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
        if (!stopped && user.emailVerified) setVerified(true)
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
    void send()
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
