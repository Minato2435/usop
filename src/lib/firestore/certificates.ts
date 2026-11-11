import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, query, setDoc, updateDoc, where, type Unsubscribe } from 'firebase/firestore'
import { db } from '../firebase'
import type { CertificateDecision, CertificateRequest, CertificateRequestStatus, CertificateSkillPreset, MbbsYear, Submission } from '../../types'

const presetsRef = collection(db, 'certificateSkillPresets')
const requestsRef = collection(db, 'certificateRequests')

// Looks up this institution's own exclusive preset first, falling back to
// the global (institutionId === '') one if the institution has none of its
// own for this department+year — same global-vs-institution-exclusive
// combine pattern ActivitiesPage.tsx already uses for departments
// (watchCatalogDepartments + watchInstitutionDepartments). Two parallel
// listeners rather than one combined query, since a list query can only
// filter on fields the rule reads uniformly — institutionId differs
// between the two lookups by design.
export function watchCertificateSkillPreset(
  institutionId: string,
  department: string,
  mbbsYear: MbbsYear,
  onChange: (preset: CertificateSkillPreset | null) => void,
): Unsubscribe {
  let ownPreset: CertificateSkillPreset | null = null
  let globalPreset: CertificateSkillPreset | null = null
  let ownLoaded = !institutionId
  let globalLoaded = false

  function emit() {
    if (!ownLoaded || !globalLoaded) return
    // An empty college preset is no override at all — fall back to global.
    onChange(ownPreset && ownPreset.requiredSkills.length > 0 ? ownPreset : globalPreset)
  }

  const unsubOwn = institutionId
    ? onSnapshot(
        query(presetsRef, where('institutionId', '==', institutionId), where('department', '==', department), where('mbbsYear', '==', mbbsYear)),
        (snap) => {
          ownPreset = snap.empty ? null : ({ id: snap.docs[0].id, ...snap.docs[0].data() } as CertificateSkillPreset)
          ownLoaded = true
          emit()
        },
      )
    : () => {}

  const unsubGlobal = onSnapshot(
    query(presetsRef, where('institutionId', '==', ''), where('department', '==', department), where('mbbsYear', '==', mbbsYear)),
    (snap) => {
      globalPreset = snap.empty ? null : ({ id: snap.docs[0].id, ...snap.docs[0].data() } as CertificateSkillPreset)
      globalLoaded = true
      emit()
    },
  )

  return () => {
    unsubOwn()
    unsubGlobal()
  }
}

// Primary Admin's authoring page — every preset platform-wide, unfiltered.
export function watchAllCertificateSkillPresets(onChange: (presets: CertificateSkillPreset[]) => void): Unsubscribe {
  return onSnapshot(presetsRef, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CertificateSkillPreset))
  })
}

// Finds the existing preset for this exact (institutionId, department,
// mbbsYear) triple, or creates an empty one — same "find or create"
// convenience as getOrCreateGlobalSslTemplate in logTemplates.ts.
export async function getOrCreateCertificateSkillPreset(
  institutionId: string,
  department: string,
  mbbsYear: MbbsYear,
  createdBy: string,
): Promise<string> {
  const q = query(presetsRef, where('institutionId', '==', institutionId), where('department', '==', department), where('mbbsYear', '==', mbbsYear))
  const snap = await getDocs(q)
  if (!snap.empty) return snap.docs[0].id
  const docRef = await addDoc(presetsRef, {
    institutionId,
    department,
    mbbsYear,
    requiredSkills: [],
    createdBy,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })
  return docRef.id
}

export async function updateCertificateSkillPreset(presetId: string, requiredSkills: CertificateSkillPreset['requiredSkills']): Promise<void> {
  await updateDoc(doc(presetsRef, presetId), { requiredSkills, updatedAt: Date.now() })
}

// Removes a college override so that college falls back to the global preset.
export async function deleteCertificateSkillPreset(presetId: string): Promise<void> {
  await deleteDoc(doc(presetsRef, presetId))
}

// A student can be assigned several departments at once and independently
// qualify for a certificate per department, so a request is keyed by
// (student, department), not student alone.
function certificateRequestId(studentId: string, departmentId: string): string {
  return `${studentId}_${departmentId}`
}

// A student's own certificate request for one specific department — a
// plain get()-by-id watch, unaffected by the list-query-filter-
// completeness gotcha entirely since it's never a query.
export function watchMyCertificateRequest(
  studentId: string,
  departmentId: string,
  onChange: (request: CertificateRequest | null) => void,
): Unsubscribe {
  return onSnapshot(doc(requestsRef, certificateRequestId(studentId, departmentId)), (snap) => {
    onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as CertificateRequest) : null)
  })
}

// Used by the review pages, which already have one specific request's own
// doc id (from the Requests list, which links via each row's own `id`) —
// not a separate studentId+departmentId pair to reconstruct it from.
export function watchCertificateRequest(requestId: string, onChange: (request: CertificateRequest | null) => void): Unsubscribe {
  return onSnapshot(doc(requestsRef, requestId), (snap) => {
    onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as CertificateRequest) : null)
  })
}

