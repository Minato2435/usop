// One-off seed script — NOT wired into the app, run manually. Creates TWO real,
// approved activities for one student to test the PDF export at its limits:
//   1. a normal-length description  + 5 photos + 1 sketch
//   2. a very long description      + 5 photos + 1 sketch
// Real skills from the student's own departments (global + college SSL logs,
// minus switched-off skills, with the effective DOPS form). Created signed in AS
// the student (images uploaded to Storage at the app's own paths), then the
// review (filled DOPS form, feedback, remarks, rating, level) is added with the
// admin login. No rules change needed.
//
// Every doc carries seedTag: 'export-showcase'. Re-running replaces only those.
//
// Run from the repo root on a Mac (photos are converted with `sips`):
//   SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD=your-password \
//     node scripts/seedExportShowcase.mjs
// Options:
//   --email k2@kl.com            the student (default k2@kl.com)
//   --student-password 123456    their password (default 123456)

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, deleteDoc, updateDoc, query, where } from 'firebase/firestore'
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage'
import { renderPhoto, renderSketch } from './lib/demoImages.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SEED_TAG = 'export-showcase'
const DAY = 86_400_000

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback
}
const EMAIL = arg('email', 'k2@kl.com').toLowerCase()
const STUDENT_PASSWORD = arg('student-password', '123456')

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
const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
}

const isoDate = (ms) => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* ---------------------------- descriptions ---------------------------- */

function normalDescription(skill, dept, faculty) {
  return [
    '<h3>What I did</h3>',
    `<p>Performed <strong>${skill}</strong> in the skills lab on a high-fidelity simulation manikin, under the supervision of ${faculty} (${dept}). The scenario was a 62-year-old woman admitted to the ward, conscious and cooperative.</p>`,
    '<h3>Steps followed</h3>',
    '<ol>',
    '<li>Introduced myself, confirmed the identity and explained the procedure before taking verbal consent.</li>',
    '<li>Performed hand hygiene and arranged the equipment tray in the order of use.</li>',
    '<li>Positioned the patient comfortably with adequate exposure, privacy and lighting.</li>',
    '<li>Maintained asepsis throughout and kept a no-touch technique for sterile items.</li>',
    '<li>Documented the findings and handed over to the supervising faculty.</li>',
    '</ol>',
    '<h3>Reflection</h3>',
    '<p>I was more confident than in my previous attempt, especially in the preparation phase. My sequence was smoother because I had rehearsed the steps beforehand.</p>',
    '<p><em>Key learning:</em> a systematic sequence prevents missed steps under time pressure.</p>',
  ].join('')
}

