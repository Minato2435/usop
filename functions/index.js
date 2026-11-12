// USOP server functions (Firebase Cloud Functions, Mumbai region).
//
// Two jobs only the server can do:
//   1. Manage OTHER people's login accounts — create one with email +
//      password + mobile already attached, change someone's email/mobile,
//      reset their password, delete them. A browser can only change the
//      account that is signed in, so the admin screens call these instead.
//   2. Self-registration — a new person verifies their mobile by OTP (that
//      creates their login), fills in a request, and an admin approves or
//      rejects it. Nobody gets a profile (and so any access) until approved.
//
// Email verification: an email an admin types is trusted (marked verified);
// a self-registered email must be verified by its link before the request
// can be approved. A daily job clears abandoned sign-ups.
//
// Every function checks who is calling, mirroring firestore.rules:
// Primary Admin manages everyone; an Institution Admin manages only
// Principal / HOD / Faculty / Student accounts of their own college.

import { onCall, HttpsError } from 'firebase-functions/https'
import { onSchedule } from 'firebase-functions/scheduler'
import { setGlobalOptions } from 'firebase-functions'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

initializeApp()
setGlobalOptions({ region: 'asia-south1', maxInstances: 10 })

const db = getFirestore()
const auth = getAuth()

const CREATABLE_ROLES = ['institutionAdmin', 'skillLabDirector', 'principal', 'hod', 'faculty', 'student']
const COLLEGE_ROLES = ['principal', 'hod', 'faculty', 'student']
const PLATFORM_ROLES = ['skillLabDirector']
// Roles a person may ask for when signing up. Skill Lab Director accounts are
// created by the Primary Admin only.
const REGISTRABLE_ROLES = ['institutionAdmin', 'principal', 'hod', 'faculty', 'student']
const YEARS = [1, 2, 3, 4]
const MOBILE_RE = /^[6-9]\d{9}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const fail = (code, message) => {
  throw new HttpsError(code, message)
}

// ── Who is calling ───────────────────────────────────────────────────────

async function requireAdmin(request) {
  if (!request.auth) fail('unauthenticated', 'Please sign in again.')
  const snap = await db.doc(`users/${request.auth.uid}`).get()
  const me = snap.exists ? { uid: snap.id, ...snap.data() } : null
  if (!me || me.active !== true) fail('permission-denied', 'Your account is not active.')
  if (me.role !== 'primaryAdmin' && me.role !== 'institutionAdmin') fail('permission-denied', 'Only administrators can do this.')
  return me
}

// Can `caller` manage an account shaped like `target` ({ role, institutionId })?
function assertCanManage(caller, target) {
  if (target.role === 'primaryAdmin') fail('permission-denied', 'Primary Admin accounts can’t be managed here.')
  if (caller.role === 'primaryAdmin') return
  if (!COLLEGE_ROLES.includes(target.role) || !target.institutionId || target.institutionId !== caller.institutionId) {
    fail('permission-denied', 'You can only manage Principal, HOD, Faculty and Student accounts of your own college.')
  }
}

// ── Validation ───────────────────────────────────────────────────────────

const str = (v) => (typeof v === 'string' ? v.trim() : '')

