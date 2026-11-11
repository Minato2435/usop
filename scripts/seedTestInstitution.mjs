// One-off seed script — NOT wired into the app, run manually. Builds a
// complete, self-contained test institution so the full Student → Faculty
// → HOD → Principal review loop can be exercised end-to-end without
// manually creating accounts/templates/submissions by hand through the UI:
//
//   1. an Institution ("USOP Test Institution")
//   2. one Department scoped to that institution ("Dermatology", Year 2)
//   3. one SSL log template for that department, with one leaf procedure
//      ("Skin Biopsy") carrying a real DOPS-style checklist (FormSchema)
//   4. 8 user accounts: 1 Principal, 1 HOD, 2 Faculty, 4 Students
//   5. 4 Submissions from different students, left in different states on
//      purpose — see submissionPlan() below — so every piece of the
//      student→faculty→HOD→principal pipeline has something to look at
//      immediately:
//        - one still 'submitted' (pending), sent to a faculty member — for
//          you to test Fill DOPS Form yourself, as that faculty
//        - one 'submitted' sent to a faculty member but then approved by
//          the HOD instead — proves HOD's department-wide oversight
//          (reviewing something not assigned to them personally)
//        - one fully 'approved' by its own assigned faculty, checklist +
//          feedback + rating + competency level all filled in
//        - one sent back 'revisionRequested' by its own assigned faculty,
//          with partial checklist marks and feedback explaining what to
//          redo — for you to test resuming/resubmitting as that student
//
// This uses the regular Firebase client SDK (same one the app itself
// uses) signed in as a real Primary Admin account for the
// institution/department/template/user-creation steps, then signs in as
// each individual student/faculty/HOD account in turn (same email+
// password this script just created for them) to create/decide on their
// own submissions — exactly the identity each of those Firestore writes
// actually requires under firestore.rules, the same way the real app
// would. New Auth accounts are created on a throwaway secondary Firebase
// App instance (same technique createUserAccount() in
// src/lib/firestore/users.ts uses) so your own primary-admin session
// signed into this script is never disturbed.
//
// Idempotent: re-running this is safe. Every step checks for an existing
// doc (by name/email/title) before creating one, so you can re-run after
// fixing a typo without creating duplicates. It does NOT delete anything.
//
// SAFETY: there is no emulator in this project — this writes straight to
// the live Firebase project this repo's .env points at (usop-38351, a
// temp test database per project memory — not a project with real data).
//
// Run it yourself, from the repo root:
//   SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD=your-password \
//     node scripts/seedTestInstitution.mjs
// Both env vars are read only by this script on your own machine — they
// are never sent anywhere except Firebase's normal sign-in endpoint, the
// same one the app itself uses when you log in through the browser.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth'
import { getFirestore, collection, doc, addDoc, setDoc, updateDoc, getDocs, query, where, limit } from 'firebase/firestore'

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

const INSTITUTION = { name: 'USOP Test Institution', state: 'Delhi', city: 'New Delhi', type: 'Government Medical College', establishedYear: 2020 }
const DEPARTMENT_NAME = 'Dermatology'
const MBBS_YEAR = 2
const PROCEDURE_TITLE = 'Skin Biopsy'
const TEST_PASSWORD = 'TestPass123!'
const TODAY = new Date().toISOString().slice(0, 10)

const USERS = [
  { key: 'principal', role: 'principal', name: 'Dr. Priya Nair', email: 'principal.test@usoptest.local', phone: '9000000001' },
  { key: 'hod', role: 'hod', name: 'Dr. Arjun Mehta', email: 'hod.test@usoptest.local', phone: '9000000002' },
  { key: 'faculty1', role: 'faculty', name: 'Dr. Kavya Iyer', email: 'faculty1.test@usoptest.local', phone: '9000000003' },
  { key: 'faculty2', role: 'faculty', name: 'Dr. Rohan Das', email: 'faculty2.test@usoptest.local', phone: '9000000004' },
  { key: 'student1', role: 'student', name: 'Ananya Verma', email: 'student1.test@usoptest.local', phone: '9000000005', rollNumber: 'TEST-STU-001' },
  { key: 'student2', role: 'student', name: 'Vikram Rao', email: 'student2.test@usoptest.local', phone: '9000000006', rollNumber: 'TEST-STU-002' },
  { key: 'student3', role: 'student', name: 'Sneha Kulkarni', email: 'student3.test@usoptest.local', phone: '9000000007', rollNumber: 'TEST-STU-003' },
  { key: 'student4', role: 'student', name: 'Rahul Singh', email: 'student4.test@usoptest.local', phone: '9000000008', rollNumber: 'TEST-STU-004' },
]