function longDescription(skill, dept, faculty) {
  return [
    '<h2>Case summary</h2>',
    `<p>This entry records my second supervised attempt at <strong>${skill}</strong>, performed during the ${dept} posting under ${faculty}. The session began with a short briefing in which the faculty outlined the learning objectives, the time allowed and the points that would be observed: <em>communication, preparation, asepsis, technique, and documentation</em>. We were reminded that the patient's comfort and safety come before speed.</p>`,
    '<p>The scenario was a 58-year-old man admitted two days earlier with fever and dehydration. He was alert, oriented and anxious about the procedure because a previous attempt elsewhere had been painful. His vital signs were stable: pulse 92/min, blood pressure 118/76 mmHg, SpO2 97% on room air. There was no documented allergy, and he was not on anticoagulants.</p>',
    '<h3>Preparation</h3>',
    '<ul>',
    '<li>Reviewed the case notes, the indication and the most recent investigations before approaching the patient.</li>',
    '<li>Checked the equipment against the checklist and verified the expiry date and integrity of every sterile pack.<ul><li>Laid out the tray in the exact order of use, so that nothing had to be searched for once the procedure started.</li><li>Kept a spare set within reach in case the first attempt was unsuccessful.</li></ul></li>',
    '<li>Ensured privacy with curtains, adequate lighting and a comfortable working height for the bed.</li>',
    '<li>Confirmed that a staff nurse was available to assist if needed.</li>',
    '</ul>',
    '<h3>Communication and consent</h3>',
    '<p>I introduced myself by name and role, confirmed the patient\'s identity using two identifiers, and explained the procedure in simple language, avoiding medical terms. Because he was anxious, I spent extra time describing what he would feel at each step and agreed a signal he could use if he wanted me to pause. He repeated the plan back to me in his own words before giving verbal consent, which reassured both of us that he had understood.</p>',
    '<h3>Procedure, step by step</h3>',
    '<ol>',
    '<li>Performed hand hygiene using the WHO technique and put on gloves.</li>',
    '<li>Positioned the patient with the limb supported on a pillow, and exposed only the area needed.</li>',
    '<li>Identified the landmarks by inspection and palpation, and confirmed them again once the patient was settled.</li>',
    '<li>Cleaned the site with chlorhexidine in alcohol using a back-and-forth motion for 30 seconds, and allowed it to dry completely.</li>',
    '<li>Re-explained the next step and warned the patient before any contact.</li>',
    '<li>Performed the core step of the procedure with a steady, controlled technique, keeping the sterile field intact.</li>',
    '<li>Confirmed success by the expected clinical sign, and checked for any immediate complication.</li>',
    '<li>Secured the site with a sterile transparent dressing and labelled it with the date and time.</li>',
    '<li>Disposed of sharps immediately at the point of use and the rest of the waste in the colour-coded bins.</li>',
    '<li>Removed gloves, performed hand hygiene again and helped the patient back to a comfortable position.</li>',
    '</ol>',
    '<blockquote>"Slow down when you explain the procedure — the patient should be able to repeat it back to you." — feedback from my previous attempt, which I tried to act on today.</blockquote>',
    '<h3>What went well</h3>',
    '<p>My preparation was noticeably better than last time. Because the tray was laid out in order, I never had to turn away from the patient, and the whole procedure took about two minutes less than my first attempt. The patient said afterwards that he felt informed throughout and that it was far less painful than he had expected. The faculty commented that my communication had improved and that the consent conversation was <u>genuinely two-way</u>.</p>',
    '<h3>What I need to improve</h3>',
    '<p><span style="color: rgb(172, 81, 56);">At one point I reached across the sterile field for the dressing, which could have contaminated it.</span> I recognised this myself, discarded the dressing and opened a fresh one, but the faculty pointed out that a better tray layout would have avoided the problem entirely. I also need to verbalise my findings more clearly at the end, in a structured way, instead of reporting them as a list of observations.</p>',
    '<h3>Complications considered</h3>',
    '<ul>',
    '<li><strong>Pain and anxiety</strong> — managed by explanation, an agreed stop signal and a calm pace.</li>',
    '<li><strong>Infection</strong> — strict asepsis, a dated dressing and advice to report redness or fever.</li>',
    '<li><strong>Bleeding or haematoma</strong> — pressure applied, the site inspected before leaving.</li>',
    '<li><strong>Failure of the procedure</strong> — a spare set was ready, and I knew when to stop and call for help.</li>',
    '</ul>',
    '<h3>Reflection</h3>',
    '<p>Looking back, the biggest change from my first attempt was not technical skill but organisation. When the equipment and the explanation were prepared in advance, I had more attention left for the patient and for maintaining asepsis. I also learned that an anxious patient needs more time, not less, and that this time is repaid by a smoother procedure. I want to practise the end-of-procedure summary with a peer before my next attempt, and to rehearse the tray layout so that nothing ever has to cross the sterile field.</p>',
    '<p>I discussed the case afterwards with two classmates who had performed the same skill in other wards. We compared how each of us had obtained consent and agreed that asking the patient to repeat the plan back was the single most useful step for an anxious patient. We also noticed that we all tended to skip the final check of the site before leaving, so we added it to our personal checklists.</p>',
    '<p class="ql-align-center"><u>Key learning:</u> a rehearsed sequence and a well-laid tray free your attention for the patient.</p>',
    '<h3>Plan for the next attempt</h3>',
    '<ol>',
    '<li>Rehearse the tray layout on a dummy tray before the session.</li>',
    '<li>Practise a 30-second structured summary of findings.</li>',
    '<li>Aim to perform the skill under minimal supervision on the ward.</li>',
    '</ol>',
  ].join('')
}

