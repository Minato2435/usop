// One-off seed script — NOT wired into the app, run manually. Adds a batch of
// realistic fake STUDENT accounts to one existing college, spread across
// several of its departments — for testing bulk features (video batches by
// register number, HOD rosters, certificate progress) with real-looking data.
//
// How "department" works for students in this app: a student has no
// department field — they belong to an MBBS year, and every department
// enabled for their college in that year applies to them. So "10 students
// for Dermatology" means 10 students in Dermatology's year. This script picks
// GROUPS departments (Dermatology first if the college has it, then spreading
// across different years where it can) and creates PER students in each
// one's year.
//
//   - finds the college by a case-insensitive partial name (--college)
//   - only uses departments actually switched ON for that college
//   - register numbers: <PREFIX>/Y<year>/<101,102,…> (sequential per year,
//     continuing after any existing ones with that prefix)
//   - emails: short and easy to type — k1@kl.com, k2@kl.com, … (numbering
//     skips any already taken; --email-prefix / --domain to change), password 123456
//   - existing register numbers are skipped, so re-running doesn't duplicate
//
// Run from the repo root. ALWAYS try --plan first (reads only, writes nothing):
//   SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD=your-password \
//     node scripts/seedCollegeStudents.mjs --college "kasipur" --plan
// then the same without --plan to create them. Options:
//   --college "<part of the name>"   (default "kas")
//   --per 10                          students per department (default 10)
//   --groups 5                        how many departments (default 5)
//
// Writes to the live test project in .env (usop-38351 — a throwaway test DB).

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

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback
}
const PLAN_ONLY = process.argv.includes('--plan')
const COLLEGE_QUERY = arg('college', 'kasuburu').toLowerCase()
const PER = Number(arg('per', '10'))
const GROUPS = Number(arg('groups', '5'))
const PASSWORD = '123456'
// Short, easy-to-type test logins: k1@kl.com, k2@kl.com, …
const EMAIL_PREFIX = arg('email-prefix', 'k')
const EMAIL_DOMAIN = arg('domain', 'kl.com')

const env = { ...loadEnvFile(), ...process.env }
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
}

const FIRST = [
  'Aarav', 'Ananya', 'Vihaan', 'Diya', 'Aditya', 'Ishita', 'Arjun', 'Kavya', 'Rohan', 'Meera',
  'Siddharth', 'Priya', 'Karthik', 'Sneha', 'Rahul', 'Pooja', 'Nikhil', 'Aditi', 'Varun', 'Riya',
  'Harsh', 'Tanvi', 'Yash', 'Neha', 'Manav', 'Shreya', 'Kabir', 'Anika', 'Dev', 'Sanya',
  'Aryan', 'Kritika', 'Ishaan', 'Nandini', 'Omkar', 'Pallavi', 'Pranav', 'Radhika', 'Sahil', 'Tara',
  'Uday', 'Vaishnavi', 'Zoya', 'Abhinav', 'Bhavna', 'Chirag', 'Deepika', 'Farhan', 'Gauri', 'Hemant',
  'Irfan', 'Jahnavi', 'Kunal', 'Lavanya', 'Mihir', 'Nisha', 'Parth', 'Ruchi', 'Tejas', 'Vidya',
]
const LAST = [
  'Sharma', 'Verma', 'Reddy', 'Nair', 'Iyer', 'Patel', 'Gupta', 'Rao', 'Menon', 'Kulkarni',
  'Deshmukh', 'Pillai', 'Joshi', 'Mehta', 'Chowdhury', 'Banerjee', 'Singh', 'Khan', 'Das', 'Bose',
]