// Same DOPS field-building convention DopsChecklistPreview.tsx's parseDops()
// expects — step-N/remark-N pairs grouped by a "Section — text" label,
// rating-result for the global outcome, feedback + the two signature ids.
function buildDopsFields() {
  return [
    { id: 'step-1', type: 'dropdown', label: 'Pre-Procedure — Confirms indication and obtains consent', required: true, options: ['Done', 'Not done', 'N/A'], maxRating: null },
    { id: 'remark-1', type: 'text', label: 'Remark (optional)', required: false, options: null, maxRating: null },
    { id: 'step-2', type: 'dropdown', label: 'Procedure — Cleans site and performs biopsy without complication', required: true, options: ['Done', 'Not done', 'N/A'], maxRating: null },
    { id: 'remark-2', type: 'text', label: 'Remark (optional)', required: false, options: null, maxRating: null },
    { id: 'rating-result', type: 'dropdown', label: 'Overall Result', required: true, options: ['Satisfactory', 'Not Satisfactory'], maxRating: null },
    { id: 'feedback', type: 'textarea', label: 'Faculty Feedback', required: false, options: null, maxRating: null },
    { id: 'student-ack', type: 'text', label: 'Student Acknowledgement (typed name)', required: false, options: null, maxRating: null },
    { id: 'assessor-sign', type: 'text', label: 'Assessor Signature (typed name)', required: false, options: null, maxRating: null },
  ]
}

async function findOrCreateInstitution(db) {
  const ref = collection(db, 'institutions')
  const snap = await getDocs(query(ref, where('name', '==', INSTITUTION.name), limit(1)))
  if (!snap.empty) {
    console.log(`= institution already exists: ${INSTITUTION.name} (${snap.docs[0].id})`)
    return snap.docs[0].id
  }
  const created = await addDoc(ref, { ...INSTITUTION, createdAt: Date.now() })
  console.log(`+ institution: ${INSTITUTION.name} (${created.id})`)
  return created.id
}

async function findOrCreateDepartment(db, institutionId) {
  const ref = collection(db, 'departments')
  const snap = await getDocs(
    query(ref, where('institutionId', '==', institutionId), where('name', '==', DEPARTMENT_NAME), where('mbbsYear', '==', MBBS_YEAR), limit(1)),
  )
  if (!snap.empty) {
    console.log(`= department already exists: ${DEPARTMENT_NAME} (${snap.docs[0].id})`)
    return snap.docs[0].id
  }
  const created = await addDoc(ref, {
    institutionId,
    name: DEPARTMENT_NAME,
    mbbsYear: MBBS_YEAR,
    description: 'Skin-focused diagnostic techniques and minor procedures — test department for the review pipeline.',
  })
  console.log(`+ department: ${DEPARTMENT_NAME} (${created.id})`)
  return created.id
}

async function findOrCreateTemplate(db, institutionId, createdByUid) {
  const ref = collection(db, 'logTemplates')
  const snap = await getDocs(
    query(ref, where('institutionId', '==', institutionId), where('department', '==', DEPARTMENT_NAME), where('mbbsYear', '==', MBBS_YEAR), where('logType', '==', 'SSL'), limit(1)),
  )
  if (!snap.empty) {
    console.log(`= log template already exists (${snap.docs[0].id})`)
    return snap.docs[0].id
  }
  const created = await addDoc(ref, {
    logType: 'SSL',
    scope: 'institution',
    institutionId,
    department: DEPARTMENT_NAME,
    mbbsYear: MBBS_YEAR,
    title: `${DEPARTMENT_NAME} — Test Skills`,
    createdBy: createdByUid,
    createdAt: Date.now(),
  })
  console.log(`+ log template (${created.id})`)
  return created.id
}

async function findOrCreateLeaf(db, templateId, createdByUid) {
  const nodesRef = collection(db, 'logTemplates', templateId, 'nodes')
  const existing = await getDocs(query(nodesRef, where('title', '==', PROCEDURE_TITLE), limit(1)))
  if (!existing.empty) {
    const node = existing.docs[0]
    console.log(`= procedure already exists: ${PROCEDURE_TITLE} (node ${node.id}, schema ${node.data().formSchemaId})`)
    return { nodeId: node.id, formSchemaId: node.data().formSchemaId }
  }
  const schemaRef = await addDoc(collection(db, 'formSchemas'), {
    title: PROCEDURE_TITLE,
    fields: buildDopsFields(),
    createdBy: createdByUid,
    createdAt: Date.now(),
    code: 'TEST-001',
    setting: 'Skills Lab — Suturing Pad/Task Trainer',
    level: 'P',
    domains: ['Psychomotor'],
  })
  const nodeRef = await addDoc(nodesRef, {
    templateId,
    parentId: null,
    title: PROCEDURE_TITLE,
    order: 0,
    type: 'Checklist',
    required: true,
    formSchemaId: schemaRef.id,
  })
  console.log(`+ procedure: ${PROCEDURE_TITLE} (node ${nodeRef.id}, schema ${schemaRef.id})`)
  return { nodeId: nodeRef.id, formSchemaId: schemaRef.id }
}

