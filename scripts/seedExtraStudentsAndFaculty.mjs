// One-off seed script — NOT wired into the app, run manually. Adds a
// bigger, uniformly-named batch of Student/Faculty test accounts to the
// SAME test institution scripts/seedTestInstitution.mjs already created
// ("USOP Test Institution", Dermatology department) — for testing list/
// table pages (HOD's Students/Faculty tabs, Principal's Directory, sort
// and search) that need more than a handful of rows to look right.
//
// Creates:
//   - 8 students: s1@gmail.com .. s8@gmail.com
//   - 4 faculty:  f1@gmail.com .. f4@gmail.com
//   - password "123456" for every account this script creates
//   - all in the Dermatology department of USOP Test Institution,
//     assigned to that department's existing HOD (hod.test@usoptest.local)
//
// Expects seedTestInstitution.mjs to have already been run at least once
// (so the institution + department already exist) — this script finds
// them by name rather than recreating them, and fails loudly if it can't
// find either, rather than silently creating a second copy.
//
// Same Firebase client SDK + secondary-app account-creation technique as
// seedTestInstitution.mjs/createUserAccount() — see that script's header
// comment for the full explanation. Idempotent: re-running skips any
// email that already has an account.
//
// Run it yourself, from the repo root:
//   SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD=your-password \
//     node scripts/seedExtraStudentsAndFaculty.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth'
import { getFirestore, collection, doc, setDoc, getDocs, query, where, limit } from 'firebase/firestore'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadEnvFile() {
  const envPath = path.resolve(__dirname, '../.env')
  if (!fs.existsSync(envPath)) return {}
  const out = {}
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}

const env = { ...loadEnvFile(), ...process.env }
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
}

const INSTITUTION_NAME = 'USOP Test Institution'
const DEPARTMENT_NAME = 'Dermatology'
const HOD_EMAIL = 'hod.test@usoptest.local'
const PASSWORD = '123456'

const STUDENT_NAMES = [
  'Student One', 'Student Two', 'Student Three', 'Student Four',
  'Student Five', 'Student Six', 'Student Seven', 'Student Eight',
]
const FACULTY_NAMES = ['Dr. Faculty One', 'Dr. Faculty Two', 'Dr. Faculty Three', 'Dr. Faculty Four']

const STUDENTS = STUDENT_NAMES.map((name, i) => ({
  key: `s${i + 1}`,
  role: 'student',
  name,
  email: `s${i + 1}@gmail.com`,
  phone: `90000001${String(i + 1).padStart(2, '0')}`,
  rollNumber: `DERM-S${i + 1}`,
}))
const FACULTY = FACULTY_NAMES.map((name, i) => ({
  key: `f${i + 1}`,
  role: 'faculty',
  name,
  email: `f${i + 1}@gmail.com`,
  phone: `90000002${String(i + 1).padStart(2, '0')}`,
}))

async function findInstitutionId(db) {
  const snap = await getDocs(query(collection(db, 'institutions'), where('name', '==', INSTITUTION_NAME), limit(1)))
  if (snap.empty) throw new Error(`Institution "${INSTITUTION_NAME}" not found — run seedTestInstitution.mjs first.`)
  return snap.docs[0].id
}

async function findDepartmentId(db, institutionId) {
  const snap = await getDocs(
    query(collection(db, 'departments'), where('institutionId', '==', institutionId), where('name', '==', DEPARTMENT_NAME), limit(1)),
  )
  if (snap.empty) throw new Error(`Department "${DEPARTMENT_NAME}" not found in ${INSTITUTION_NAME} — run seedTestInstitution.mjs first.`)
  return { id: snap.docs[0].id, mbbsYear: snap.docs[0].data().mbbsYear }
}

async function findUserByEmail(db, email) {
  const snap = await getDocs(query(collection(db, 'users'), where('email', '==', email), limit(1)))
  return snap.empty ? null : { uid: snap.docs[0].id, ...snap.docs[0].data() }
}

async function createOrGetUser(db, def, institutionId, departmentId, mbbsYear, hodUid) {
  const existing = await findUserByEmail(db, def.email)
  if (existing) {
    console.log(`= already exists: ${def.name} <${def.email}> (${existing.uid})`)
    return existing.uid
  }

  const secondaryApp = initializeApp(firebaseConfig, `seed-extra-${def.key}-${Date.now()}`)
  let uid
  try {
    const secondaryAuth = getAuth(secondaryApp)
    const cred = await createUserWithEmailAndPassword(secondaryAuth, def.email, PASSWORD)
    uid = cred.user.uid
    await signOut(secondaryAuth)
  } finally {
    await deleteApp(secondaryApp)
  }

  const profile = {
    role: def.role,
    name: def.name,
    email: def.email,
    phone: def.phone,
    active: true,
    rejected: false,
    institutionId,
    departmentId,
    mbbsYear: def.role === 'student' ? mbbsYear : null,
    associatedMbbsYears: def.role === 'faculty' ? [mbbsYear] : null,
    rollNumber: def.rollNumber ?? null,
    assignedHOD: def.role === 'student' ? hodUid : null,
  }
  await setDoc(doc(db, 'users', uid), profile)
  console.log(`+ created: ${def.name} <${def.email}> (${uid})`)
  return uid
}

async function main() {
  const email = env.SEED_ADMIN_EMAIL
  const password = env.SEED_ADMIN_PASSWORD
  if (!email || !password) {
    console.error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (your own Primary Admin login) before running.')
    process.exit(1)
  }
  if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
    console.error('Could not read Firebase config from .env — make sure VITE_FIREBASE_* vars are set there.')
    process.exit(1)
  }

  const app = initializeApp(firebaseConfig)
  const mainAuth = getAuth(app)
  const db = getFirestore(app)

  await signInWithEmailAndPassword(mainAuth, email, password)
  console.log(`Signed in as ${email} — project: ${firebaseConfig.projectId}\n`)

  const institutionId = await findInstitutionId(db)
  const { id: departmentId, mbbsYear } = await findDepartmentId(db, institutionId)
  const hod = await findUserByEmail(db, HOD_EMAIL)
  if (!hod) throw new Error(`HOD account <${HOD_EMAIL}> not found — run seedTestInstitution.mjs first.`)

  console.log(`Target: ${DEPARTMENT_NAME} (Year ${mbbsYear}) in ${INSTITUTION_NAME}\n`)

  console.log('Students:')
  for (const def of STUDENTS) {
    await createOrGetUser(db, def, institutionId, departmentId, mbbsYear, hod.uid)
  }

  console.log('\nFaculty:')
  for (const def of FACULTY) {
    await createOrGetUser(db, def, institutionId, departmentId, mbbsYear, hod.uid)
  }

  console.log(`\n=== Done. Password for every account above: ${PASSWORD} ===`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
