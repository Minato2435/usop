import { useEffect, useState } from 'react'
import { httpsCallable } from 'firebase/functions'
import { collection, doc, onSnapshot, query, where, type Unsubscribe } from 'firebase/firestore'
import { db, functions } from './firebase'
import type { AccountProfile, MbbsYear, RegistrationRequest } from '../types'

// Calls into the server functions (functions/index.js) for everything that
// touches someone else's login account, plus self-registration.

function call<In, Out = { ok: true }>(name: string) {
  const fn = httpsCallable<In, Out>(functions, name)
  return async (data: In): Promise<Out> => (await fn(data)).data
}

// Server errors already carry a readable message; fall back for anything else.
export function accountErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const e = err as { code?: string; message?: string }
  if (e?.code?.startsWith('functions/') && e.code !== 'functions/internal' && e.message) return e.message
  if (e?.code === 'functions/internal' && e.message && e.message !== 'internal') return e.message
  if (e?.code === 'functions/not-found' || e?.message === 'NOT_FOUND') return 'The server isn’t set up yet (functions not deployed).'
  return fallback
}

export const adminCreateUser = call<{ profile: AccountProfile; password: string }, { uid: string }>('adminCreateUser')
export const adminUpdateUser = call<{ uid: string; profile: AccountProfile; password?: string }>('adminUpdateUser')
export const adminDeleteUser = call<{ uid: string }>('adminDeleteUser')

export interface RegistrationOptions {
  institutions: { id: string; name: string; city: string; state: string }[]
  departments: Record<string, { id: string; name: string; mbbsYear: MbbsYear }[]>
}
export const checkMobile = call<{ mobile: string }, { exists: boolean }>('checkMobile')
export const getRegistrationOptions = call<Record<string, never>, RegistrationOptions>('registrationOptions')

export type RegistrationInput = Omit<AccountProfile, 'phone' | 'assignedHOD'> & { password?: string }
export const submitRegistration = call<RegistrationInput, { ok: true; emailVerified: boolean }>('submitRegistration')
// Copy the login's email-verified flag onto the request (own, or — for an
// approver — someone else's by uid).
export const syncEmailStatus = call<{ uid?: string }, { emailVerified: boolean }>('syncEmailStatus')
export const passwordResetAllowed = call<{ email: string }, { allowed: boolean }>('passwordResetAllowed')
export const cancelRegistration = call<Record<string, never>>('cancelRegistration')
export const decideRegistration = call<{
  uid: string
  decision: 'approve' | 'reject'
  reason?: string
  edits?: Partial<AccountProfile>
}>('decideRegistration')

// ── Reading requests ────────────────────────────────────────────────────

const requestsRef = collection(db, 'registrationRequests')
const toRequest = (id: string, data: object) => ({ uid: id, ...data }) as RegistrationRequest

export function watchMyRegistration(uid: string, onChange: (r: RegistrationRequest | null) => void, onError?: (e: unknown) => void): Unsubscribe {
  return onSnapshot(
    doc(requestsRef, uid),
    (snap) => onChange(snap.exists() ? toRequest(snap.id, snap.data()) : null),
    (e) => onError?.(e),
  )
}

// Primary Admin: every request. Institution Admin: their college's requests
// that they approve — filters on exactly the fields the rule reads.
export function watchRegistrationRequests(
  scope: { institutionId: string } | 'all',
  onChange: (rs: RegistrationRequest[]) => void,
  onError?: (e: unknown) => void,
): Unsubscribe {
  const q =
    scope === 'all'
      ? query(requestsRef)
      : query(requestsRef, where('institutionId', '==', scope.institutionId), where('approver', '==', 'institution'))
  return onSnapshot(
    q,
    (snap) => onChange(snap.docs.map((d) => toRequest(d.id, d.data()))),
    (e) => {
      onChange([])
      onError?.(e)
    },
  )
}

// Live count of requests waiting for this approver (sidebar badge).
export function usePendingRegistrationCount(scope: { institutionId: string | null } | 'all' | null): number {
  const key = scope === null ? null : scope === 'all' ? 'all' : scope.institutionId
  const [count, setCount] = useState(0)
  useEffect(() => {
    if (!key) {
      setCount(0)
      return
    }
    return watchRegistrationRequests(key === 'all' ? 'all' : { institutionId: key }, (rs) => setCount(rs.filter((r) => r.status === 'pending').length))
  }, [key])
  return count
}