async function findUserByEmail(db, email) {
  const snap = await getDocs(query(collection(db, 'users'), where('email', '==', email), limit(1)))
  return snap.empty ? null : { uid: snap.docs[0].id, ...snap.docs[0].data() }
}

async function createOrGetUser(db, def, institutionId, departmentId, hodUid) {
  const existing = await findUserByEmail(db, def.email)
  if (existing) {
    console.log(`= user already exists: ${def.name} <${def.email}> (${existing.uid})`)
    return existing.uid
  }

  const secondaryApp = initializeApp(firebaseConfig, `seed-${def.key}-${Date.now()}`)
  let uid
  try {
    const secondaryAuth = getAuth(secondaryApp)
    const cred = await createUserWithEmailAndPassword(secondaryAuth, def.email, TEST_PASSWORD)
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
    departmentId: def.role === 'principal' ? null : departmentId,
    mbbsYear: def.role === 'student' ? MBBS_YEAR : null,
    associatedMbbsYears: def.role === 'faculty' ? [MBBS_YEAR] : null,
    rollNumber: def.rollNumber ?? null,
    assignedHOD: def.role === 'student' ? hodUid : null,
  }
  await setDoc(doc(db, 'users', uid), profile)
  console.log(`+ user: ${def.name} <${def.email}> (${uid})`)
  return uid
}

// The 4 submissions, each left in a different state — see the header
// comment for what each one demonstrates.
function submissionPlan({ studentUids, facultyUids, hodUid, institutionId, departmentId, nodeId, nodeTitle, formSchemaId }) {
  return [
    {
      studentKey: 'student1',
      studentUid: studentUids.student1,
      facultyUid: facultyUids.faculty1,
      description: '<p>Performed a punch biopsy on a suspected basal cell carcinoma, left cheek. Specimen sent for histopathology.</p>',
      finalAction: null, // left 'submitted' — try Fill DOPS Form yourself as faculty1
    },
    {
      studentKey: 'student2',
      studentUid: studentUids.student2,
      facultyUid: facultyUids.faculty2,
      description: '<p>Shave biopsy of a pigmented lesion, upper back, for histological confirmation.</p>',
      finalAction: { by: 'hod', decision: 'approved' }, // decided by HOD, not the assigned faculty — proves department-wide oversight
    },
    {
      studentKey: 'student3',
      studentUid: studentUids.student3,
      facultyUid: facultyUids.faculty1,
      description: '<p>Excisional biopsy of a dermatofibroma, forearm, closed with interrupted sutures.</p>',
      finalAction: { by: 'faculty1', decision: 'approved' },
    },
    {
      studentKey: 'student4',
      studentUid: studentUids.student4,
      facultyUid: facultyUids.faculty2,
      description: '<p>Punch biopsy attempted on a suspicious nodule, scalp. Site prep was rushed due to patient discomfort.</p>',
      finalAction: { by: 'faculty2', decision: 'revisionRequested' },
    },
  ].map((s) => ({
    ...s,
    institutionId,
    departmentId,
    mbbsYear: MBBS_YEAR,
    nodeId,
    nodeTitle,
    formSchemaId,
    hodUid,
  }))
}

