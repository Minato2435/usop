import { deleteObject, getBlob, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { storage } from './firebase'
import type { SubmissionImage, SubmissionImageKind } from '../types'

// Activity photos and sketches live in Firebase Storage, never inside the
// Firestore submission doc — the doc only keeps a small { id, kind, url,
// path } entry per image. Path: submissions/{studentId}/{submissionId}/{id}.{jpg|png}
// (storage.rules lets only that student write there).
//
// While the student is still editing, an image is a DraftImage: either one
// already stored (from a previous save) or a new local Blob with an object-
// URL preview. Nothing is uploaded until the activity is saved.

export type DraftImage = {
  id: string
  kind: SubmissionImageKind
  previewUrl: string // object URL for a new blob, the download URL for a stored one
  blob: Blob | null // set = not uploaded yet
  stored: SubmissionImage | null
}

export const MAX_PHOTOS = 5
export const MAX_SKETCHES = 1
export const MAX_PHOTO_DIMENSION = 1600
export const MAX_PHOTO_BYTES = 900_000 // after compression; Storage rule caps uploads at 4 MB

const BUCKET = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined
const LEGACY_DATA_URL = /^data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/]+=*$/

export const newImageId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`

// Only ever render images that come from this project's own Storage bucket
// (or old inline data URLs) — the `images` field is writable by the
// submission's owner straight through the SDK, so an arbitrary remote URL
// (a tracking pixel) must never reach an <img src>.
export function isSafeImageUrl(url: string): boolean {
  if (LEGACY_DATA_URL.test(url)) return true
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' || u.hostname !== 'firebasestorage.googleapis.com') return false
    return !BUCKET || u.pathname.startsWith(`/v0/b/${BUCKET}/o/`)
  } catch {
    return false
  }
}

// Reads `images` from a submission doc. Older activities stored the image
// itself as a base64 data URL string — those still display (read-only
// legacy support); everything new is a SubmissionImage.
export function normalizeSubmissionImages(raw: unknown): SubmissionImage[] {
  if (!Array.isArray(raw)) return []
  const out: SubmissionImage[] = []
  raw.forEach((item, i) => {
    if (typeof item === 'string') {
      if (LEGACY_DATA_URL.test(item)) out.push({ id: `legacy-${i}`, kind: item.startsWith('data:image/png') ? 'sketch' : 'photo', url: item, path: '' })
    } else if (item && typeof item === 'object') {
      const o = item as Partial<SubmissionImage>
      if (typeof o.url === 'string' && isSafeImageUrl(o.url)) {
        out.push({ id: o.id || `img-${i}`, kind: o.kind === 'sketch' ? 'sketch' : 'photo', url: o.url, path: typeof o.path === 'string' ? o.path : '' })
      }
    }
  })
  return out
}

export function toDraftImages(images: SubmissionImage[]): DraftImage[] {
  return images.map((s) => ({ id: s.id, kind: s.kind, previewUrl: s.url, blob: null, stored: s }))
}

export function draftFromBlob(blob: Blob, kind: SubmissionImageKind): DraftImage {
  return { id: newImageId(), kind, previewUrl: URL.createObjectURL(blob), blob, stored: null }
}

export function revokeDraft(img: DraftImage) {
  if (img.blob && img.previewUrl.startsWith('blob:')) URL.revokeObjectURL(img.previewUrl)
}

// Uploads every not-yet-stored image and returns the full ordered list to
// save on the doc. Legacy data-URL images being kept are uploaded too, so a
// re-saved old activity ends up fully on Storage.
export async function uploadDraftImages(studentId: string, submissionId: string, drafts: DraftImage[]): Promise<SubmissionImage[]> {
  return Promise.all(
    drafts.map(async (d) => {
      if (d.stored && d.stored.path) return d.stored
      const blob = d.blob ?? (d.stored ? await (await fetch(d.stored.url)).blob() : null)
      if (!blob) throw new Error('Image has no data')
      const contentType = d.kind === 'sketch' ? 'image/png' : blob.type === 'image/png' ? 'image/png' : 'image/jpeg'
      const ext = contentType === 'image/png' ? 'png' : 'jpg'
      const path = `submissions/${studentId}/${submissionId}/${d.id}.${ext}`
      const r = storageRef(storage, path)
      // Each path is written once (a changed sketch gets a new id), so the
      // file can be cached for good.
      await uploadBytes(r, blob, { contentType, cacheControl: 'public, max-age=31536000, immutable' })
      return { id: d.id, kind: d.kind, url: await getDownloadURL(r), path }
    }),
  )
}

export async function deleteStoredImages(images: SubmissionImage[]): Promise<void> {
  await Promise.all(images.filter((i) => i.path).map((i) => deleteObject(storageRef(storage, i.path)).catch(() => {})))
}

// The image's bytes as a same-origin object URL — needed whenever the pixels
// are drawn onto a canvas (re-editing a sketch, the PDF export); a plain
// cross-origin <img> would taint the canvas. Caller revokes it.
export async function imageObjectUrl(img: { previewUrl?: string; blob?: Blob | null; stored?: SubmissionImage | null } | SubmissionImage): Promise<string> {
  if ('blob' in img && img.blob) return URL.createObjectURL(img.blob)
  const stored: SubmissionImage | null | undefined = 'stored' in img ? img.stored : (img as SubmissionImage)
  if (!stored) throw new Error('No image')
  if (!stored.path) return stored.url // legacy data URL — already same-origin
  try {
    return URL.createObjectURL(await getBlob(storageRef(storage, stored.path)))
  } catch {
    return URL.createObjectURL(await (await fetch(stored.url)).blob())
  }
}

// For the PDF export: the image as a (downscaled) JPEG/PNG data URL.
export async function imageAsDataUrl(img: SubmissionImage, maxDim = 1100): Promise<string | null> {
  if (!img.path) return img.url
  let objectUrl: string | null = null
  try {
    objectUrl = await imageObjectUrl(img)
    const el = await loadImageElement(objectUrl)
    const scale = Math.min(1, maxDim / Math.max(el.naturalWidth, el.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(el.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(el.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    if (img.kind === 'sketch') {
      ctx.fillStyle = '#FFFFFF'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
    return img.kind === 'sketch' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85)
  } catch {
    return null
  } finally {
    if (objectUrl?.startsWith('blob:')) URL.revokeObjectURL(objectUrl)
  }
}

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new window.Image()
    el.onload = () => resolve(el)
    el.onerror = reject
    el.src = src
  })
}

// Phone photos are 3–10 MB: downscale to MAX_PHOTO_DIMENSION and re-encode
// as JPEG, stepping quality down until under MAX_PHOTO_BYTES. Much higher
// quality than the old inline limit (~110 KB), since Storage has no 1 MB
// document cap.
export async function compressPhoto(file: File): Promise<Blob> {
  const src = URL.createObjectURL(file)
  try {
    const el = await loadImageElement(src)
    const scale = Math.min(1, MAX_PHOTO_DIMENSION / Math.max(el.naturalWidth, el.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(el.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(el.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unsupported')
    ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
    let quality = 0.85
    let blob = await canvasToBlob(canvas, 'image/jpeg', quality)
    while (blob.size > MAX_PHOTO_BYTES && quality > 0.4) {
      quality -= 0.12
      blob = await canvasToBlob(canvas, 'image/jpeg', quality)
    }
    return blob
  } finally {
    URL.revokeObjectURL(src)
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed'))), type, quality))
}