/* ------------------------------ images ------------------------------ */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usop-showcase-'))
function jpeg(kind, seed) {
  const png = path.join(tmpDir, `${kind}-${seed}.png`)
  const jpg = `${png}.jpg`
  fs.writeFileSync(png, renderPhoto(kind, seed))
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82', '-Z', '1200', png, '--out', jpg], { stdio: 'ignore' })
  return fs.readFileSync(jpg)
}
function photosFor(deptName, salt) {
  const n = deptName.toLowerCase()
  const main = /ophthal|eye/.test(n) ? 'fundus' : /derma|skin|venere/.test(n) ? 'dermoscopy' : /surg|ortho|obst|gyn|anaes/.test(n) ? 'suturePad' : /medicine|cardio|physio/.test(n) ? 'ecgPaper' : 'xray'
  const order = [main, ...['xray', 'ecgPaper', 'fundus', 'dermoscopy', 'suturePad'].filter((k) => k !== main)]
  return order.map((k, i) => jpeg(k, 900 + salt * 50 + i * 13))
}
function sketchFor(deptName, salt) {
  const n = deptName.toLowerCase()
  const kind = /ophthal|eye/.test(n) ? 'eye' : /derma|skin/.test(n) ? 'skin' : /surg|ortho|obst|gyn/.test(n) ? 'sutures' : /pulmo|respir|chest/.test(n) ? 'lungs' : /medicine|cardio|physio/.test(n) ? 'ecg' : 'heart'
  return renderSketch(kind, 300 + salt * 11)
}

/* ------------------------------- main ------------------------------- */

