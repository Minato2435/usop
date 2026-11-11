import { addDoc, collection, deleteDoc, doc, onSnapshot, query, updateDoc, where, type Unsubscribe } from 'firebase/firestore'
import { deleteObject, ref as storageRef } from 'firebase/storage'
import { db, storage } from '../firebase'
import type { BatchVideoItem, VideoBatch, VideoBatchStatus, VideoPreviewable } from '../../types'

const videoBatchesRef = collection(db, 'videoBatches')

// Derives scheduled/active/expired purely from startAt/endAt vs. now —
// there's no Cloud Function/cron in this project to flip a stored status
// field, so every read recomputes it instead. A batch past its own endAt
// is never deleted on its own; it just reads as 'expired' and stops
// granting its members access (see watchMyVideoBatches below) until an
// admin removes it explicitly.
export function videoBatchStatus(batch: VideoBatch, now: number = Date.now()): VideoBatchStatus {
  if (now < batch.startAt) return 'scheduled'
  if (now > batch.endAt) return 'expired'
  return 'active'
}

// Primary admin only — every batch platform-wide, same no-filter shape as
// watchAllVideoTutorials/watchAllDepartments.
export function watchAllVideoBatches(onChange: (batches: VideoBatch[]) => void): Unsubscribe {
  return onSnapshot(videoBatchesRef, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VideoBatch))
  })
}

// A single batch by id, real-time — used by the edit page (route
// /admin/video-tutorials/batches/:batchId/edit), same "watch, not one-shot
// get" convention every other admin editor page in this app uses
// (watchFormTemplate, CompetencyEditorPage's own template/node watchers).
export function watchVideoBatch(batchId: string, onChange: (batch: VideoBatch | null) => void): Unsubscribe {
  return onSnapshot(doc(videoBatchesRef, batchId), (snap) => {
    onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as VideoBatch) : null)
  })
}

// A student or faculty member's own batch grants — array-contains on
// memberIds is exactly the field videoBatches' read rule checks for a
// non-admin reader, so this satisfies the list-query-filter-completeness
// gotcha. Callers still need to filter by videoBatchStatus(...) === 'active'
// themselves — a scheduled or expired batch's doc is still readable (so the
// member can see it's coming up / already ran), it just shouldn't unlock
// the video yet/anymore.
export function watchMyVideoBatches(uid: string, onChange: (batches: VideoBatch[]) => void): Unsubscribe {
  const q = query(videoBatchesRef, where('memberIds', 'array-contains', uid))
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as VideoBatch))
  })
}

export async function createVideoBatch(input: Omit<VideoBatch, 'id'>): Promise<string> {
  const docRef = await addDoc(videoBatchesRef, input)
  return docRef.id
}

export async function updateVideoBatch(batchId: string, patch: Partial<Omit<VideoBatch, 'id'>>): Promise<void> {
  await updateDoc(doc(videoBatchesRef, batchId), patch)
}

export async function deleteVideoBatch(batchId: string): Promise<void> {
  await deleteDoc(doc(videoBatchesRef, batchId))
}

// Deletes one video item's own Storage files (the video itself, if
// uploaded, and its custom thumbnail, if any) — used both when deleting a
// whole batch (below) and when a single item is removed from a batch
// during editing.
export async function deleteVideoItemFiles(video: BatchVideoItem): Promise<void> {
  if (video.source === 'upload' && video.storagePath) {
    await deleteObject(storageRef(storage, video.storagePath)).catch(() => {})
  }
  if (video.thumbnailStoragePath) {
    await deleteObject(storageRef(storage, video.thumbnailStoragePath)).catch(() => {})
  }
}

// Deletes every one of the batch's own videos' Storage files before
// deleting the Firestore doc — same cleanup order deleteVideoAndFiles()
// uses for a catalog VideoTutorial, just looped over `videos` now that a
// batch can carry more than one.
export async function deleteVideoBatchAndFiles(batch: VideoBatch): Promise<void> {
  for (const video of batch.videos) {
    await deleteVideoItemFiles(video)
  }
  await deleteVideoBatch(batch.id)
}

// Builds a display-only view of one of a batch's embedded videos,
// satisfying VideoPreviewable (VideoThumbnail/VideoPreviewModal's prop
// type) without this ever being, or needing, a real VideoTutorial document
// — the whole point of embedding videos on the batch itself (see
// VideoBatch's own doc comment in types/index.ts) is that none of them is
// ever queryable through the normal catalog at all. `departmentName` is
// resolved by the caller (both consumer pages already have it on hand)
// since VideoBatch only stores a departmentId, not a denormalized name.
export function batchVideoView(batch: VideoBatch, video: BatchVideoItem, departmentName: string): VideoPreviewable {
  return {
    title: video.title,
    description: video.description,
    department: departmentName,
    mbbsYear: batch.mbbsYear,
    audience: batch.audience,
    source: video.source,
    url: video.url,
    thumbnailUrl: video.thumbnailUrl,
  }
}
