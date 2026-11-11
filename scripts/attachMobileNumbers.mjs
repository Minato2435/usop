// One-off (safe to repeat): attach every user's saved mobile number to their
// login account, so accounts created before the server functions existed can
// sign in with mobile + OTP. Runs the `adminSyncPhones` server function as the
// Primary Admin and prints what happened.
//
// Needs the functions deployed first (firebase deploy --only functions).
//
//   SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… node scripts/attachMobileNumbers.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { getFunctions, httpsCallable } from 'firebase/functions'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

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

try {
  await signInWithEmailAndPassword(auth, env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD)
  console.log('Attaching mobile numbers to login accounts…')
  const sync = httpsCallable(getFunctions(app, 'asia-south1'), 'adminSyncPhones', { timeout: 540_000 })
  const { data } = await sync({})
  console.log(`\nAttached now:      ${data.attached}`)
  console.log(`Already attached:  ${data.alreadyDone}`)
  console.log(`Couldn't attach:   ${data.problems.length}`)
  for (const p of data.problems) console.log(`  - ${p.user}  ${p.phone ? '+91 ' + p.phone : '(no number)'}  → ${p.reason}`)
  if (data.problems.length) console.log('\nFix those numbers in Users → Edit (each must be a unique 10-digit mobile), then run this again.')
} catch (err) {
  console.error('Failed:', err.code ?? '', err.message)
  process.exitCode = 1
} finally {
  await signOut(auth).catch(() => {})
  await deleteApp(app)
}