async function main() {
  if (!env.SEED_ADMIN_EMAIL || !env.SEED_ADMIN_PASSWORD) {
    console.error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (your Primary Admin login) before running.')
    process.exit(1)
  }
  if (process.platform !== 'darwin') {
    console.error('Run this on a Mac — photos are converted to JPEG with the built-in `sips`.')
    process.exit(1)
  }
  const app = initializeApp(firebaseConfig)
  const db = getFirestore(app)
  await signInWithEmailAndPassword(getAuth(app), env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD)

  const student = (await getDocs(query(collection(db, 'users'), where('email', '==', EMAIL)))).docs.map((d) => ({ uid: d.id, ...d.data() }))[0]
  if (!student || student.role !== 'student') {
    console.error(`No student account with email ${EMAIL}.`)
    process.exit(1)
  }
  console.log(`Student: ${student.name} · ${student.rollNumber ?? ''} · Year ${student.mbbsYear}`)

  // The student's departments (enabled for their college in their year) and skills.
  const collegeId = student.institutionId
  const deptOff = new Set(
    (await getDocs(query(collection(db, 'institutionDepartmentOverrides'), where('institutionId', '==', collegeId)))).docs.map((d) => d.data()).filter((o) => o.enabled === false).map((o) => o.departmentId),
  )
  const depts = (await getDocs(collection(db, 'departments'))).docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => (d.institutionId === '' || d.institutionId === collegeId) && d.mbbsYear === student.mbbsYear && !deptOff.has(d.id))
  const templates = (await getDocs(collection(db, 'logTemplates'))).docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((t) => t.logType === 'SSL' && t.mbbsYear === student.mbbsYear && (t.scope === 'global' || t.institutionId === collegeId))
  const compOff = new Set(
    (await getDocs(query(collection(db, 'institutionCompetencyOverrides'), where('institutionId', '==', collegeId)))).docs.map((d) => d.data()).filter((o) => o.enabled === false).map((o) => o.nodeId),
  )
  const formOverride = new Map((await getDocs(query(collection(db, 'institutionCompetencyFormOverrides'), where('institutionId', '==', collegeId)))).docs.map((d) => [d.data().nodeId, d.data().formSchemaId]))
  const staff = (await getDocs(query(collection(db, 'users'), where('institutionId', '==', collegeId)))).docs.map((d) => ({ uid: d.id, ...d.data() })).filter((u) => u.active !== false)

  const candidates = []
  for (const d of depts) {
    const faculty = staff.filter((u) => u.role === 'faculty' && u.departmentId === d.id)
    if (!faculty.length) continue
    const hod = staff.find((u) => u.role === 'hod' && u.departmentId === d.id) ?? null
    for (const t of templates.filter((t) => t.department === d.name)) {
      const nodes = (await getDocs(collection(db, 'logTemplates', t.id, 'nodes'))).docs.map((x) => ({ id: x.id, ...x.data() }))
      const byId = new Map(nodes.map((n) => [n.id, n]))
      const parents = new Set(nodes.map((n) => n.parentId).filter(Boolean))
      for (const n of nodes) {
        if (parents.has(n.id)) continue
        let on = true
        for (let c = n, g = 0; c && g < 50; c = c.parentId ? byId.get(c.parentId) : null, g++) if (compOff.has(c.id)) on = false
        const formSchemaId = formOverride.get(n.id) ?? n.formSchemaId
        if (on && formSchemaId) candidates.push({ dept: d, template: t, node: n, formSchemaId, faculty: faculty[0], hod })
      }
    }
  }
  if (candidates.length === 0) {
    console.error('This student has no department with a faculty member and an SSL skill that has a DOPS form.')
    process.exit(1)
  }
  // Prefer two different departments; fall back to two skills of one.
  const first = candidates[0]
  const second = candidates.find((c) => c.dept.id !== first.dept.id) ?? candidates.find((c) => c.node.id !== first.node.id) ?? first

  // Sign in as the student (the rules only let a student create their own activities).
  const studentApp = initializeApp(firebaseConfig, `showcase-${Date.now()}`)
  await signInWithEmailAndPassword(getAuth(studentApp), student.email, STUDENT_PASSWORD)
  const sdb = getFirestore(studentApp)
  const sStorage = getStorage(studentApp)

  // Replace any previous showcase activities.
  const old = await getDocs(query(collection(db, 'submissions'), where('studentId', '==', student.uid), where('seedTag', '==', SEED_TAG)))
  for (const d of old.docs) {
    for (const img of d.data().images ?? []) if (img?.path) await deleteObject(storageRef(sStorage, img.path)).catch(() => {})
    await deleteDoc(doc(db, 'submissions', d.id))
  }
  if (old.size) console.log(`Removed ${old.size} earlier showcase activit${old.size === 1 ? 'y' : 'ies'}.`)

  const today0 = new Date(new Date().toDateString()).getTime()
  const plans = [
    { c: first, long: false, daysAgo: 3, byHod: false, label: 'normal description' },
    { c: second, long: true, daysAgo: 1, byHod: !!second.hod, label: 'long description' },
  ]
  for (const [i, p] of plans.entries()) {
    const { c } = p
    const reviewer = p.byHod ? c.hod : c.faculty
    const ref = doc(collection(sdb, 'submissions'))
    const images = []
    const files = [...photosFor(c.dept.name, i).map((b) => ({ b, png: false })), { b: sketchFor(c.dept.name, i), png: true }]
    for (const [k, f] of files.entries()) {
      const id = `${Date.now().toString(36)}${k}${Math.random().toString(36).slice(2, 7)}`
      const p2 = `submissions/${student.uid}/${ref.id}/${id}.${f.png ? 'png' : 'jpg'}`
      const r = storageRef(sStorage, p2)
      await uploadBytes(r, f.b, { contentType: f.png ? 'image/png' : 'image/jpeg', cacheControl: 'public, max-age=31536000, immutable' })
      images.push({ id, kind: f.png ? 'sketch' : 'photo', url: await getDownloadURL(r), path: p2 })
    }
    const activityMs = today0 - p.daysAgo * DAY
    const submittedAt = activityMs + 5 * 3600_000
    const reviewedAt = Math.min(Date.now() - 600_000, submittedAt + 20 * 3600_000)
    const description = p.long ? longDescription(c.node.title, c.dept.name, c.faculty.name) : normalDescription(c.node.title, c.dept.name, c.faculty.name)

    await setDoc(ref, {
      studentId: student.uid,
      institutionId: collegeId,
      departmentId: c.dept.id,
      mbbsYear: student.mbbsYear,
      logType: 'SSL',
      templateId: c.template.id,
      nodeId: c.node.id,
      nodeTitle: c.node.title,
      formSchemaId: c.formSchemaId,
      facultyId: c.faculty.uid,
      status: 'submitted',
      resubmittedAfterRevision: false,
      activityDate: isoDate(activityMs),
      attemptType: p.long ? 'repeat' : 'first',
      answers: {},
      description,
      images,
      facultyFeedback: null,
      facultyRemarks: null,
      facultyRating: null,
      competencyLevel: null,
      reviewedById: null,
      reviewedByName: null,
      reviewedByRole: null,
      submittedAt,
      reviewedAt: null,
      createdAt: activityMs + 3600_000,
      updatedAt: submittedAt,
      seedTag: SEED_TAG,
    })

    // Review outcome (admin login): approved, with the DOPS form filled.
    const fields = (await getDoc(doc(db, 'formSchemas', c.formSchemaId))).data()?.fields ?? []
    const feedback = 'Well-organised approach with good communication throughout. Asepsis was maintained, the patient was kept informed at every step and documentation was complete. Work on the speed of the final steps.'
    const answers = {}
    for (const f of fields) {
      if (/^step-\d+$/.test(f.id)) {
        const done = (f.options ?? []).find((o) => /^done$/i.test(o)) ?? f.options?.[0]
        if (done) answers[f.id] = done
      } else if (f.id.startsWith('rating-')) {
        if (f.type === 'rating') answers[f.id] = String(Math.max(1, (f.maxRating ?? 5) - 1))
        else if (f.options?.length) answers[f.id] = f.options.find((o) => /(satisf|competent|meets|good|above|pass)/i.test(o) && !/(un|not|below|fail)/i.test(o)) ?? f.options[0]
      } else if (f.id === 'feedback') answers[f.id] = feedback
      else if (f.id === 'student-ack') answers[f.id] = student.name
      else if (f.id === 'assessor-sign') answers[f.id] = reviewer.name
    }
    await updateDoc(doc(db, 'submissions', ref.id), {
      status: 'approved',
      answers,
      facultyFeedback: feedback,
      facultyRemarks: 'Ready to perform under minimal supervision on the ward.',
      facultyRating: 4,
      competencyLevel: 'P',
      reviewedById: reviewer.uid,
      reviewedByName: reviewer.name,
      reviewedByRole: p.byHod ? 'hod' : 'faculty',
      reviewedAt,
      updatedAt: reviewedAt,
    })
    console.log(`+ ${isoDate(activityMs)}  ${c.dept.name} · ${c.node.title} — ${p.label}, 5 photos + 1 sketch, approved by ${reviewer.name}${p.byHod ? ' (HOD)' : ''}`)
  }

  await signOut(getAuth(studentApp))
  await deleteApp(studentApp)
  fs.rmSync(tmpDir, { recursive: true, force: true })
  console.log(`\nDone. Sign in as ${student.email} → My Activity → Export activities → Full record → Download PDF.`)
  process.exit(0)
}

main().catch((e) => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  console.error(e)
  process.exit(1)
})
