// One-off seed script — NOT wired into the app, run manually and then
// forgotten. Reads every DOPS checklist HTML file in "USOP PROGRAM " and,
// for each one, writes:
//   1. its department (once per department, mbbsYear fixed at 1)
//   2. one SSL log template per department (global scope, mbbsYear 1)
//   3. the procedure itself as a leaf node in that template's tree
//   4. a formSchema (the digitized checklist) attached to that leaf via
//      node.formSchemaId
//
// This deliberately reuses the app's existing SSL log-template/tree/
// form-schema data model instead of inventing a parallel "competencies"
// collection — see logTemplates.ts / formSchemas.ts / types/index.ts.
//
// This uses the regular Firebase client SDK (same one the app itself
// uses) signed in as a real Primary Admin account — NOT the Admin SDK, no
// service-account key needed. firestore.rules already gives a signed-in
// primaryAdmin full write access to departments/logTemplates/nodes/
// formSchemas (see firestore.rules — isPrimaryAdmin() gates all of them),
// so this writes exactly the way the app itself would.
//
// SAFETY: there is no emulator in this project — this writes straight to
// production. Re-running this script is safe (it skips anything that
// already exists by name).
//
// Run it yourself, from the repo root:
//   SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD=your-password \
//     node scripts/seedCompetencies.mjs
// Both env vars are read only by this script on your own machine — they
// are never sent anywhere except Firebase's normal sign-in endpoint, the
// same one the app itself uses when you log in through the browser.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initializeApp } from 'firebase/app'
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth'
import { getFirestore, collection, addDoc, query, where, limit, getDocs } from 'firebase/firestore'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HTML_DIR = path.resolve(__dirname, '../USOP PROGRAM ')
const MBBS_YEAR = 1

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

const DEPARTMENT_DESCRIPTIONS = {
  'General Medicine':
    'Diagnostic and procedural skills spanning general internal medicine — injections, infusions, resuscitation, and bedside investigations.',
  Ophthalmology: 'Eye examination and minor ocular procedures, from visual acuity testing to tonometry and ophthalmoscopy.',
  Dermatology: 'Skin-focused diagnostic techniques and minor procedures, including biopsies, smears, and cautery.',
  'General Surgery': 'Core surgical skills — wound care, suturing, bandaging, and management of surgical emergencies.',
  'Forensic Medicine':
    'Medico-legal documentation and certification skills, including age estimation, trauma, and death certification.',
  Pediatrics: 'Procedural skills specific to neonates and children, including resuscitation and pediatric vascular access.',
  Gynecology: 'Gynecological examination and procedural skills, including IUCD insertion and cervical screening.',
  'Otorhinolaryngology (ENT)': 'Ear, nose, and throat examination and minor procedural skills.',
  Orthopedics: 'Musculoskeletal first-aid and immobilization skills, including splinting and bandaging.',
  Obstetrics: 'Skills in normal labor, delivery, and related obstetric procedures.',
}

const SECTION_LABEL = { sectionA: 'Pre-Procedure', sectionB: 'Procedure', sectionC: 'Post-Procedure' }
const RATING_GROUPS = [
  { key: 'comm', label: 'Communication & Empathy' },
  { key: 'asepsis', label: 'Asepsis & Safety' },
  { key: 'technical', label: 'Overall Technical Skill' },
  { key: 'result', label: 'Overall Result' },
]

function decodeEntities(str) {
  return str.replace(/&amp;/g, '&').replace(/&mdash;/g, '—').replace(/&ndash;/g, '–').replace(/&middot;/g, '·')
}