async function createSubmissionAsStudent(mainAuth, db, plan, templateId) {
  await signInWithEmailAndPassword(mainAuth, USERS.find((u) => u.key === plan.studentKey).email, TEST_PASSWORD)
  const existing = await getDocs(query(collection(db, 'submissions'), where('studentId', '==', plan.studentUid), where('nodeId', '==', plan.nodeId), limit(1)))
  if (!existing.empty) {
    console.log(`  = submission already exists for ${plan.studentKey} (${existing.docs[0].id})`)
    return existing.docs[0].id
  }
  const now = Date.now()
  const ref = await addDoc(collection(db, 'submissions'), {
    studentId: plan.studentUid,
    institutionId: plan.institutionId,
    departmentId: plan.departmentId,
    mbbsYear: plan.mbbsYear,
    logType: 'SSL',
    templateId,
    nodeId: plan.nodeId,
    nodeTitle: plan.nodeTitle,
    formSchemaId: plan.formSchemaId,
    facultyId: plan.facultyUid,
    status: 'submitted',
    activityDate: TODAY,
    attemptType: 'first',
    answers: {},
    description: plan.description,
    images: [],
    facultyFeedback: null,
    facultyRemarks: null,
    facultyRating: null,
    competencyLevel: null,
    submittedAt: now,
    reviewedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  console.log(`  + submission for ${plan.studentKey} → faculty ${plan.facultyUid} (${ref.id})`)
  return ref.id
}

async function decideSubmission(mainAuth, db, plan, submissionId, reviewerEmail, studentName, reviewerName) {
  await signInWithEmailAndPassword(mainAuth, reviewerEmail, TEST_PASSWORD)
  const decision = plan.finalAction.decision
  const isGoodReview = decision === 'approved'
  await updateDoc(doc(db, 'submissions', submissionId), {
    status: decision,
    answers: {
      'step-1': isGoodReview ? 'Done' : 'Not done',
      'remark-1': isGoodReview ? '' : 'Site preparation was rushed — redo with full antiseptic prep and adequate local anaesthesia.',
      'step-2': 'Done',
      'remark-2': '',
      'rating-result': isGoodReview ? 'Satisfactory' : '',
      feedback: isGoodReview
        ? 'Good technique, maintained asepsis throughout. Specimen handling was appropriate.'
        : 'Please redo the pre-procedure prep step and resubmit — see remark on step 1.',
      'student-ack': studentName,
      'assessor-sign': reviewerName,
    },
    facultyFeedback: isGoodReview ? 'Good technique, maintained asepsis throughout.' : 'Please redo the pre-procedure prep step and resubmit.',
    facultyRemarks: isGoodReview ? null : 'Site prep inadequate — see checklist remark.',
    facultyRating: isGoodReview ? 4 : 2,
    competencyLevel: isGoodReview ? 'P' : 'A',
    reviewedAt: Date.now(),
    updatedAt: Date.now(),
  })
  console.log(`  ${decision === 'approved' ? '✓' : '↩'} ${plan.studentKey}'s submission ${decision} by ${reviewerEmail}`)
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

  const adminCred = await signInWithEmailAndPassword(mainAuth, email, password)
  const createdByUid = adminCred.user.uid
  console.log(`Signed in as ${email} (${createdByUid}) — project: ${firebaseConfig.projectId}\n`)

  const institutionId = await findOrCreateInstitution(db)
  const departmentId = await findOrCreateDepartment(db, institutionId)
  const templateId = await findOrCreateTemplate(db, institutionId, createdByUid)
  const { nodeId, formSchemaId } = await findOrCreateLeaf(db, templateId, createdByUid)

  console.log('')
  // HOD must exist before students (assignedHOD points at the HOD's uid),
  // so create in this fixed order rather than Promise.all.
  const uids = {}
  for (const def of USERS) {
    uids[def.key] = await createOrGetUser(db, def, institutionId, departmentId, uids.hod)
  }

  console.log('\nCreating submissions (signing in as each student/reviewer in turn)...')
  const plans = submissionPlan({
    studentUids: { student1: uids.student1, student2: uids.student2, student3: uids.student3, student4: uids.student4 },
    facultyUids: { faculty1: uids.faculty1, faculty2: uids.faculty2 },
    hodUid: uids.hod,
    institutionId,
    departmentId,
    nodeId,
    nodeTitle: PROCEDURE_TITLE,
    formSchemaId,
  })

  const reviewerEmail = { faculty1: USERS.find((u) => u.key === 'faculty1').email, faculty2: USERS.find((u) => u.key === 'faculty2').email, hod: USERS.find((u) => u.key === 'hod').email }
  const reviewerName = { faculty1: USERS.find((u) => u.key === 'faculty1').name, faculty2: USERS.find((u) => u.key === 'faculty2').name, hod: USERS.find((u) => u.key === 'hod').name }

  for (const plan of plans) {
    const submissionId = await createSubmissionAsStudent(mainAuth, db, plan, templateId)
    if (plan.finalAction) {
      const studentName = USERS.find((u) => u.key === plan.studentKey).name
      await decideSubmission(mainAuth, db, plan, submissionId, reviewerEmail[plan.finalAction.by], studentName, reviewerName[plan.finalAction.by])
    }
  }

  // Leave the script's own session back on the admin account, not some
  // test student, in case anything runs after main().
  await signInWithEmailAndPassword(mainAuth, email, password)

  console.log('\n=== Test accounts (all share one password) ===')
  console.log(`Password for every account below: ${TEST_PASSWORD}\n`)
  for (const def of USERS) {
    console.log(`${def.role.padEnd(12)} ${def.email.padEnd(32)} ${def.name}`)
  }
  console.log('\nDone. Sign in at /login with any of the emails above.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
