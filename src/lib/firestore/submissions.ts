import { collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc, updateDoc, where, type Unsubscribe } from 'firebase/firestore'
import { db } from '../firebase'
import type { CompetencyLevel, FieldAnswerValue, Submission, SubmissionStatus } from '../../types'
import { deleteStoredImages, normalizeSubmissionImages } from '../submissionImages'

// Every read goes through here so `images` is always SubmissionImage[]
// (older docs held base64 strings).
function toSubmission(id: string, data: Record<string, unknown>): Submission {
  return { id, ...data, images: normalizeSubmissionImages(data.images) } as Submission
}

// A fresh id for a not-yet-created submission — so its images can be
// uploaded under the right Storage path before the doc is written.
export function newSubmissionId(): string {
  return doc(submissionsRef).id
}

const submissionsRef = collection(db, 'submissions')

// Firestore denies a list query outright unless it filters on every field
// the security rule reads — here that's just studentId (My Activity) or
// facultyId (the Faculty inbox), one clause each, so no extra filters are
// required to satisfy the rule (see firestore.rules' submissions block).

export function watchStudentSubmissions(studentId: string, onChange: (submissions: Submission[]) => void): Unsubscribe {
  const q = query(submissionsRef, where('studentId', '==', studentId), orderBy('updatedAt', 'desc'))
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => toSubmission(d.id, d.data())))
  })
}

export function watchFacultyInbox(facultyId: string, onChange: (submissions: Submission[]) => void): Unsubscribe {
  const q = query(submissionsRef, where('facultyId', '==', facultyId), orderBy('updatedAt', 'desc'))
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => toSubmission(d.id, d.data())))
  })
}

// HOD's department-wide scope — every submission in their department
// regardless of which faculty member it was sent to (per the spec, HOD
// "oversees all faculty reviews... within the department" and can decide
// on any of them). Filters on both institutionId and departmentId since
// firestore.rules' HOD branch reads both.
export function watchDepartmentSubmissions(
  institutionId: string,
  departmentId: string,
  onChange: (submissions: Submission[]) => void,
): Unsubscribe {
  const q = query(
    submissionsRef,
    where('institutionId', '==', institutionId),
    where('departmentId', '==', departmentId),
    orderBy('updatedAt', 'desc'),
  )
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => toSubmission(d.id, d.data())))
  })
}

// Principal's institution-wide, read-only scope — every submission across
// every department of their institution, for the monitoring/reporting
// dashboard. Filters on institutionId, matching the single field
// firestore.rules' Principal branch reads.
export function watchInstitutionSubmissions(
  institutionId: string,
  onChange: (submissions: Submission[]) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  const q = query(submissionsRef, where('institutionId', '==', institutionId), orderBy('updatedAt', 'desc'))
  return onSnapshot(
    q,
    (snap) => {
      onChange(snap.docs.map((d) => toSubmission(d.id, d.data())))
    },
    (error) => onError?.(error),
  )
}

export function watchSubmission(id: string, onChange: (submission: Submission | null) => void): Unsubscribe {
  return onSnapshot(doc(submissionsRef, id), (snap) => {
    onChange(snap.exists() ? toSubmission(snap.id, snap.data()) : null)
  })
}

export async function createDraftSubmission(
  input: Omit<
    Submission,
    | 'id'
    | 'status'
    | 'resubmittedAfterRevision'
    | 'facultyFeedback'
    | 'facultyRemarks'
    | 'facultyRating'
    | 'competencyLevel'
    | 'submittedAt'
    | 'reviewedAt'
    | 'createdAt'
    | 'updatedAt'
  >,
  // Pre-generated (newSubmissionId) so images can be uploaded under this id first.
  id: string = newSubmissionId(),
): Promise<string> {
  const now = Date.now()
  const ref = doc(submissionsRef, id)
  await setDoc(ref, {
    ...input,
    status: 'draft' satisfies SubmissionStatus,
    resubmittedAfterRevision: false,
    facultyFeedback: null,
    facultyRemarks: null,
    facultyRating: null,
    competencyLevel: null,
    submittedAt: null,
    reviewedAt: null,
    createdAt: now,
    updatedAt: now,
  })
  return ref.id
}

// Edits a still-editable submission's answers/chosen faculty — usable while
// status is 'draft' (not yet sent) or 'revisionRequested' (sent back by
// faculty for changes). firestore.rules only lets the owning student write
// while the doc is in one of those two states.
export async function updateDraftSubmission(
  id: string,
  patch: Partial<
    Pick<
      Submission,
      | 'facultyId'
      | 'answers'
      | 'templateId'
      | 'nodeId'
      | 'nodeTitle'
      | 'formSchemaId'
      | 'description'
      | 'images'
      | 'activityDate'
      | 'attemptType'
      | 'studentName'
      | 'studentRollNumber'
    >
  >,
): Promise<void> {
  await updateDoc(doc(submissionsRef, id), { ...patch, updatedAt: Date.now() })
}

// Moves a draft, or a submission sent back for revision, into the faculty's
// inbox. Doesn't clear any prior facultyFeedback/remarks — those stay
// visible as context for what changed since the last review. `wasRevision
// Requested` — the caller already has the pre-edit status in hand (it just
// loaded the doc to populate the resume form), so this is a plain flag
// rather than an extra read here — sets `resubmittedAfterRevision` so
// faculty/HOD/Principal still see this as a Revision Requested item (not a
// fresh Submitted one) right up until the next decision, even though
// `status` itself goes back to 'submitted' so it correctly re-enters every
// existing pending-queue filter/count unchanged.
export async function submitSubmission(id: string, wasRevisionRequested: boolean): Promise<void> {
  const now = Date.now()
  await updateDoc(doc(submissionsRef, id), {
    status: 'submitted' satisfies SubmissionStatus,
    resubmittedAfterRevision: wasRevisionRequested,
    submittedAt: now,
    updatedAt: now,
  })
}

// Deletes the doc first (that's the permission-checked part), then its
// images in Storage.
export async function deleteDraftSubmission(submission: Pick<Submission, 'id' | 'images'>): Promise<void> {
  await deleteDoc(doc(submissionsRef, submission.id))
  await deleteStoredImages(submission.images ?? [])
}

export async function facultyDecideSubmission(
  id: string,
  decision: {
    status: Extract<SubmissionStatus, 'approved' | 'revisionRequested' | 'rejected'>
    facultyFeedback: string | null
    facultyRemarks: string | null
    facultyRating: number | null
    competencyLevel: CompetencyLevel | null
    // The faculty's own filled DOPS checklist (steps, global rating,
    // sign-off) — optional so a decision can still be recorded even when
    // the schema resolved to nothing (effectiveSchemaId was null).
    answers?: Record<string, FieldAnswerValue>
    // Who is deciding — printed on the student's activity export.
    reviewedById?: string | null
    reviewedByName?: string | null
    reviewedByRole?: 'faculty' | 'hod' | null
  },
): Promise<void> {
  const now = Date.now()
  // Every decision — approve, reject, or request revision again — resolves
  // whatever "just came back from a revision" state this submission was
  // in, so the display-only flag always resets here regardless of which
  // decision was made. If the decision is 'revisionRequested' again, the
  // student sees the normal Revision Requested status from `status`
  // itself; the flag only matters once they resubmit a second time.
  await updateDoc(doc(submissionsRef, id), { ...decision, resubmittedAfterRevision: false, reviewedAt: now, updatedAt: now })
}
