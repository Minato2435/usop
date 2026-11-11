// One-off: copy each student's name + register number onto their existing
// activities (Submission.studentName / studentRollNumber). New activities get
// these on every save; this fills in the ones saved before that existed, so
// reviewers still see who logged them after the student is promoted to the
// next year.
//
// Only adds those two fields — nothing else on the activity changes (not even
// updatedAt). Safe to run more than once: activities that already have a name
// are skipped.
//
//   SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… node scripts/backfillSubmissionStudentNames.mjs [--dry-run]

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { getFirestore, collection, doc, getDoc, getDocs, writeBatch } from 'firebase/firestore'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRY = process.argv.includes('--dry-run')

function loadEnvFile() {
  const p = path.join(ROOT, '.env')
  if (!fs.existsSync(p)) return {}
  const out = {}
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
  return out
}
const env = { ...loadEnvFile(), ...process.env }
if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
  console.error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (a Primary Admin login).')
  process.exit(1)
}

const app = initializeApp({
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
})
const auth = getAuth(app)
const db = getFirestore(app)

try {
  await signInWithEmailAndPassword(auth, env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD)
  const subs = await getDocs(collection(db, 'submissions'))
  const missing = subs.docs.filter((d) => !d.data().studentName)
  console.log(`${subs.size} activities, ${missing.length} without a student name.`)

  const students = new Map()
  for (const id of new Set(missing.map((d) => d.data().studentId))) {
    const snap = await getDoc(doc(db, 'users', id))
    students.set(id, snap.exists() ? snap.data() : null)
  }

  let batch = writeBatch(db)
  let inBatch = 0
  let updated = 0
  let skipped = 0
  for (const d of missing) {
    const u = students.get(d.data().studentId)
    if (!u?.name) {
      skipped++
      continue
    }
    if (!DRY) {
      batch.update(d.ref, { studentName: u.name, studentRollNumber: u.rollNumber ?? null })
      if (++inBatch === 450) {
        await batch.commit()
        batch = writeBatch(db)
        inBatch = 0
      }
    }
    updated++
  }
  if (!DRY && inBatch) await batch.commit()
  console.log(`${DRY ? 'Would update' : 'Updated'} ${updated} activities.${skipped ? ` Skipped ${skipped} (student profile not found).` : ''}`)
} finally {
  await signOut(auth).catch(() => {})
  await deleteApp(app)
}
