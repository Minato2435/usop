import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase'
import type { Department, InstitutionDepartmentOverride, MbbsYear } from '../../types'

const departmentsRef = collection(db, 'departments')

// One department by id — a get, not a list query, so it's readable by
// anyone the department read rule already lets see that doc.
export function watchDepartment(departmentId: string, onChange: (department: Department | null) => void): Unsubscribe {
  return onSnapshot(doc(departmentsRef, departmentId), (snap) => {
    onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as Department) : null)
  })
}

// Primary admin only — lists every department platform-wide (same no-filter
// list-query reasoning as watchInstitutions in institutions.ts).
export function watchAllDepartments(onChange: (departments: Department[]) => void): Unsubscribe {
  return onSnapshot(departmentsRef, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Department))
  })
}

export async function createDepartment(input: Omit<Department, 'id'>): Promise<string> {
  const docRef = await addDoc(departmentsRef, input)
  return docRef.id
}

export async function updateDepartment(
  departmentId: string,
  patch: Partial<Omit<Department, 'id'>>,
): Promise<void> {
  await updateDoc(doc(departmentsRef, departmentId), patch)
}

export async function deleteDepartment(departmentId: string): Promise<void> {
  await deleteDoc(doc(departmentsRef, departmentId))
}

// Non-primary-admin roles (institution admin, etc.) can't run watchAllDepartments
// — the departments read rule depends on institutionId, so an unfiltered
// list query is denied outright. This filters on institutionId == '' (the
// filter the rule's "any active user" branch checks), which is the only
// shape those roles are allowed to query.
export function watchCatalogDepartments(onChange: (departments: Department[]) => void): Unsubscribe {
  const q = query(departmentsRef, where('institutionId', '==', ''))
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Department))
  })
}

export function watchInstitutionDepartments(
  institutionId: string,
  onChange: (departments: Department[]) => void,
): Unsubscribe {
  const q = query(departmentsRef, where('institutionId', '==', institutionId))
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Department))
  })
}

export function watchDepartmentsForYear(
  institutionId: string,
  mbbsYear: MbbsYear,
  onChange: (departments: Department[]) => void,
): Unsubscribe {
  const q = query(
    departmentsRef,
    where('institutionId', '==', institutionId),
    where('mbbsYear', '==', mbbsYear),
  )
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Department))
  })
}

// --- Institution include/exclude toggle for shared-catalog departments ---
// Same absence-means-enabled pattern as institutionTemplateOverrides in
// logTemplates.ts.

const departmentOverridesRef = collection(db, 'institutionDepartmentOverrides')

function departmentOverrideId(institutionId: string, departmentId: string) {
  return `${institutionId}_${departmentId}`
}

export function watchInstitutionDepartmentOverrides(
  institutionId: string,
  onChange: (overrides: InstitutionDepartmentOverride[]) => void,
): Unsubscribe {
  const q = query(departmentOverridesRef, where('institutionId', '==', institutionId))
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as InstitutionDepartmentOverride))
  })
}

// Primary Admin only (its read rule branch doesn't depend on the document):
// every college's department on/off switches at once.
export function watchAllDepartmentOverrides(onChange: (overrides: InstitutionDepartmentOverride[]) => void): Unsubscribe {
  return onSnapshot(departmentOverridesRef, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as InstitutionDepartmentOverride))
  })
}

export async function setDepartmentEnabledForInstitution(
  institutionId: string,
  departmentId: string,
  enabled: boolean,
): Promise<void> {
  await setDoc(doc(departmentOverridesRef, departmentOverrideId(institutionId, departmentId)), {
    institutionId,
    departmentId,
    enabled,
  })
}

// Powers "Include all departments" — since absence of a doc already means
// enabled, resetting to "all included" is just clearing every override.
export async function clearInstitutionDepartmentOverrides(institutionId: string): Promise<void> {
  const q = query(departmentOverridesRef, where('institutionId', '==', institutionId))
  const snap = await getDocs(q)
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)))
}