// Both approvers' queue — every request platform-wide, unfiltered (their
// read rule branches are plain role checks, no resource.data dependency,
// same as watchUsers()/watchAllVideoBatches() today).
export function watchAllCertificateRequests(onChange: (requests: CertificateRequest[]) => void): Unsubscribe {
  return onSnapshot(requestsRef, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as CertificateRequest))
  })
}

export async function createCertificateRequest(input: {
  studentId: string
  institutionId: string
  departmentId: string
  department: string
  mbbsYear: MbbsYear
  presetId: string
  requiredSkills: CertificateSkillPreset['requiredSkills']
}): Promise<void> {
  const now = Date.now()
  await setDoc(doc(requestsRef, certificateRequestId(input.studentId, input.departmentId)), {
    ...input,
    skillLabDirectorDecision: 'pending',
    skillLabDirectorBy: null,
    skillLabDirectorAt: null,
    skillLabDirectorRemarks: null,
    skillLabDirectorName: null,
    primaryAdminDecision: 'pending',
    primaryAdminBy: null,
    primaryAdminAt: null,
    primaryAdminRemarks: null,
    primaryAdminName: null,
    requestedAt: now,
    updatedAt: now,
  })
}

// A rejection by either approver doesn't end the student's story — this
// resets BOTH decisions back to 'pending' on the same document (confirmed
// with the user: a fresh dual review every time, not "keep the surviving
// approval"), same single-evolving-document shape Submission's own
// revision-request/resubmit cycle already uses.
export async function resubmitCertificateRequest(studentId: string, departmentId: string): Promise<void> {
  const now = Date.now()
  await updateDoc(doc(requestsRef, certificateRequestId(studentId, departmentId)), {
    skillLabDirectorDecision: 'pending',
    skillLabDirectorBy: null,
    skillLabDirectorAt: null,
    skillLabDirectorRemarks: null,
    skillLabDirectorName: null,
    primaryAdminDecision: 'pending',
    primaryAdminBy: null,
    primaryAdminAt: null,
    primaryAdminRemarks: null,
    primaryAdminName: null,
    requestedAt: now,
    updatedAt: now,
  })
}

export async function recordSkillLabDirectorDecision(
  requestId: string,
  decision: Exclude<CertificateDecision, 'pending'>,
  remarks: string | null,
  byUid: string,
  byName: string | null = null,
): Promise<void> {
  await updateDoc(doc(requestsRef, requestId), {
    skillLabDirectorDecision: decision,
    skillLabDirectorBy: byUid,
    skillLabDirectorName: byName,
    skillLabDirectorAt: Date.now(),
    skillLabDirectorRemarks: remarks,
    updatedAt: Date.now(),
  })
}

export async function recordPrimaryAdminDecision(
  requestId: string,
  decision: Exclude<CertificateDecision, 'pending'>,
  remarks: string | null,
  byUid: string,
  byName: string | null = null,
): Promise<void> {
  await updateDoc(doc(requestsRef, requestId), {
    primaryAdminDecision: decision,
    primaryAdminBy: byUid,
    primaryAdminName: byName,
    primaryAdminAt: Date.now(),
    primaryAdminRemarks: remarks,
    updatedAt: Date.now(),
  })
}

// A stable, human-readable certificate number derived from the request id
// and issue year — nothing extra stored.
export function certificateNumber(req: CertificateRequest): string {
  let h = 0
  for (const ch of req.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const issued = Math.max(req.skillLabDirectorAt ?? 0, req.primaryAdminAt ?? 0) || req.requestedAt
  return `USOP-C-${new Date(issued).getFullYear()}-${String(h % 10000).padStart(4, '0')}`
}

// Derived, never stored — same "compute, don't store a status that could
// drift" discipline as videoBatchStatus() in videoBatches.ts.
export function certificateRequestStatus(req: CertificateRequest): CertificateRequestStatus {
  if (req.skillLabDirectorDecision === 'rejected' || req.primaryAdminDecision === 'rejected') return 'rejected'
  if (req.skillLabDirectorDecision === 'approved' && req.primaryAdminDecision === 'approved') return 'issued'
  return 'pending'
}

// A skill only counts once faculty has actually approved at least one
// submission against it — confirmed with the user ("accepted by the
// faculty at least one mark"), not merely submitted.
export function computeRequiredSkillCompletion(preset: CertificateSkillPreset, submissions: Submission[]) {
  const completedNodeIds = new Set(submissions.filter((s) => s.status === 'approved').map((s) => s.nodeId))
  const completed = preset.requiredSkills.filter((sk) => completedNodeIds.has(sk.nodeId))
  return { completed, allComplete: preset.requiredSkills.length > 0 && completed.length === preset.requiredSkills.length }
}
