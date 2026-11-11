import { collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc, where, type Unsubscribe } from 'firebase/firestore'
import { deleteObject, getBlob, getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage'
import { db, storage } from '../firebase'
import type { InstitutionResourceOverride, MbbsYear, Resource, ResourceKind } from '../../types'

// Resources — study material (PDF, Word, PowerPoint, Excel, images). Same
// publishing model and rules shape as videoTutorials.ts: read is a flat
// isActive(), so every query below needs no extra rule branch.

const resourcesRef = collection(db, 'resources')

export const ALL_DEPARTMENTS = ''
export const ALL_YEARS = 0
export const MAX_RESOURCE_BYTES = 50 * 1024 * 1024

// Extension → kind + the content type stored in Storage (the browser's own
// file.type is sometimes empty for Office files, so it's derived here).
const TYPES: Record<string, { kind: ResourceKind; contentType: string }> = {
  pdf: { kind: 'pdf', contentType: 'application/pdf' },
  doc: { kind: 'word', contentType: 'application/msword' },
  docx: { kind: 'word', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  ppt: { kind: 'powerpoint', contentType: 'application/vnd.ms-powerpoint' },
  pptx: { kind: 'powerpoint', contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  xls: { kind: 'excel', contentType: 'application/vnd.ms-excel' },
  xlsx: { kind: 'excel', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  png: { kind: 'image', contentType: 'image/png' },
  jpg: { kind: 'image', contentType: 'image/jpeg' },
  jpeg: { kind: 'image', contentType: 'image/jpeg' },
  webp: { kind: 'image', contentType: 'image/webp' },
}
export const RESOURCE_ACCEPT = Object.keys(TYPES)
  .map((e) => `.${e}`)
  .join(',')
export const RESOURCE_KIND_LABELS: Record<ResourceKind, string> = {
  pdf: 'PDF',
  word: 'Word',
  powerpoint: 'PowerPoint',
  excel: 'Excel',
  image: 'Image',
}

export function resourceFileType(fileName: string): { kind: ResourceKind; contentType: string } | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  return TYPES[ext] ?? null
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function isResourceActive(r: Pick<Resource, 'active'>): boolean {
  return r.active !== false
}

export function resourceReachesDepartment(r: Pick<Resource, 'department'>, departmentNames: string[]): boolean {
  return r.department === ALL_DEPARTMENTS || departmentNames.includes(r.department)
}

const toResource = (id: string, data: Record<string, unknown>) => ({ id, ...data }) as Resource

// Every resource platform-wide — Primary Admin's list, and the Institution
// Admin's (filtered to catalog + their own on the page).
export function watchAllResources(onChange: (resources: Resource[]) => void): Unsubscribe {
  return onSnapshot(resourcesRef, (snap) => onChange(snap.docs.map((d) => toResource(d.id, d.data()))))
}

// A student's resources: catalog + their college's own, for their year or
// for every year. Department and the college's include/exclude switches are
// applied by the caller, which knows the student's departments.
export function watchStudentResources(institutionId: string, mbbsYear: MbbsYear, onChange: (resources: Resource[]) => void): Unsubscribe {
  const q = query(
    resourcesRef,
    where('institutionId', 'in', ['', institutionId]),
    where('audience', '==', 'student'),
    where('mbbsYear', 'in', [ALL_YEARS, mbbsYear]),
  )
  return onSnapshot(q, (snap) => onChange(snap.docs.map((d) => toResource(d.id, d.data())).filter(isResourceActive)))
}

// Faculty/HOD resources — not year-scoped.
export function watchFacultyResources(institutionId: string, onChange: (resources: Resource[]) => void): Unsubscribe {
  const q = query(resourcesRef, where('institutionId', 'in', ['', institutionId]), where('audience', '==', 'faculty'))
  return onSnapshot(q, (snap) => onChange(snap.docs.map((d) => toResource(d.id, d.data())).filter(isResourceActive)))
}

export function watchResource(id: string, onChange: (resource: Resource | null) => void): Unsubscribe {
  return onSnapshot(doc(resourcesRef, id), (snap) => onChange(snap.exists() ? toResource(snap.id, snap.data()) : null))
}

export function newResourceId(): string {
  return doc(resourcesRef).id
}

// Uploads the file under the resource's folder with a unique name, so a
// replacement never overwrites the file the doc still points at.
export async function uploadResourceFile(
  resourceId: string,
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<Pick<Resource, 'url' | 'storagePath' | 'fileName' | 'contentType' | 'size' | 'kind'>> {
  const type = resourceFileType(file.name)
  if (!type) throw new Error('Unsupported file type')
  const safe = file.name.replace(/[^\w.\- ]+/g, '_').slice(-120)
  const path = `resources/${resourceId}/${Date.now()}-${safe}`
  const fileRef = storageRef(storage, path)
  const task = uploadBytesResumable(fileRef, file, { contentType: type.contentType })
  await new Promise<void>((resolve, reject) => {
    task.on('state_changed', (s) => onProgress?.(s.totalBytes ? s.bytesTransferred / s.totalBytes : 0), reject, () => resolve())
  })
  return { url: await getDownloadURL(fileRef), storagePath: path, fileName: file.name, contentType: type.contentType, size: file.size, kind: type.kind }
}

export async function deleteResourceFile(path: string | null | undefined): Promise<void> {
  if (!path) return
  await deleteObject(storageRef(storage, path)).catch(() => {})
}

export async function saveResource(id: string, data: Omit<Resource, 'id'>): Promise<void> {
  await setDoc(doc(resourcesRef, id), data)
}

export async function updateResource(id: string, patch: Partial<Omit<Resource, 'id'>>): Promise<void> {
  await updateDoc(doc(resourcesRef, id), { ...patch, updatedAt: Date.now() })
}

// Doc first, then the file — the doc never points at a missing file.
export async function deleteResourceAndFile(r: Pick<Resource, 'id' | 'storagePath'>): Promise<void> {
  await deleteDoc(doc(resourcesRef, r.id))
  await deleteResourceFile(r.storagePath)
}

// Saves the file under its original name. Falls back to opening it in a new
// tab if the direct download is blocked (e.g. bucket CORS not set).
export async function downloadResource(r: Pick<Resource, 'storagePath' | 'url' | 'fileName'>): Promise<void> {
  try {
    const blob = await getBlob(storageRef(storage, r.storagePath))
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = r.fileName
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
  } catch {
    window.open(r.url, '_blank', 'noopener')
  }
}

// --- A college's include/exclude switch for catalog resources ---------------
// Absent override = included, same as institutionVideoOverrides.

const overridesRef = collection(db, 'institutionResourceOverrides')

export function watchInstitutionResourceOverrides(institutionId: string, onChange: (o: InstitutionResourceOverride[]) => void): Unsubscribe {
  const q = query(overridesRef, where('institutionId', '==', institutionId))
  return onSnapshot(q, (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as InstitutionResourceOverride)))
}

export async function setResourceEnabledForInstitution(institutionId: string, resourceId: string, enabled: boolean): Promise<void> {
  await setDoc(doc(overridesRef, `${institutionId}_${resourceId}`), { institutionId, resourceId, enabled })
}

export function isResourceEnabledFor(overrides: InstitutionResourceOverride[], resourceId: string): boolean {
  const o = overrides.find((x) => x.resourceId === resourceId)
  return o ? o.enabled : true
}