function collegePrefix(name) {
  const words = name.replace(/[^A-Za-z ]/g, ' ').split(/\s+/).filter((w) => w && !/^(of|and|the|&)$/i.test(w))
  const p = words.map((w) => w[0]).join('').toUpperCase().slice(0, 4)
  return p.length >= 2 ? p : name.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'CLG'
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
  const db = getFirestore(app)
  await signInWithEmailAndPassword(getAuth(app), email, password)
  console.log(`Signed in as ${email} — project: ${firebaseConfig.projectId}${PLAN_ONLY ? '   [PLAN ONLY — nothing will be written]' : ''}\n`)

  // --- College ---------------------------------------------------------------
  const institutions = (await getDocs(collection(db, 'institutions'))).docs.map((d) => ({ id: d.id, ...d.data() }))
  const hits = institutions.filter((i) => (i.name ?? '').toLowerCase().includes(COLLEGE_QUERY))
  if (hits.length !== 1) {
    console.error(hits.length === 0 ? `No college name contains "${COLLEGE_QUERY}".` : `"${COLLEGE_QUERY}" matches more than one college:`)
    for (const i of hits.length ? hits : institutions) console.error(`   - ${i.name}`)
    console.error('\nRe-run with --college "<a more specific part of the name>".')
    process.exit(1)
  }
  const college = hits[0]
  const prefix = collegePrefix(college.name)
  console.log(`College: ${college.name}  (register prefix ${prefix})`)

  // --- Departments switched on for this college ------------------------------
  const allDepts = (await getDocs(collection(db, 'departments'))).docs.map((d) => ({ id: d.id, ...d.data() }))
  const overrides = (await getDocs(query(collection(db, 'institutionDepartmentOverrides'), where('institutionId', '==', college.id)))).docs.map((d) => d.data())
  const off = new Set(overrides.filter((o) => o.enabled === false).map((o) => o.departmentId))
  const enabled = allDepts
    .filter((d) => (d.institutionId === '' || d.institutionId === college.id) && !off.has(d.id) && d.mbbsYear)
    .sort((a, b) => a.mbbsYear - b.mbbsYear || a.name.localeCompare(b.name))
  if (enabled.length === 0) {
    console.error('This college has no departments switched on — enable some first.')
    process.exit(1)
  }
  console.log('Departments switched on:')
  for (const d of enabled) console.log(`   Year ${d.mbbsYear} · ${d.name}${d.institutionId ? ' (college-own)' : ''}`)

  // Pick GROUPS departments: Dermatology first, then one per unused year, then the rest.
  const picks = []
  const derm = enabled.find((d) => /derma/i.test(d.name))
  if (derm) picks.push(derm)
  for (const d of enabled) if (picks.length < GROUPS && !picks.some((p) => p.mbbsYear === d.mbbsYear)) picks.push(d)
  for (const d of enabled) if (picks.length < GROUPS && !picks.includes(d)) picks.push(d)

  // --- Existing users (for idempotency + numbering) --------------------------
  const existing = (await getDocs(query(collection(db, 'users'), where('institutionId', '==', college.id)))).docs.map((d) => d.data())
  // Emails are unique platform-wide (Firebase Auth), so check every account.
  const allUsers = (await getDocs(collection(db, 'users'))).docs.map((d) => d.data())
  const existingEmails = new Set(allUsers.map((u) => (u.email ?? '').toLowerCase()))
  const existingRolls = new Set(existing.map((u) => u.rollNumber).filter(Boolean))
  const nextSeq = {}
  for (const y of [1, 2, 3, 4]) {
    const used = existing
      .map((u) => u.rollNumber ?? '')
      .filter((r) => r.startsWith(`${prefix}/Y${y}/`))
      .map((r) => Number(r.split('/').pop()))
      .filter((n) => !Number.isNaN(n))
    nextSeq[y] = used.length ? Math.max(...used) + 1 : 101
  }

  // --- Plan ------------------------------------------------------------------
  const plan = []
  let nameIdx = 0
  let emailNo = 1
  const nextEmail = () => {
    while (existingEmails.has(`${EMAIL_PREFIX}${emailNo}@${EMAIL_DOMAIN}`)) emailNo++
    return `${EMAIL_PREFIX}${emailNo++}@${EMAIL_DOMAIN}`
  }
  for (const d of picks) {
    for (let k = 0; k < PER; k++) {
      const y = d.mbbsYear
      const seq = nextSeq[y]++
      const first = FIRST[nameIdx % FIRST.length]
      const last = LAST[(nameIdx * 7 + 3) % LAST.length]
      nameIdx++
      const roll = `${prefix}/Y${y}/${String(seq).padStart(4, '0')}`
      plan.push({
        group: d.name,
        name: `${first} ${last}`,
        email: nextEmail(),
        phone: `9${String(800000000 + y * 10000000 + seq).slice(-9)}`,
        rollNumber: roll,
        mbbsYear: y,
      })
    }
  }

  console.log(`\nPlan — ${plan.length} students (${PER} per department):`)
  const yearsUsed = {}
  for (const d of picks) yearsUsed[d.mbbsYear] = [...(yearsUsed[d.mbbsYear] ?? []), d.name]
  for (const d of picks) {
    const rows = plan.filter((p) => p.group === d.name)
    console.log(`   ${d.name} · Year ${d.mbbsYear}: ${rows.length} students  ${rows[0].rollNumber} … ${rows[rows.length - 1].rollNumber}`)
  }
  for (const [y, names] of Object.entries(yearsUsed)) {
    const all = enabled.filter((d) => d.mbbsYear === Number(y)).map((d) => d.name)
    if (all.length > 1)
      console.log(`   note: every Year ${y} student here also has ${all.filter((n) => !names.includes(n)).join(', ') || 'the other picked'} department(s) — students belong to a year, not one department.`)
  }

  if (PLAN_ONLY) {
    console.log('\nPlan only — nothing written. Re-run without --plan to create these accounts.')
    process.exit(0)
  }

  // --- Create ----------------------------------------------------------------
  let created = 0
  let skipped = 0
  for (const s of plan) {
    if (existingRolls.has(s.rollNumber)) {
      skipped++
      continue
    }
    const secondary = initializeApp(firebaseConfig, `seed-college-${Date.now()}-${created}`)
    let uid
    try {
      const auth2 = getAuth(secondary)
      const cred = await createUserWithEmailAndPassword(auth2, s.email, PASSWORD)
      uid = cred.user.uid
      await signOut(auth2)
    } catch (e) {
      console.log(`! ${s.email}: ${e.code ?? e.message} — skipped`)
      skipped++
      continue
    } finally {
      await deleteApp(secondary)
    }
    await setDoc(doc(db, 'users', uid), {
      role: 'student',
      name: s.name,
      email: s.email,
      phone: s.phone,
      active: true,
      rejected: false,
      institutionId: college.id,
      departmentId: null,
      mbbsYear: s.mbbsYear,
      associatedMbbsYears: null,
      rollNumber: s.rollNumber,
      assignedHOD: null,
    })
    created++
    console.log(`+ ${s.rollNumber}  ${s.name.padEnd(22)} ${s.email}`)
  }
  console.log(`\nDone — ${created} created, ${skipped} skipped. Password for every new account: ${PASSWORD}`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
