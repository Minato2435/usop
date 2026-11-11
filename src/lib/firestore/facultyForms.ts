import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase'
import type { FacultyForm, FacultyFormTemplate } from '../../types'

const templatesRef = collection(db, 'facultyFormTemplates')
const formsRef = collection(db, 'facultyForms')

// Primary Admin only — unfiltered list, same no-filter reasoning as
// watchAllDepartments/watchInstitutions (isPrimaryAdmin() doesn't depend
// on resource.data, so Firestore's list-query filter-completeness rule
// doesn't apply).
export function watchAllFormTemplates(onChange: (templates: FacultyFormTemplate[]) => void): Unsubscribe {
  return onSnapshot(templatesRef, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FacultyFormTemplate))
  })
}

// Faculty's own institution — every template turned on for them.
// facultyFormTemplates' read rule is isActive() (not resource.data-
// dependent), so an array-contains query here hits no filter-completeness
// issue the way a resource.data-dependent rule would.
export function watchActiveFormTemplates(institutionId: string, onChange: (templates: FacultyFormTemplate[]) => void): Unsubscribe {
  const q = query(templatesRef, where('enabledInstitutionIds', 'array-contains', institutionId))
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FacultyFormTemplate))
  })
}

export function watchFormTemplate(id: string, onChange: (template: FacultyFormTemplate | null) => void): Unsubscribe {
  return onSnapshot(doc(templatesRef, id), (snap) => {
    onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as FacultyFormTemplate) : null)
  })
}

export async function createFormTemplate(input: Omit<FacultyFormTemplate, 'id' | 'createdAt'>): Promise<string> {
  const ref = await addDoc(templatesRef, { ...input, createdAt: Date.now() })
  return ref.id
}

export async function updateFormTemplate(id: string, patch: Partial<Omit<FacultyFormTemplate, 'id' | 'createdAt'>>): Promise<void> {
  await updateDoc(doc(templatesRef, id), patch)
}

export async function deleteFormTemplate(id: string): Promise<void> {
  await deleteDoc(doc(templatesRef, id))
}

// --- Sent forms (the faculty-initiated path) ---

// Faculty's own "sent" history — their Forms page shows what they've
// already sent, so they're not just sending blind.
export function watchFacultySentForms(facultyId: string, onChange: (forms: FacultyForm[]) => void): Unsubscribe {
  const q = query(formsRef, where('facultyId', '==', facultyId), orderBy('createdAt', 'desc'))
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FacultyForm))
  })
}

// Student's own Forms section — every form a faculty member has sent them.
export function watchStudentForms(studentId: string, onChange: (forms: FacultyForm[]) => void): Unsubscribe {
  const q = query(formsRef, where('studentId', '==', studentId), orderBy('createdAt', 'desc'))
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as FacultyForm))
  })
}

// One-shot by design — sending IS creating the doc, no draft/edit-after-
// send flow in this pass (see the FacultyForm type comment).
export async function createFacultyForm(input: Omit<FacultyForm, 'id' | 'createdAt'>): Promise<string> {
  const ref = await addDoc(formsRef, { ...input, createdAt: Date.now() })
  return ref.id
}
