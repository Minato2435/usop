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
// Every function checks who is calling, mirroring firestore.rules:
// Primary Admin manages everyone; an Institution Admin manages only
// Principal / HOD / Faculty / Student accounts of their own college.

import { onCall, HttpsError } from 'firebase-functions/https'
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

  let mbbsYear = null
  let rollNumber = null
  if (role === 'student') {
    mbbsYear = Number(input.mbbsYear)
    if (!YEARS.includes(mbbsYear)) fail('invalid-argument', 'Choose the MBBS year.')
    rollNumber = str(input.rollNumber)
    if (!rollNumber) fail('invalid-argument', 'Enter the registration number.')
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
  if (snap.docs.some((d) => d.id !== exceptUid)) fail('already-exists', `Registration number ${rollNumber} is already used by another student.`)
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

export const adminCreateUser = onCall(async (request) => {
  const caller = await requireAdmin(request)
  const profile = await cleanProfile(request.data?.profile ?? {})
  assertCanManage(caller, profile)
  const password = String(request.data?.password ?? '')
  if (password.length < 6) fail('invalid-argument', 'The password must be at least 6 characters.')
  await assertRollNumberFree(profile.rollNumber)

  let uid
  try {
    const user = await auth.createUser({ email: profile.email, password, phoneNumber: e164(profile.phone), displayName: profile.name })
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
  return { uid }
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
// use mobile + OTP too. Primary Admin only.
export const adminSyncPhones = onCall({ timeoutSeconds: 540 }, async (request) => {
  const caller = await requireAdmin(request)
  if (caller.role !== 'primaryAdmin') fail('permission-denied', 'Only the Primary Admin can run this.')
  const users = await db.collection('users').get()
  const result = { attached: 0, alreadyDone: 0, problems: [] }
  for (const doc of users.docs) {
    const u = doc.data()
    const label = `${u.name ?? '?'} <${u.email ?? '?'}>`
    if (!MOBILE_RE.test(u.phone ?? '')) {
      result.problems.push({ user: label, phone: u.phone ?? '', reason: 'No valid mobile number on the profile' })
      continue
    }
    try {
      const record = await auth.getUser(doc.id)
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

// Colleges and their enabled departments, for the registration form and the
// approver's review. Any signed-in person may ask (a registrant has no
// profile yet, so the database rules wouldn't let them read these lists).
export const registrationOptions = onCall(async (request) => {
  if (!request.auth) fail('unauthenticated', 'Please verify your mobile number first.')
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
  await assertRollNumberFree(profile.rollNumber)

  const record = await auth.getUser(uid)
  const hasPassword = record.providerData.some((p) => p.providerId === 'password')
  const password = String(request.data?.password ?? '')
  if (!hasPassword && password.length < 6) fail('invalid-argument', 'Choose a password of at least 6 characters.')
  if (password && password.length < 6) fail('invalid-argument', 'The password must be at least 6 characters.')
  try {
    await auth.updateUser(uid, { email: profile.email, displayName: profile.name, ...(password ? { password } : {}) })
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
  })
  return { ok: true }
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
  assertCanManage(caller, profile)
  await assertRollNumberFree(profile.rollNumber, uid)
  if ((await db.doc(`users/${uid}`).get()).exists) fail('already-exists', 'This account already has a profile.')
  try {
    await auth.getUser(uid)
  } catch {
    fail('not-found', 'This person deleted their login account.')
  }

  const batch = db.batch()
  batch.set(db.doc(`users/${uid}`), { ...profile, active: true, rejected: false })
  batch.update(reqRef, { ...profile, status: 'approved', reason: null, ...decided })
  await batch.commit()
  return { ok: true }
})