// Builds a clean profile from untrusted input. Only the fields that belong
// to the role are kept; everything else is null.
async function cleanProfile(input) {
  const role = str(input.role)
  if (!CREATABLE_ROLES.includes(role)) fail('invalid-argument', 'Choose a valid role.')
  const name = str(input.name)
  if (!name) fail('invalid-argument', 'Enter the full name.')
  const email = str(input.email).toLowerCase()
  if (!EMAIL_RE.test(email)) fail('invalid-argument', 'Enter a valid email address.')
  const phone = str(input.phone)
  if (!MOBILE_RE.test(phone)) fail('invalid-argument', 'Enter a valid 10-digit Indian mobile number.')

  const platformWide = PLATFORM_ROLES.includes(role)
  const institutionId = platformWide ? null : str(input.institutionId)
  if (!platformWide) {
    if (!institutionId) fail('invalid-argument', 'Choose a college.')
    const inst = await db.doc(`institutions/${institutionId}`).get()
    if (!inst.exists) fail('invalid-argument', 'That college doesn’t exist.')
  }

  let departmentId = null
  if (role === 'hod' || role === 'faculty') {
    departmentId = str(input.departmentId)
    if (!departmentId) fail('invalid-argument', 'Choose a department.')
    const dept = await db.doc(`departments/${departmentId}`).get()
    const d = dept.data()
    if (!dept.exists || (d.institutionId !== '' && d.institutionId !== institutionId)) fail('invalid-argument', 'That department isn’t part of this college.')
  }

  // Every role has a registration number: a student's university
  // registration no., a doctor's medical-council no., an admin's staff no.
  // Unique across the platform (see assertRollNumberFree).
  const rollNumber = str(input.rollNumber).replace(/\s+/g, ' ')
  if (!rollNumber) fail('invalid-argument', 'Enter the registration number.')
  if (rollNumber.length > 40) fail('invalid-argument', 'The registration number is too long.')

  let mbbsYear = null
  if (role === 'student') {
    mbbsYear = Number(input.mbbsYear)
    if (!YEARS.includes(mbbsYear)) fail('invalid-argument', 'Choose the MBBS year.')
  }

  let associatedMbbsYears = null
  if (role === 'faculty') {
    const years = Array.isArray(input.associatedMbbsYears) ? input.associatedMbbsYears.map(Number) : []
    associatedMbbsYears = [...new Set(years.filter((y) => YEARS.includes(y)))].sort()
    if (associatedMbbsYears.length === 0) fail('invalid-argument', 'Choose at least one MBBS year.')
  }

  const assignedHOD = role === 'student' && str(input.assignedHOD) ? str(input.assignedHOD) : null

  return { role, name, email, phone, institutionId, departmentId, mbbsYear, associatedMbbsYears, rollNumber, assignedHOD }
}

async function assertRollNumberFree(rollNumber, exceptUid) {
  if (!rollNumber) return
  const snap = await db.collection('users').where('rollNumber', '==', rollNumber).limit(2).get()
  if (snap.docs.some((d) => d.id !== exceptUid)) fail('already-exists', `Registration number ${rollNumber} is already used by another account.`)
}

// Turns Auth errors into messages an admin can act on.
function authFail(err) {
  const code = err?.code ?? err?.errorInfo?.code
  if (code === 'auth/email-already-exists') fail('already-exists', 'That email is already used by another account.')
  if (code === 'auth/phone-number-already-exists') fail('already-exists', 'That mobile number is already used by another account.')
  if (code === 'auth/invalid-password') fail('invalid-argument', 'The password must be at least 6 characters.')
  if (code === 'auth/invalid-email') fail('invalid-argument', 'That email address looks invalid.')
  if (code === 'auth/invalid-phone-number') fail('invalid-argument', 'That mobile number looks invalid.')
  if (code === 'auth/user-not-found') fail('not-found', 'This person has no login account.')
  if (err instanceof HttpsError) throw err
  console.error(err)
  fail('internal', 'Something went wrong. Please try again.')
}

const e164 = (phone) => `+91${phone}`

// ── 1. Admin: manage accounts ────────────────────────────────────────────

// Creates one login + profile. `password` may be empty only for bulk
// imports: the person then signs in with mobile + OTP (or sets a password
// via "Forgot password?", which works because the email is trusted).
async function createAccount(caller, profileInput, password, { passwordOptional = false } = {}) {
  const profile = await cleanProfile(profileInput ?? {})
  assertCanManage(caller, profile)
  if (password || !passwordOptional) {
    if (password.length < 6) fail('invalid-argument', 'The password must be at least 6 characters.')
  }
  await assertRollNumberFree(profile.rollNumber)

  let uid
  try {
    // emailVerified: the admin vouches for the address, so no link is needed.
    const user = await auth.createUser({
      email: profile.email,
      emailVerified: true,
      phoneNumber: e164(profile.phone),
      displayName: profile.name,
      ...(password ? { password } : {}),
    })
    uid = user.uid
  } catch (err) {
    authFail(err)
  }
  try {
    await db.doc(`users/${uid}`).set({ ...profile, active: true, rejected: false })
  } catch (err) {
    await auth.deleteUser(uid).catch(() => {})
    authFail(err)
  }
  return uid
}

export const adminCreateUser = onCall(async (request) => {
  const caller = await requireAdmin(request)
  const uid = await createAccount(caller, request.data?.profile, String(request.data?.password ?? ''))
  return { uid }
})

