import { addDoc, collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc, where, type Unsubscribe } from 'firebase/firestore'
import { db } from '../firebase'
import type { InstitutionVideoOverride, MbbsYear, VideoTutorial } from '../../types'

const videoTutorialsRef = collection(db, 'videoTutorials')

// Primary admin only — lists every video tutorial platform-wide, same
// no-filter list-query shape as watchAllDepartments.
export function watchAllVideoTutorials(onChange: (videos: VideoTutorial[]) => void): Unsubscribe {
  return onSnapshot(videoTutorialsRef, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VideoTutorial))
  })
}

// '' in VideoTutorial.department means "every department".
export const ALL_DEPARTMENTS = ''

export function isVideoActive(video: Pick<VideoTutorial, 'active'>): boolean {
  return video.active !== false
}

// Does a video published to `video.department` reach someone in
// `departmentName`? All-department videos reach everyone.
export function videoReachesDepartment(video: Pick<VideoTutorial, 'department'>, departmentName: string | null): boolean {
  return video.department === ALL_DEPARTMENTS || (!!departmentName && video.department === departmentName)
}

// A student's own tutorial list for one of their departments — catalog
// videos plus their institution's exclusive ones, published either to that
// department or to all departments, for their year. Disabled videos are
// dropped here so no caller can forget. videoTutorials' read rule is a flat
// isActive(), so this filter combination needs no rules change.
export function watchStudentVideos(
  institutionId: string,
  department: string,
  mbbsYear: MbbsYear,
  onChange: (videos: VideoTutorial[]) => void,
): Unsubscribe {
  const q = query(
    videoTutorialsRef,
    where('institutionId', 'in', ['', institutionId]),
    where('department', 'in', [ALL_DEPARTMENTS, department]),
    where('mbbsYear', '==', mbbsYear),
    where('audience', '==', 'student'),
  )
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VideoTutorial).filter(isVideoActive))
  })
}

// Faculty/HOD track — not year-scoped. Published to all departments, or to
// the viewer's own department only (`departmentName`, resolved by caller).
export function watchFacultyVideos(
  institutionId: string,
  departmentName: string | null,
  onChange: (videos: VideoTutorial[]) => void,
): Unsubscribe {
  const q = query(videoTutorialsRef, where('institutionId', 'in', ['', institutionId]), where('audience', '==', 'faculty'))
  return onSnapshot(q, (snap) => {
    onChange(
      snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as VideoTutorial)
        .filter((v) => isVideoActive(v) && videoReachesDepartment(v, departmentName)),
    )
  })
}

// One video by id — the full-page editor's edit mode.
export function watchVideoTutorial(videoId: string, onChange: (video: VideoTutorial | null) => void): Unsubscribe {
  return onSnapshot(doc(videoTutorialsRef, videoId), (snap) => {
    onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as VideoTutorial) : null)
  })
}

export async function createVideoTutorial(input: Omit<VideoTutorial, 'id'>): Promise<string> {
  const docRef = await addDoc(videoTutorialsRef, input)
  return docRef.id
}

export async function updateVideoTutorial(videoId: string, patch: Partial<Omit<VideoTutorial, 'id'>>): Promise<void> {
  await updateDoc(doc(videoTutorialsRef, videoId), patch)
}

export async function deleteVideoTutorial(videoId: string): Promise<void> {
  await deleteDoc(doc(videoTutorialsRef, videoId))
}

// --- Institution include/exclude toggle for shared-catalog videos --------
// Same absence-means-enabled pattern as institutionCompetencyOverrides.

const videoOverridesRef = collection(db, 'institutionVideoOverrides')

function videoOverrideId(institutionId: string, videoId: string) {
  return `${institutionId}_${videoId}`
}

export function watchInstitutionVideoOverrides(
  institutionId: string,
  onChange: (overrides: InstitutionVideoOverride[]) => void,
): Unsubscribe {
  const q = query(videoOverridesRef, where('institutionId', '==', institutionId))
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as InstitutionVideoOverride))
  })
}

export async function setVideoEnabledForInstitution(
  institutionId: string,
  videoId: string,
  enabled: boolean,
): Promise<void> {
  await setDoc(doc(videoOverridesRef, videoOverrideId(institutionId, videoId)), {
    institutionId,
    videoId,
    enabled,
  })
}