function extractTag(tag, html) {
  const m = html.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`))
  return m ? decodeEntities(m[1].trim()) : null
}

function parseChecklist(html, fileName) {
  const title = extractTag('h1', html)
  const deptMatch = html.match(/Department:\s*([^<]*)<\/span>/)
  const department = deptMatch ? decodeEntities(deptMatch[1].trim()) : null

  const sectionsMatch = html.match(/const SECTIONS = (\{[\s\S]*?\});/)
  if (!sectionsMatch) throw new Error(`No SECTIONS block found in ${fileName}`)
  const jsonish = sectionsMatch[1].replace(/(\bsection[A-Z]\b)\s*:/g, '"$1":')
  const sections = JSON.parse(jsonish)

  const ratings = RATING_GROUPS.map((g) => {
    const segMatch = html.match(new RegExp(`data-group="${g.key}">([\\s\\S]*?)</div>\\s*</div>`))
    const values = [...(segMatch ? segMatch[1] : '').matchAll(/data-val="([^"]*)"/g)].map((m) => decodeEntities(m[1]))
    return { ...g, options: values }
  })

  if (!title || !department) throw new Error(`Missing title/department in ${fileName}`)
  return { title, department, sections, ratings }
}

function buildFields({ sections, ratings }) {
  const fields = []
  let n = 0
  for (const key of ['sectionA', 'sectionB', 'sectionC']) {
    const steps = sections[key] || []
    steps.forEach((text) => {
      n++
      fields.push({
        id: `step-${n}`,
        type: 'dropdown',
        label: `${SECTION_LABEL[key]} — ${text}`,
        required: true,
        options: ['Done', 'Not done', 'N/A'],
        maxRating: null,
      })
      fields.push({
        id: `remark-${n}`,
        type: 'text',
        label: `Remark (optional)`,
        required: false,
        options: null,
        maxRating: null,
      })
    })
  }
  ratings.forEach((r) => {
    fields.push({ id: `rating-${r.key}`, type: 'dropdown', label: r.label, required: true, options: r.options, maxRating: null })
  })
  fields.push({ id: 'feedback', type: 'textarea', label: 'Faculty Feedback', required: false, options: null, maxRating: null })
  fields.push({
    id: 'student-ack',
    type: 'text',
    label: 'Student Acknowledgement (typed name)',
    required: false,
    options: null,
    maxRating: null,
  })
  fields.push({
    id: 'assessor-sign',
    type: 'text',
    label: 'Assessor Signature (typed name)',
    required: false,
    options: null,
    maxRating: null,
  })
  return fields
}

function loadAllChecklists() {
  const files = fs.readdirSync(HTML_DIR).filter((f) => f.endsWith('.html'))
  const seenContent = new Set()
  const checklists = []
  for (const file of files) {
    const full = path.join(HTML_DIR, file)
    const html = fs.readFileSync(full, 'utf8')
    const hash = html.length + ':' + html.slice(0, 200) // cheap de-dupe, good enough for this fixed file set
    if (seenContent.has(hash)) continue
    seenContent.add(hash)
    checklists.push(parseChecklist(html, file))
  }
  return checklists
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
  const auth = getAuth(app)
  const db = getFirestore(app)

  const cred = await signInWithEmailAndPassword(auth, email, password)
  const createdByUid = cred.user.uid
  console.log(`Signed in as ${email} (${createdByUid}) — project: ${firebaseConfig.projectId}\n`)

  const checklists = loadAllChecklists()
  const byDept = new Map()
  for (const c of checklists) {
    if (!byDept.has(c.department)) byDept.set(c.department, [])
    byDept.get(c.department).push(c)
  }

  console.log(`Parsed ${checklists.length} unique procedures across ${byDept.size} departments.\n`)

  const departmentsRef = collection(db, 'departments')
  const logTemplatesRef = collection(db, 'logTemplates')
  const formSchemasRef = collection(db, 'formSchemas')

  for (const [deptName, procedures] of byDept) {
    // 1. Department (skip if one already exists with this name + year)
    const deptQuery = query(
      departmentsRef,
      where('name', '==', deptName),
      where('mbbsYear', '==', MBBS_YEAR),
      where('institutionId', '==', ''),
      limit(1),
    )
    const deptSnap = await getDocs(deptQuery)
    if (deptSnap.empty) {
      await addDoc(departmentsRef, {
        institutionId: '',
        name: deptName,
        mbbsYear: MBBS_YEAR,
        description: DEPARTMENT_DESCRIPTIONS[deptName] || `Procedural competencies for ${deptName}.`,
      })
      console.log(`+ department: ${deptName}`)
    } else {
      console.log(`= department already exists: ${deptName}`)
    }

    // 2. Log template (one per department, skip if one already exists)
    const tplQuery = query(
      logTemplatesRef,
      where('logType', '==', 'SSL'),
      where('scope', '==', 'global'),
      where('institutionId', '==', ''),
      where('department', '==', deptName),
      where('mbbsYear', '==', MBBS_YEAR),
      limit(1),
    )
    const tplSnap = await getDocs(tplQuery)

    let templateId
    if (tplSnap.empty) {
      const tplRef = await addDoc(logTemplatesRef, {
        logType: 'SSL',
        scope: 'global',
        institutionId: '',
        department: deptName,
        mbbsYear: MBBS_YEAR,
        title: `${deptName} — Competency Checklists`,
        createdBy: createdByUid,
        createdAt: Date.now(),
      })
      templateId = tplRef.id
      console.log(`+ log template: ${deptName} (${templateId})`)
    } else {
      templateId = tplSnap.docs[0].id
      console.log(`= log template already exists: ${deptName} (${templateId})`)
    }

    // 3 & 4. Each procedure as a leaf node + its attached form schema
    const nodesRef = collection(db, 'logTemplates', templateId, 'nodes')
    let order = 0
    for (const proc of procedures) {
      const existingQuery = query(nodesRef, where('title', '==', proc.title), limit(1))
      const existing = await getDocs(existingQuery)
      if (!existing.empty) {
        console.log(`  = procedure already exists: ${proc.title}`)
        order++
        continue
      }

      const schemaRef = await addDoc(formSchemasRef, {
        title: proc.title,
        fields: buildFields(proc),
        createdBy: createdByUid,
        createdAt: Date.now(),
      })

      await addDoc(nodesRef, {
        templateId,
        parentId: null,
        title: proc.title,
        order,
        type: 'Checklist',
        required: true,
        formSchemaId: schemaRef.id,
      })
      console.log(`  + procedure: ${proc.title} (checklist ${schemaRef.id})`)
      order++
    }
  }

  console.log('\nDone.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