// Bulk import: up to 50 people per call (the page sends the list in
// chunks). Each row succeeds or fails on its own — one bad row never stops
// the rest — and the result says which, with a readable reason.
const BULK_MAX = 50
export const adminBulkCreateUsers = onCall({ timeoutSeconds: 300 }, async (request) => {
  const caller = await requireAdmin(request)
  const rows = Array.isArray(request.data?.rows) ? request.data.rows : []
  if (rows.length === 0) fail('invalid-argument', 'No people to add.')
  if (rows.length > BULK_MAX) fail('invalid-argument', `Send at most ${BULK_MAX} people at a time.`)
  const password = String(request.data?.password ?? '')
  if (password && password.length < 6) fail('invalid-argument', 'The password must be at least 6 characters.')

  // A few at a time: fast, but well inside Auth's account-creation limits.
  const results = new Array(rows.length)
  let next = 0
  async function worker() {
    while (next < rows.length) {
      const i = next++
      const key = str(rows[i]?.key) || String(i)
      try {
        const uid = await createAccount(caller, rows[i]?.profile, password, { passwordOptional: true })
        results[i] = { key, ok: true, uid }
      } catch (err) {
        const message = err instanceof HttpsError ? err.message : 'Something went wrong.'
        if (!(err instanceof HttpsError)) console.error(err)
        results[i] = { key, ok: false, error: message }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(5, rows.length) }, worker))
  return { results }
})

export const adminUpdateUser = onCall(async (request) => {
  const caller = await requireAdmin(request)
  const uid = str(request.data?.uid)
  const snap = await db.doc(`users/${uid}`).get()
  if (!uid || !snap.exists) fail('not-found', 'That user no longer exists.')
  assertCanManage(caller, snap.data())
  const profile = await cleanProfile(request.data?.profile ?? {})
  assertCanManage(caller, profile)
  await assertRollNumberFree(profile.rollNumber, uid)

  const password = String(request.data?.password ?? '')
  if (password && password.length < 6) fail('invalid-argument', 'The new password must be at least 6 characters.')

  try {
    await auth.updateUser(uid, {
      email: profile.email,
      emailVerified: true, // set by an admin → trusted
      phoneNumber: e164(profile.phone),
      displayName: profile.name,
      ...(password ? { password } : {}),
    })
  } catch (err) {
    authFail(err)
  }
  await db.doc(`users/${uid}`).set(profile, { merge: true })
  return { ok: true }
})

export const adminDeleteUser = onCall(async (request) => {
  const caller = await requireAdmin(request)
  const uid = str(request.data?.uid)
  if (uid === caller.uid) fail('failed-precondition', 'You can’t delete your own account.')
  const snap = await db.doc(`users/${uid}`).get()
  if (!uid || !snap.exists) fail('not-found', 'That user no longer exists.')
  assertCanManage(caller, snap.data())
  try {
    await auth.deleteUser(uid)
  } catch (err) {
    if ((err?.code ?? err?.errorInfo?.code) !== 'auth/user-not-found') authFail(err)
  }
  await db.doc(`users/${uid}`).delete()
  await db.doc(`registrationRequests/${uid}`).delete().catch(() => {})
  return { ok: true }
})

// One-time (and safe to repeat): attach every profile's saved mobile number
// to its login account, so accounts made before these functions existed can
// use mobile + OTP too — and mark their emails verified (they were all added
// by an admin), so "Forgot password?" works for them. Primary Admin only.
export const adminSyncPhones = onCall({ timeoutSeconds: 540 }, async (request) => {
  const caller = await requireAdmin(request)
  if (caller.role !== 'primaryAdmin') fail('permission-denied', 'Only the Primary Admin can run this.')
  const users = await db.collection('users').get()
  const result = { attached: 0, alreadyDone: 0, emailsMarkedVerified: 0, problems: [] }
  for (const doc of users.docs) {
    const u = doc.data()
    const label = `${u.name ?? '?'} <${u.email ?? '?'}>`
    if (!MOBILE_RE.test(u.phone ?? '')) {
      result.problems.push({ user: label, phone: u.phone ?? '', reason: 'No valid mobile number on the profile' })
      continue
    }
    try {
      const record = await auth.getUser(doc.id)
      if (record.email && !record.emailVerified) {
        await auth.updateUser(doc.id, { emailVerified: true })
        result.emailsMarkedVerified++
      }
      if (record.phoneNumber === e164(u.phone)) {
        result.alreadyDone++
        continue
      }
      await auth.updateUser(doc.id, { phoneNumber: e164(u.phone) })
      result.attached++
    } catch (err) {
      const code = err?.code ?? err?.errorInfo?.code
      result.problems.push({
        user: label,
        phone: u.phone,
        reason:
          code === 'auth/phone-number-already-exists'
            ? 'Number already belongs to another account'
            : code === 'auth/user-not-found'
              ? 'Profile has no login account'
              : String(code ?? err),
      })
    }
  }
  return result
})

// ── 2. Self-registration ─────────────────────────────────────────────────

// Sign-in page: is this mobile number on any login? Checked before sending an
// OTP, so an unregistered number gets "No account uses this number" straight
// away instead of an SMS. Public (the person isn't signed in yet). It does
// reveal whether a number has an account — the same thing the old flow showed
// after the OTP, just without spending an SMS.
export const checkMobile = onCall(async (request) => {
  const mobile = String(request.data?.mobile ?? '')
  if (!MOBILE_RE.test(mobile)) throw new HttpsError('invalid-argument', 'Enter a valid 10-digit mobile number.')
  try {
    await auth.getUserByPhoneNumber(`+91${mobile}`)
    return { exists: true }
  } catch (e) {
    if (e?.code === 'auth/user-not-found') return { exists: false }
    throw new HttpsError('internal', 'Couldn’t check that number. Try again.')
  }
})

// Colleges and their enabled departments, for the registration form and the
// approver's review. Public: the form is filled in before the mobile number
// is verified, and college / department names aren't sensitive.
export const registrationOptions = onCall(async () => {
  const [insts, depts, overrides] = await Promise.all([
    db.collection('institutions').get(),
    db.collection('departments').get(),
    db.collection('institutionDepartmentOverrides').get(),
  ])
  const off = new Set(overrides.docs.filter((d) => d.data().enabled === false).map((d) => `${d.data().institutionId}_${d.data().departmentId}`))
  const allDepts = depts.docs.map((d) => ({ id: d.id, ...d.data() }))
  const institutions = insts.docs
    .map((d) => ({ id: d.id, name: d.data().name ?? '', city: d.data().city ?? '', state: d.data().state ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const departments = {}
  for (const inst of institutions) {
    departments[inst.id] = allDepts
      .filter((d) => (d.institutionId === '' || d.institutionId === inst.id) && !off.has(`${inst.id}_${d.id}`))
      .map((d) => ({ id: d.id, name: d.name, mbbsYear: d.mbbsYear }))
      .sort((a, b) => a.mbbsYear - b.mbbsYear || a.name.localeCompare(b.name))
  }
  return { institutions, departments }
})

export const submitRegistration = onCall(async (request) => {
  if (!request.auth) fail('unauthenticated', 'Please verify your mobile number first.')
  const uid = request.auth.uid
  const phoneE164 = request.auth.token.phone_number
  if (!phoneE164 || !phoneE164.startsWith('+91')) fail('failed-precondition', 'Verify your Indian mobile number first.')
  if ((await db.doc(`users/${uid}`).get()).exists) fail('already-exists', 'This account is already active. Please sign in.')

  const reqRef = db.doc(`registrationRequests/${uid}`)
  const existing = await reqRef.get()
  if (existing.exists && existing.data().status === 'approved') fail('already-exists', 'This request was already approved. Please sign in.')

  const profile = await cleanProfile({ ...(request.data ?? {}), phone: phoneE164.slice(3) })
  if (!REGISTRABLE_ROLES.includes(profile.role)) fail('invalid-argument', 'This role can’t be requested. Ask the platform admin.')
  await assertRollNumberFree(profile.rollNumber)

  const record = await auth.getUser(uid)
  const hasPassword = record.providerData.some((p) => p.providerId === 'password')
  const password = String(request.data?.password ?? '')
  if (!hasPassword && password.length < 6) fail('invalid-argument', 'Choose a password of at least 6 characters.')
  if (password && password.length < 6) fail('invalid-argument', 'The password must be at least 6 characters.')
  // A new (or changed) email starts unverified; the page then emails a link.
  const sameEmail = (record.email ?? '').toLowerCase() === profile.email
  const emailVerified = sameEmail && record.emailVerified === true
  try {
    await auth.updateUser(uid, { email: profile.email, emailVerified, displayName: profile.name, ...(password ? { password } : {}) })
  } catch (err) {
    authFail(err)
  }

  await reqRef.set({
    ...profile,
    approver: COLLEGE_ROLES.includes(profile.role) ? 'institution' : 'primary',
    status: 'pending',
    submittedAt: Date.now(),
    firstSubmittedAt: existing.exists ? (existing.data().firstSubmittedAt ?? existing.data().submittedAt) : Date.now(),
    reason: null,
    decidedAt: null,
    decidedById: null,
    decidedByName: null,
    emailVerified,
  })
  return { ok: true, emailVerified }
})

// Copies "has the email link been clicked?" from the login onto the request,
// so approvers (who can't read logins) see it. Called by the registrant's page
// once it notices the click, and by the approver's review window.
export const syncEmailStatus = onCall(async (request) => {
  if (!request.auth) fail('unauthenticated', 'Please sign in again.')
  let uid = request.auth.uid
  const target = str(request.data?.uid)
  if (target && target !== uid) {
    const caller = await requireAdmin(request)
    const snap = await db.doc(`registrationRequests/${target}`).get()
    if (!snap.exists) fail('not-found', 'This request no longer exists.')
    const req = snap.data()
    if (caller.role !== 'primaryAdmin' && (req.approver !== 'institution' || req.institutionId !== caller.institutionId)) {
      fail('permission-denied', 'This request is for another approver.')
    }
    uid = target
  }
  let verified = false
  try {
    verified = (await auth.getUser(uid)).emailVerified === true
  } catch {
    return { emailVerified: false }
  }
  const ref = db.doc(`registrationRequests/${uid}`)
  const snap = await ref.get()
  if (snap.exists && snap.data().emailVerified !== verified) await ref.update({ emailVerified: verified })
  return { emailVerified: verified }
})

// "Forgot password?" — only for a verified email, so a mistyped address can
// never receive someone else's reset link. Returns whether the page should
// ask Firebase to send the reset email.
export const passwordResetAllowed = onCall(async (request) => {
  const email = str(request.data?.email).toLowerCase()
  if (!EMAIL_RE.test(email)) fail('invalid-argument', 'Enter a valid email address.')
  try {
    const user = await auth.getUserByEmail(email)
    return { allowed: user.emailVerified === true && !user.disabled }
  } catch {
    return { allowed: false }
  }
})

// The registrant withdraws: removes the request and their login account.
export const cancelRegistration = onCall(async (request) => {
  if (!request.auth) fail('unauthenticated', 'Please sign in again.')
  const uid = request.auth.uid
  if ((await db.doc(`users/${uid}`).get()).exists) fail('failed-precondition', 'This account is already active.')
  await db.doc(`registrationRequests/${uid}`).delete()
  await auth.deleteUser(uid).catch(() => {})
  return { ok: true }
})

export const decideRegistration = onCall(async (request) => {
  const caller = await requireAdmin(request)
  const uid = str(request.data?.uid)
  const reqRef = db.doc(`registrationRequests/${uid}`)
  const snap = await reqRef.get()
  if (!uid || !snap.exists) fail('not-found', 'This request no longer exists.')
  const req = snap.data()
  if (req.status !== 'pending') fail('failed-precondition', 'This request has already been decided.')
  if (caller.role !== 'primaryAdmin' && (req.approver !== 'institution' || req.institutionId !== caller.institutionId)) {
    fail('permission-denied', 'This request is for another approver.')
  }

  const decision = request.data?.decision
  const decided = { decidedAt: Date.now(), decidedById: caller.uid, decidedByName: caller.name ?? '' }

  if (decision === 'reject') {
    const reason = str(request.data?.reason)
    if (!reason) fail('invalid-argument', 'Give a short reason, so the person knows what to fix.')
    await reqRef.update({ status: 'rejected', reason, ...decided })
    return { ok: true }
  }
  if (decision !== 'approve') fail('invalid-argument', 'Unknown decision.')

  // The approver may correct details (year, department, …) but never the
  // verified mobile number or the login email.
  const edits = request.data?.edits ?? {}
  const profile = await cleanProfile({ ...req, ...edits, phone: req.phone, email: req.email })
  if (!REGISTRABLE_ROLES.includes(profile.role)) fail('invalid-argument', 'This role can’t be given through a registration.')
  assertCanManage(caller, profile)
  await assertRollNumberFree(profile.rollNumber, uid)
  if ((await db.doc(`users/${uid}`).get()).exists) fail('already-exists', 'This account already has a profile.')
  let record
  try {
    record = await auth.getUser(uid)
  } catch {
    fail('not-found', 'This person deleted their login account.')
  }
  if (!record.emailVerified) {
    await reqRef.update({ emailVerified: false }).catch(() => {})
    fail('failed-precondition', 'Their email isn’t verified yet. They need to click the link we emailed them.')
  }

  const batch = db.batch()
  batch.set(db.doc(`users/${uid}`), { ...profile, active: true, rejected: false })
  batch.update(reqRef, { ...profile, status: 'approved', reason: null, emailVerified: true, ...decided })
  await batch.commit()
  return { ok: true }
})

// ── 3. Abandoned sign-ups (daily clean-up + Primary Admin's list) ───────
//
// "Abandoned" = a login with no profile that is either
//   • 'empty'      — verified a mobile but never sent the form (no request), or
//   • 'unverified' — sent a request but never clicked the email link.
// Anyone with a users/{uid} profile is never included. Rejected requests
// aren't abandoned (the person may fix and resend).
const DAY = 86_400_000
const KEEP_EMPTY_DAYS = 7
const KEEP_UNVERIFIED_DAYS = 14

async function findAbandoned() {
  const [profiles, requests] = await Promise.all([db.collection('users').select().get(), db.collection('registrationRequests').get()])
  const hasProfile = new Set(profiles.docs.map((d) => d.id))
  const reqs = new Map(requests.docs.map((d) => [d.id, d.data()]))
  const items = []
  let pageToken
  do {
    const page = await auth.listUsers(1000, pageToken)
    for (const u of page.users) {
      if (hasProfile.has(u.uid)) continue
      const created = Date.parse(u.metadata.creationTime)
      const req = reqs.get(u.uid)
      const base = {
        uid: u.uid,
        phone: (u.phoneNumber ?? '').replace(/^\+91/, ''),
        createdAt: created,
        lastSignInAt: u.metadata.lastSignInTime ? Date.parse(u.metadata.lastSignInTime) : null,
      }
      if (!req) {
        items.push({ ...base, kind: 'empty', name: u.displayName ?? '', email: u.email ?? '', role: null, institutionId: null, since: created, autoRemoveAt: created + KEEP_EMPTY_DAYS * DAY })
      } else if (req.status === 'pending' && !u.emailVerified) {
        const since = req.submittedAt ?? created
        items.push({ ...base, kind: 'unverified', name: req.name ?? '', email: req.email ?? '', role: req.role ?? null, institutionId: req.institutionId ?? null, since, autoRemoveAt: since + KEEP_UNVERIFIED_DAYS * DAY })
      }
    }
    pageToken = page.pageToken
  } while (pageToken)
  return items.sort((a, b) => a.since - b.since)
}

async function removeSignup(uid) {
  await db.doc(`registrationRequests/${uid}`).delete().catch(() => {})
  await auth.deleteUser(uid).catch(() => {})
}

// Primary Admin: see every abandoned sign-up (any age), with when the daily
// job would remove it.
export const listAbandonedSignups = onCall({ timeoutSeconds: 120 }, async (request) => {
  const caller = await requireAdmin(request)
  if (caller.role !== 'primaryAdmin') fail('permission-denied', 'Only the Primary Admin can see this.')
  return { items: await findAbandoned() }
})

// Primary Admin: remove chosen abandoned sign-ups now. Each uid is re-checked
// on the server, so an account that has meanwhile been approved (or verified
// its email) is never removed.
export const removeAbandonedSignups = onCall({ timeoutSeconds: 300 }, async (request) => {
  const caller = await requireAdmin(request)
  if (caller.role !== 'primaryAdmin') fail('permission-denied', 'Only the Primary Admin can do this.')
  const uids = Array.isArray(request.data?.uids) ? request.data.uids.map(String) : []
  if (uids.length === 0) fail('invalid-argument', 'Choose at least one sign-up to remove.')
  const abandoned = new Set((await findAbandoned()).map((i) => i.uid))
  let removed = 0
  let skipped = 0
  for (const uid of uids) {
    if (!abandoned.has(uid)) {
      skipped++
      continue
    }
    await removeSignup(uid)
    removed++
  }
  return { removed, skipped }
})

// Daily (03:30 IST): remove empty logins after 7 days and unverified requests
// 14 days after they were sent.
export const cleanupAbandonedSignups = onSchedule({ schedule: 'every day 03:30', timeZone: 'Asia/Kolkata', timeoutSeconds: 540 }, async () => {
  const now = Date.now()
  let removed = 0
  for (const item of await findAbandoned()) {
    if (now < item.autoRemoveAt) continue
    await removeSignup(item.uid)
    removed++
  }
  console.log(`cleanupAbandonedSignups: removed ${removed} abandoned sign-up(s)`)
})
