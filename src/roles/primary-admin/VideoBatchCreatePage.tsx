import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { deleteObject, uploadBytes, uploadBytesResumable, getDownloadURL, ref as storageRef } from 'firebase/storage'
import { useAuth } from '../../auth/AuthContext'
import { storage } from '../../lib/firebase'
import { PrimaryAdminShell } from './shell/PrimaryAdminShell'
import { BatchMemberPicker } from './BatchMemberPicker'
import { GhostButton, PrimaryButton, Skeleton } from './shell/ui'
import { Icon } from './shell/Icon'
import { VideoThumbnail, VideoPreviewModal, FileAttachControl, AUDIENCE_LABELS, MAX_UPLOAD_BYTES, recognizedSourceLabel, Segmented } from './shell/VideoShared'
import { watchAllDepartments, watchInstitutionDepartmentOverrides } from '../../lib/firestore/departments'
import { watchInstitutions } from '../../lib/firestore/institutions'
import { watchUsers } from '../../lib/firestore/users'
import { createVideoBatch, updateVideoBatch, watchVideoBatch, deleteVideoItemFiles, deleteVideoBatch } from '../../lib/firestore/videoBatches'
import { MBBS_YEARS } from '../../lib/academicStructure'
import type { AppUser, BatchVideoItem, Department, Institution, InstitutionDepartmentOverride, MbbsYear, VideoAudience, VideoBatch, VideoPreviewable, VideoSource } from '../../types'

// Same "merges with the page, defined by its border" treatment
// FormEditorPage/CompetencyEditorPage use instead of a white-fill card.
const BORDER = 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)'

function StepHeader({ step, title, hint }: { step: string; title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-3 flex-wrap mb-3">
      <span className="font-mono text-[11px] tracking-[0.14em] uppercase shrink-0" style={{ color: 'var(--color-gold)' }}>
        Step {step}
      </span>
      <h2 className="font-display text-[19px]" style={{ color: 'var(--color-char)' }}>
        {title}
      </h2>
      {hint && (
        <span className="text-[12.5px]" style={{ color: 'var(--color-char-soft)' }}>
          {hint}
        </span>
      )}
    </div>
  )
}

function inputStyle() {
  return { borderColor: 'var(--color-line)', color: 'var(--color-char)' }
}

function toDatetimeLocalValue(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// A video still being drafted on this page — `key` is a stable id reused
// as the persisted BatchVideoItem.id (and its Storage path segment).
// `existingVideo` is set when this draft represents a video the batch
// already has (editing) — its underlying file/link is immutable here (same
// restriction VideoFormModal's own edit mode applies: "to change the video
// itself, remove this and add a new one"); only title/description/
// thumbnail, and a link's own URL, stay editable in place. `existingVideo`
// is null for a brand-new video, whether creating a batch or adding one
// more video to an existing batch.
interface DraftVideoItem {
  key: string
  existingVideo: BatchVideoItem | null
  title: string
  description: string
  sourceType: VideoSource
  linkUrl: string
  uploadFile: File | null
  localFileUrl: string | null // object-URL preview of uploadFile, pre-upload
  // Custom thumbnail — independent of source, same as VideoFormModal's own
  // thumbnail field. Optional; overrides the automatic thumbnail (YouTube's
  // own image, or the first-frame capture for an uploaded file) when set.
  thumbnailFile: File | null
  thumbnailPreviewUrl: string | null // object-URL preview of thumbnailFile
  thumbnailRemoved: boolean // explicit "remove the existing thumbnail" (editing only)
}

function blankDraftVideo(): DraftVideoItem {
  return {
    key: crypto.randomUUID(),
    existingVideo: null,
    title: '',
    description: '',
    sourceType: 'upload',
    linkUrl: '',
    uploadFile: null,
    localFileUrl: null,
    thumbnailFile: null,
    thumbnailPreviewUrl: null,
    thumbnailRemoved: false,
  }
}

function draftFromExisting(v: BatchVideoItem): DraftVideoItem {
  return {
    key: v.id,
    existingVideo: v,
    title: v.title,
    description: v.description,
    sourceType: v.source,
    linkUrl: v.source === 'link' ? v.url : '',
    uploadFile: null,
    localFileUrl: null,
    thumbnailFile: null,
    thumbnailPreviewUrl: null,
    thumbnailRemoved: false,
  }
}

// One page, two routes: /admin/video-tutorials/batches/new (create) and
// /admin/video-tutorials/batches/:batchId/edit (edit) — same "one form,
// driven by whether a target already exists" convention VideoFormModal
// uses for the regular catalog, just as a full page here rather than a
// Modal (the user asked for real thumbnail previews aligned with each
// video's title, which a plain <select> picker couldn't give, and for the
// whole flow to get more room than a modal allows). Mirrors
// FormEditorPage.tsx/CompetencyEditorPage.tsx's structure (StepHeader
// kicker, bordered-on-paper cards via the BORDER token, a max-w-3xl
// centered column).
//
// Step 02 was a *picker* over existing catalog videos at first — dropped
// entirely on direct follow-up once that turned out to be the root cause
// of a real bug: a picked video that happened to also match the target
// cohort's own department/year/audience stayed visible to them through
// the ordinary catalog regardless of the batch's schedule. The fix: upload
// the video (or paste a link) straight onto the batch itself, so it never
// becomes a videoTutorials document and can never collide with the normal
// catalog — see VideoBatch's own doc comment in types/index.ts. A further
// follow-up asked for *multiple* videos per batch, since the same cohort/
// schedule/member list usually applies to a small set of videos together
// — Step 02 is a repeatable list of video drafts, not one set of fields.
export function PrimaryAdminVideoBatchCreatePage() {
  const { appUser } = useAuth()
  const navigate = useNavigate()
  const { batchId } = useParams<{ batchId?: string }>()
  const isEditing = Boolean(batchId)

  const [departments, setDepartments] = useState<Department[]>([])
  useEffect(() => watchAllDepartments(setDepartments), [])
  const [institutions, setInstitutions] = useState<Institution[]>([])
  useEffect(() => watchInstitutions(setInstitutions), [])
  const [users, setUsers] = useState<AppUser[]>([])
  useEffect(() => watchUsers(setUsers), [])

  // The existing batch, when editing — hydrated into local state exactly
  // once (the `loaded` guard below), same pattern CompetencyEditorPage.tsx/
  // FormEditorPage.tsx use, so a background snapshot mid-edit never clobbers
  // unsaved changes.
  const [existingBatch, setExistingBatch] = useState<VideoBatch | null>(null)
  const [batchLoading, setBatchLoading] = useState(isEditing)
  useEffect(() => {
    if (!batchId) return
    return watchVideoBatch(batchId, (b) => {
      setExistingBatch(b)
      setBatchLoading(false)
    })
  }, [batchId])

  const [title, setTitle] = useState('')
  const [institutionId, setInstitutionId] = useState('')
  // departmentId '' = every department (same convention as a catalog
  // video's department ''), chosen via `reach`.
  const [reach, setReach] = useState<'all' | 'one'>('all')
  const [departmentId, setDepartmentId] = useState('')
  const [mbbsYear, setMbbsYear] = useState<MbbsYear>(1)
  const [audience, setAudience] = useState<VideoAudience>('student')
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [startLocal, setStartLocal] = useState('')
  const [endLocal, setEndLocal] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const [videoItems, setVideoItems] = useState<DraftVideoItem[]>([blankDraftVideo()])
  // Existing videos removed during an edit — their Storage files get
  // cleaned up on save, same cleanup discipline deleteVideoBatchAndFiles()
  // already applies when the whole batch is deleted.
  const [removedExistingVideos, setRemovedExistingVideos] = useState<BatchVideoItem[]>([])

  const [loaded, setLoaded] = useState(!isEditing)
  useEffect(() => {
    if (!isEditing || loaded || !existingBatch) return
    setTitle(existingBatch.title)
    setInstitutionId(existingBatch.institutionId)
    setDepartmentId(existingBatch.departmentId)
    setReach(existingBatch.departmentId === '' ? 'all' : 'one')
    setMbbsYear(existingBatch.mbbsYear)
    setAudience(existingBatch.audience)
    setMemberIds(existingBatch.memberIds)
    setStartLocal(toDatetimeLocalValue(existingBatch.startAt))
    setEndLocal(toDatetimeLocalValue(existingBatch.endAt))
    setVideoItems(existingBatch.videos.length > 0 ? existingBatch.videos.map(draftFromExisting) : [blankDraftVideo()])
    setLoaded(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, loaded, existingBatch])

  // Object URLs are revoked individually as a given item's file is
  // replaced/removed (see setVideoItemFile/removeVideoItem below); this
  // just catches whatever's still outstanding if the admin navigates away
  // mid-draft, via a ref so the cleanup always sees the latest array
  // without re-subscribing the effect on every keystroke.
  const videoItemsRef = useRef(videoItems)
  videoItemsRef.current = videoItems
  useEffect(() => {
    return () => {
      videoItemsRef.current.forEach((it) => {
        if (it.localFileUrl) URL.revokeObjectURL(it.localFileUrl)
        if (it.thumbnailPreviewUrl) URL.revokeObjectURL(it.thumbnailPreviewUrl)
      })
    }
  }, [])

  function updateVideoItem(key: string, patch: Partial<DraftVideoItem>) {
    setVideoItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)))
  }

  function setVideoItemFile(key: string, file: File | null) {
    setVideoItems((prev) =>
      prev.map((it) => {
        if (it.key !== key) return it
        if (it.localFileUrl) URL.revokeObjectURL(it.localFileUrl)
        return { ...it, uploadFile: file, localFileUrl: file ? URL.createObjectURL(file) : null }
      }),
    )
  }

  function setVideoItemThumbnail(key: string, file: File | null) {
    setVideoItems((prev) =>
      prev.map((it) => {
        if (it.key !== key) return it
        if (it.thumbnailPreviewUrl) URL.revokeObjectURL(it.thumbnailPreviewUrl)
        return {
          ...it,
          thumbnailFile: file,
          thumbnailPreviewUrl: file ? URL.createObjectURL(file) : null,
          thumbnailRemoved: file ? false : it.thumbnailRemoved,
        }
      }),
    )
  }

  function addVideoItem() {
    setVideoItems((prev) => [...prev, blankDraftVideo()])
  }

  function removeVideoItem(key: string) {
    setVideoItems((prev) => {
      const target = prev.find((it) => it.key === key)
      if (target?.localFileUrl) URL.revokeObjectURL(target.localFileUrl)
      if (target?.thumbnailPreviewUrl) URL.revokeObjectURL(target.thumbnailPreviewUrl)
      if (target?.existingVideo) setRemovedExistingVideos((r) => [...r, target.existingVideo!])
      return prev.filter((it) => it.key !== key)
    })
  }

  // Departments switched on for this college; for students, only the
  // chosen year's (a department belongs to one year).
  const [deptOverrides, setDeptOverrides] = useState<InstitutionDepartmentOverride[]>([])
  useEffect(() => {
    if (!institutionId) {
      setDeptOverrides([])
      return
    }
    return watchInstitutionDepartmentOverrides(institutionId, setDeptOverrides)
  }, [institutionId])
  const departmentOptions = useMemo(() => {
    if (!institutionId) return []
    const disabled = new Set(deptOverrides.filter((o) => !o.enabled).map((o) => o.departmentId))
    return departments
      .filter((d) => (d.institutionId === '' || d.institutionId === institutionId) && !disabled.has(d.id))
      .filter((d) => audience === 'faculty' || d.mbbsYear === mbbsYear || d.id === departmentId)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [departments, deptOverrides, institutionId, audience, mbbsYear, departmentId])
  const departmentChosen = reach === 'all' || departmentId !== ''
  const selectedDepartment = departments.find((d) => d.id === departmentId) ?? null

  // The roster this cohort scopes to changes shape whenever any of these
  // four filters change — the previous selection almost certainly doesn't
  // apply to the new roster, so it's cleared. The one exception is the
  // very first time these fields take on their real values during an
  // edit's hydration (above) — that's not the admin changing anything, so
  // the just-hydrated memberIds shouldn't be wiped out by it. `skipResetRef`
  // absorbs exactly that one transition and then gets out of the way.
  const skipResetRef = useRef(isEditing)
  useEffect(() => {
    if (!loaded) return
    if (skipResetRef.current) {
      skipResetRef.current = false
      return
    }
    setMemberIds([])
  }, [institutionId, departmentId, reach, mbbsYear, audience, loaded])

  const candidates = useMemo(() => {
    if (!institutionId || !departmentChosen) return []
    return users.filter((u) => {
      if (u.role !== audience || !u.active) return false
      if (u.institutionId !== institutionId) return false
      // A student is bound by year only — every department enabled for
      // their college in that year applies to them — so the year decides,
      // whether the batch is for all departments or one of that year's.
      if (audience === 'student') return u.mbbsYear === mbbsYear
      // Faculty: their own single department, unless the batch is for all.
      if (reach === 'one' && u.departmentId !== departmentId) return false
      return (u.associatedMbbsYears ?? []).includes(mbbsYear)
    })
  }, [users, institutionId, departmentId, departmentChosen, reach, mbbsYear, audience])

  function draftPreview(item: DraftVideoItem): VideoPreviewable | null {
    const ready = item.existingVideo ? true : item.sourceType === 'link' ? item.linkUrl.trim() !== '' : item.uploadFile !== null
    if (!item.title.trim() || !ready) return null
    const url = item.existingVideo
      ? item.sourceType === 'link'
        ? item.linkUrl.trim()
        : item.existingVideo.url
      : item.sourceType === 'link'
        ? item.linkUrl.trim()
        : item.localFileUrl ?? ''
    const thumbnailUrl = item.thumbnailFile
      ? item.thumbnailPreviewUrl
      : item.thumbnailRemoved
        ? null
        : (item.existingVideo?.thumbnailUrl ?? null)
    return {
      title: item.title.trim(),
      description: item.description.trim(),
      department: selectedDepartment?.name ?? '',
      mbbsYear,
      audience,
      source: item.sourceType,
      url,
      thumbnailUrl,
    }
  }

  const readyVideoCount = videoItems.filter((it) => draftPreview(it) !== null).length
  const previewItem = videoItems.find((it) => it.key === previewKey) ?? null
  const previewVideo = previewItem ? draftPreview(previewItem) : null

  // Shared by both create and edit — a video item's final, synchronous
  // fields, before any Storage round-trip. An existing item keeps its own
  // id/source/storagePath (immutable here); only title/description (and a
  // link's own url) can change in place. Thumbnail removal-without-
  // replacement is resolved to null here too; its Storage cleanup happens
  // separately in handleSave, since that's a side effect, not a pure value.
  function buildBaseVideo(it: DraftVideoItem): BatchVideoItem {
    if (it.existingVideo) {
      const keepThumbnail = !(it.thumbnailRemoved && !it.thumbnailFile)
      return {
        id: it.existingVideo.id,
        title: it.title.trim(),
        description: it.description.trim(),
        source: it.existingVideo.source,
        url: it.existingVideo.source === 'link' ? it.linkUrl.trim() : it.existingVideo.url,
        storagePath: it.existingVideo.storagePath,
        thumbnailUrl: keepThumbnail ? it.existingVideo.thumbnailUrl : null,
        thumbnailStoragePath: keepThumbnail ? it.existingVideo.thumbnailStoragePath : null,
      }
    }
    return {
      id: it.key,
      title: it.title.trim(),
      description: it.description.trim(),
      source: it.sourceType,
      url: it.sourceType === 'link' ? it.linkUrl.trim() : '',
      storagePath: null,
      thumbnailUrl: null,
      thumbnailStoragePath: null,
    }
  }

  async function handleSave() {
    if (!appUser) return
    if (!title.trim() || !institutionId || !departmentChosen || memberIds.length === 0 || !startLocal || !endLocal) {
      setError('Fill in every field and pick at least one member.')
      return
    }
    if (videoItems.length === 0) {
      setError('Add at least one video.')
      return
    }
    for (const item of videoItems) {
      if (!item.title.trim()) {
        setError('Give every video a title.')
        return
      }
      if (item.sourceType === 'link' && !item.linkUrl.trim()) {
        setError('Paste a video link for every video, or remove the empty one.')
        return
      }
      if (item.sourceType === 'upload' && !item.existingVideo) {
        if (!item.uploadFile) {
          setError('Choose a video file for every video, or remove the empty one.')
          return
        }
        if (item.uploadFile.size > MAX_UPLOAD_BYTES) {
          setError(`"${item.title.trim()}" is too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB).`)
          return
        }
      }
    }
    const startAt = new Date(startLocal).getTime()
    const endAt = new Date(endLocal).getTime()
    // A native datetime-local input's `value` is an empty string (not a
    // partially-filled one) until every one of its segments — month, day,
    // year, hour, minute, AND am/pm — has been explicitly set, which is
    // easy to miss when clicking/tabbing through it rather than using the
    // picker overlay. That empty string parses to an Invalid Date (NaN
    // getTime()), and `!(NaN > NaN)` is true — so an incomplete field was
    // silently surfacing the exact same "Close must be after start"
    // message a genuinely reversed pair would, which is why that message
    // could show up even with what looks like a valid, later close time.
    // Caught and reported separately here so the real cause is obvious.
    if (Number.isNaN(startAt) || Number.isNaN(endAt)) {
      setError('Pick a complete Starts and Closes date & time — every part, including AM/PM, needs to be filled in.')
      return
    }
    if (!(endAt > startAt)) {
      setError('Close date/time must be after the start date/time.')
      return
    }
    setError(null)
    setSaving(true)
    setUploadProgress({})
    let createdBatchId: string | null = null
    const uploadedPaths: string[] = []
    try {
      let targetBatchId = batchId ?? ''
      let baseVideos = videoItems.map(buildBaseVideo)

      if (!isEditing) {
        targetBatchId = await createVideoBatch({
          title: title.trim(),
          videos: baseVideos,
          institutionId,
          departmentId,
          mbbsYear,
          audience,
          memberIds,
          startAt,
          endAt,
          createdBy: appUser.uid,
          createdAt: Date.now(),
        })
        createdBatchId = targetBatchId
      }

      // Any brand-new upload item and/or any item (new or existing) with a
      // freshly-picked thumbnail needs a Storage round-trip — this
      // condition, and the key-matching below, works identically for
      // create and edit since an existing item's `key` always equals its
      // persisted BatchVideoItem.id.
      const itemsNeedingUpload = videoItems.filter((it) => (!it.existingVideo && it.sourceType === 'upload') || it.thumbnailFile)
      if (itemsNeedingUpload.length > 0) {
        const resolved = await Promise.all(
          itemsNeedingUpload.map(async (it) => {
            const patch: { key: string; url?: string; storagePath?: string; thumbnailUrl?: string; thumbnailStoragePath?: string } = { key: it.key }
            if (!it.existingVideo && it.sourceType === 'upload') {
              const path = `videoBatches/${targetBatchId}/${it.key}/${it.uploadFile!.name}`
              const fileRef = storageRef(storage, path)
              const task = uploadBytesResumable(fileRef, it.uploadFile!)
              await new Promise<void>((resolve, reject) => {
                task.on(
                  'state_changed',
                  (snap) => setUploadProgress((prev) => ({ ...prev, [it.key]: snap.totalBytes ? snap.bytesTransferred / snap.totalBytes : 0 })),
                  reject,
                  () => resolve(),
                )
              })
              uploadedPaths.push(path)
              patch.url = await getDownloadURL(fileRef)
              patch.storagePath = path
            }
            if (it.thumbnailFile) {
              const thumbPath = `videoBatches/${targetBatchId}/${it.key}/thumbnail`
              const thumbRef = storageRef(storage, thumbPath)
              await uploadBytes(thumbRef, it.thumbnailFile)
              // An existing video's thumbnail is overwritten in place — the
              // saved batch still points at it, so never roll that back.
              if (!it.existingVideo) uploadedPaths.push(thumbPath)
              patch.thumbnailUrl = await getDownloadURL(thumbRef)
              patch.thumbnailStoragePath = thumbPath
            }
            return patch
          }),
        )
        baseVideos = baseVideos.map((v) => {
          const match = resolved.find((r) => r.key === v.id)
          if (!match) return v
          return {
            ...v,
            url: match.url ?? v.url,
            storagePath: match.storagePath ?? v.storagePath,
            thumbnailUrl: match.thumbnailUrl ?? v.thumbnailUrl,
            thumbnailStoragePath: match.thumbnailStoragePath ?? v.thumbnailStoragePath,
          }
        })
      }

      if (isEditing) {
        await updateVideoBatch(targetBatchId, {
          title: title.trim(),
          videos: baseVideos,
          institutionId,
          departmentId,
          mbbsYear,
          audience,
          memberIds,
          startAt,
          endAt,
        })
      } else if (itemsNeedingUpload.length > 0) {
        await updateVideoBatch(targetBatchId, { videos: baseVideos })
      }

      // Only after the batch is saved without them: delete removed videos'
      // files and removed thumbnails (deleting first left the batch
      // pointing at missing files whenever the save then failed).
      if (isEditing) {
        await Promise.all(removedExistingVideos.map((v) => deleteVideoItemFiles(v)))
        await Promise.all(
          videoItems
            .filter((it) => it.existingVideo && it.thumbnailRemoved && !it.thumbnailFile && it.existingVideo.thumbnailStoragePath)
            .map((it) => deleteObject(storageRef(storage, it.existingVideo!.thumbnailStoragePath!)).catch(() => {})),
        )
      }

      navigate('/admin/video-tutorials?tab=batches')
    } catch {
      // A new batch whose upload failed would otherwise be left with broken,
      // empty-link videos — remove it and whatever was uploaded.
      await Promise.all(uploadedPaths.map((p) => deleteObject(storageRef(storage, p)).catch(() => {})))
      if (createdBatchId) await deleteVideoBatch(createdBatchId).catch(() => {})
      setError('Upload failed. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  const pageLoading = isEditing && (batchLoading || !loaded)
  const notFound = isEditing && !batchLoading && !existingBatch

  return (
    <PrimaryAdminShell
      eyebrow="Content · Video tutorials"
      title={isEditing ? 'Edit batch' : 'New batch'}
      actions={
        !pageLoading && !notFound ? (
          <div className="flex items-center gap-2">
            <GhostButton onClick={() => navigate('/admin/video-tutorials?tab=batches')}>Cancel</GhostButton>
            <PrimaryButton onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create batch'}
            </PrimaryButton>
          </div>
        ) : undefined
      }
    >
      <div className="max-w-3xl mx-auto">
        <button
          onClick={() => navigate('/admin/video-tutorials?tab=batches')}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium mb-5 hover:opacity-70 transition-opacity"
          style={{ color: 'var(--color-char-soft)' }}
        >
          <Icon name="chevron" className="h-3 w-3 rotate-180" />
          All batches
        </button>

        {pageLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        ) : notFound ? (
          <div className="rounded-[10px] border p-5" style={{ backgroundColor: 'var(--color-paper)', borderColor: BORDER }}>
            <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
              This batch doesn't exist or you don't have access to it.
            </p>
          </div>
        ) : (
          <>
            <StepHeader step="01" title="Batch details" hint="Name it, then pick the college, department, year and audience it's for." />
            <div className="rounded-[10px] border p-5 mb-9" style={{ backgroundColor: 'var(--color-paper)', borderColor: BORDER }}>
              <label className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                Batch name
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Dermatology Year 2 — Nov batch"
                className="w-full font-display text-[20px] outline-none bg-transparent pb-4 mb-5 border-b"
                style={{ color: 'var(--color-char)', borderColor: BORDER }}
              />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-5">
                <div>
                  <label className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                    College
                  </label>
                  <select
                    value={institutionId}
                    onChange={(e) => {
                      setInstitutionId(e.target.value)
                      setDepartmentId('')
                    }}
                    className="w-full h-10 px-3 text-[13.5px] rounded-[6px] border bg-transparent"
                    style={inputStyle()}
                  >
                    <option value="">Choose…</option>
                    {institutions.map((inst) => (
                      <option key={inst.id} value={inst.id}>
                        {inst.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                    Course / Year
                  </label>
                  <select
                    value={mbbsYear}
                    onChange={(e) => {
                      setMbbsYear(Number(e.target.value) as MbbsYear)
                      if (audience === 'student') setDepartmentId('')
                    }}
                    className="w-full h-10 px-3 text-[13.5px] rounded-[6px] border bg-transparent"
                    style={inputStyle()}
                  >
                    {MBBS_YEARS.map((y) => (
                      <option key={y} value={y}>
                        Year {y}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                    Audience
                  </label>
                  <Segmented
                    value={audience}
                    onChange={(a) => {
                      setAudience(a)
                      setDepartmentId('')
                    }}
                    options={(['student', 'faculty'] as VideoAudience[]).map((a) => ({ v: a, label: AUDIENCE_LABELS[a] }))}
                  />
                </div>
              </div>

              <label className="font-display block mb-2 text-[11.5px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                Departments
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <ReachOption
                  selected={reach === 'all'}
                  onClick={() => {
                    setReach('all')
                    setDepartmentId('')
                  }}
                  title="All departments"
                  hint={audience === 'student' ? `Pick from every Year ${mbbsYear} student of the college` : 'Pick from the college’s faculty in every department'}
                />
                <ReachOption
                  selected={reach === 'one'}
                  onClick={() => setReach('one')}
                  title="Specific department"
                  hint={audience === 'student' ? `One Year ${mbbsYear} department’s students` : 'Only that department’s faculty'}
                />
              </div>
              {reach === 'one' && (
                <div className="mt-3">
                  <select
                    value={departmentId}
                    onChange={(e) => setDepartmentId(e.target.value)}
                    disabled={!institutionId}
                    className="w-full h-10 px-3 text-[13.5px] rounded-[6px] border bg-transparent disabled:opacity-50"
                    style={inputStyle()}
                  >
                    <option value="">{institutionId ? 'Choose a department…' : 'Pick a college first'}</option>
                    {departmentOptions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                        {audience === 'faculty' ? ` · Year ${d.mbbsYear}` : ''}
                      </option>
                    ))}
                  </select>
                  {institutionId && departmentOptions.length === 0 && (
                    <p className="mt-1.5 text-[12px]" style={{ color: 'var(--color-clay)' }}>
                      No departments enabled for this college{audience === 'student' ? ` in Year ${mbbsYear}` : ''} — use All departments.
                    </p>
                  )}
                </div>
              )}
            </div>

            <StepHeader step="02" title="The videos" hint="Upload files or paste links — these videos belong only to this batch." />
            <div className="space-y-4 mb-5">
              {videoItems.map((item, index) => {
                const preview = draftPreview(item)
                const showExistingThumbnail = !item.thumbnailFile && !item.thumbnailRemoved && item.existingVideo?.thumbnailUrl
                const canRemoveThumbnail = Boolean(item.thumbnailFile) || Boolean(showExistingThumbnail)
                return (
                  <div key={item.key} className="rounded-[10px] border p-5" style={{ backgroundColor: 'var(--color-paper)', borderColor: BORDER }}>
                    <div className="flex items-center justify-between mb-4">
                      <span className="font-mono text-[11px] tracking-[0.1em] uppercase" style={{ color: 'var(--color-char-soft)' }}>
                        Video {index + 1}
                      </span>
                      {videoItems.length > 1 && (
                        <button
                          onClick={() => removeVideoItem(item.key)}
                          className="h-6 w-6 flex items-center justify-center rounded-[3px] hover:bg-black/[0.06]"
                          title="Remove this video"
                          style={{ color: 'var(--color-char-soft)' }}
                        >
                          <Icon name="trash" className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>

                    {item.existingVideo ? (
                      <p className="text-[12px] mb-4" style={{ color: 'var(--color-char-soft)' }}>
                        {item.existingVideo.source === 'upload' ? 'Uploaded video' : 'Linked video'} — to change the video
                        itself, remove this and add a new one.
                      </p>
                    ) : (
                      <div className="mb-4">
                        <span className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                          Video source
                        </span>
                        <div className="inline-flex border rounded-[6px] overflow-hidden" style={{ borderColor: 'var(--color-line)' }}>
                          <button
                            type="button"
                            onClick={() => updateVideoItem(item.key, { sourceType: 'upload' })}
                            className="px-4 py-2 text-[12.5px] font-medium transition-colors"
                            style={{
                              backgroundColor: item.sourceType === 'upload' ? 'var(--color-ink)' : 'transparent',
                              color: item.sourceType === 'upload' ? 'var(--color-frost)' : 'var(--color-char-soft)',
                            }}
                          >
                            Upload file
                          </button>
                          <button
                            type="button"
                            onClick={() => updateVideoItem(item.key, { sourceType: 'link' })}
                            className="px-4 py-2 text-[12.5px] font-medium transition-colors border-l"
                            style={{
                              borderColor: 'var(--color-line)',
                              backgroundColor: item.sourceType === 'link' ? 'var(--color-ink)' : 'transparent',
                              color: item.sourceType === 'link' ? 'var(--color-frost)' : 'var(--color-char-soft)',
                            }}
                          >
                            External link
                          </button>
                        </div>
                      </div>
                    )}

                    {item.sourceType === 'link' ? (
                      <div className="mb-4">
                        <label className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                          Video link
                        </label>
                        <input
                          value={item.linkUrl}
                          onChange={(e) => updateVideoItem(item.key, { linkUrl: e.target.value })}
                          placeholder="YouTube, Vimeo, Google Drive, or a direct video URL"
                          className="w-full h-10 px-3 text-[13.5px] rounded-[6px] border bg-transparent"
                          style={inputStyle()}
                        />
                        {item.linkUrl.trim() && (
                          <p className="mt-1.5 text-[12px]" style={{ color: 'var(--color-gold)' }}>
                            {recognizedSourceLabel(item.linkUrl)}
                          </p>
                        )}
                      </div>
                    ) : !item.existingVideo ? (
                      <div className="mb-4">
                        <label className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                          Video file
                        </label>
                        <FileAttachControl
                          accept="video/*"
                          file={item.uploadFile}
                          onChange={(file) => setVideoItemFile(item.key, file)}
                          label="Choose a video file"
                          hint="Max 500MB"
                        />
                        {saving && item.sourceType === 'upload' && item.key in uploadProgress && (
                          <div className="mt-2">
                            <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-line)' }}>
                              <div
                                className="h-full transition-all duration-200"
                                style={{ width: `${Math.round((uploadProgress[item.key] ?? 0) * 100)}%`, backgroundColor: 'var(--color-gold)' }}
                              />
                            </div>
                            <p className="mt-1 text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
                              Uploading… {Math.round((uploadProgress[item.key] ?? 0) * 100)}%
                            </p>
                          </div>
                        )}
                      </div>
                    ) : null}

                    <label className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                      Video title
                    </label>
                    <input
                      value={item.title}
                      onChange={(e) => updateVideoItem(item.key, { title: e.target.value })}
                      placeholder="e.g. Suturing Technique — Advanced"
                      className="w-full h-10 px-3 mb-4 text-[13.5px] rounded-[6px] border bg-transparent"
                      style={inputStyle()}
                    />
                    <label className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                      Description (optional)
                    </label>
                    <textarea
                      value={item.description}
                      onChange={(e) => updateVideoItem(item.key, { description: e.target.value })}
                      rows={2}
                      placeholder="What this video covers"
                      className="w-full px-3 py-2 mb-4 text-[13.5px] rounded-[6px] border bg-transparent resize-none"
                      style={inputStyle()}
                    />

                    <label className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                      Thumbnail image (optional)
                    </label>
                    <div className="flex items-start gap-3 mb-4">
                      <div
                        className="shrink-0 rounded-[8px] overflow-hidden border flex items-center justify-center"
                        style={{ width: 92, height: 52, borderColor: 'var(--color-line)', backgroundColor: 'var(--color-ink)' }}
                      >
                        {item.thumbnailPreviewUrl ? (
                          <img src={item.thumbnailPreviewUrl} alt="" className="w-full h-full" style={{ objectFit: 'cover' }} />
                        ) : showExistingThumbnail ? (
                          <img src={item.existingVideo!.thumbnailUrl!} alt="" className="w-full h-full" style={{ objectFit: 'cover' }} />
                        ) : (
                          <Icon name="play" className="h-4 w-4" style={{ color: 'var(--color-gold)' }} />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <FileAttachControl
                          accept="image/*"
                          file={item.thumbnailFile}
                          onChange={(file) => setVideoItemThumbnail(item.key, file)}
                          label="Choose thumbnail image"
                          hint="Overrides the automatic thumbnail"
                        />
                        {canRemoveThumbnail && (
                          <button
                            onClick={() =>
                              item.thumbnailFile ? setVideoItemThumbnail(item.key, null) : updateVideoItem(item.key, { thumbnailRemoved: true })
                            }
                            className="mt-1.5 text-[11.5px] font-medium hover:opacity-70 transition-opacity"
                            style={{ color: 'var(--color-clay)' }}
                          >
                            Remove thumbnail
                          </button>
                        )}
                      </div>
                    </div>

                    {preview && (
                      <div className="flex items-center gap-3 pt-2" style={{ borderTop: `1px solid ${BORDER}` }}>
                        <div className="relative shrink-0 w-24 h-14 rounded-[6px] overflow-hidden" style={{ backgroundColor: 'var(--color-ink)' }}>
                          <VideoThumbnail video={preview} className="absolute inset-0 w-full h-full" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13.5px] truncate" style={{ color: 'var(--color-char)' }}>
                            {preview.title}
                          </div>
                          <GhostButton onClick={() => setPreviewKey(item.key)}>
                            <Icon name="play" className="h-3 w-3" />
                            Preview
                          </GhostButton>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

              <button
                onClick={addVideoItem}
                className="w-full flex items-center justify-center gap-1.5 py-3 rounded-[8px] border border-dashed text-[13px] font-medium transition-colors hover:bg-black/[0.02]"
                style={{ borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)' }}
              >
                <Icon name="plus" className="h-3.5 w-3.5" />
                Add another video
              </button>
            </div>

            <StepHeader step="03" title="Members" hint="Pick by hand, paste register numbers, or select a register range." />
            <div className="rounded-[10px] border p-5 mb-9" style={{ backgroundColor: 'var(--color-paper)', borderColor: BORDER }}>
              {!institutionId || !departmentChosen ? (
                <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
                  Pick a college, department and year in Step 01 to see who's available.
                </p>
              ) : candidates.length === 0 ? (
                <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
                  No active {AUDIENCE_LABELS[audience].toLowerCase()} match that college/department/year.
                </p>
              ) : (
                <BatchMemberPicker
                  candidates={candidates}
                  memberIds={memberIds}
                  setMemberIds={setMemberIds}
                  audienceLabel={AUDIENCE_LABELS[audience]}
                />
              )}
            </div>

            <StepHeader step="04" title="Schedule" hint="Opens and closes itself — no one needs to remove it by hand." />
            <div className="rounded-[10px] border p-5 mb-9" style={{ backgroundColor: 'var(--color-paper)', borderColor: BORDER }}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                    Starts
                  </label>
                  <input
                    type="datetime-local"
                    value={startLocal}
                    onChange={(e) => setStartLocal(e.target.value)}
                    className="w-full h-10 px-3 text-[13.5px] rounded-[6px] border bg-transparent"
                    style={inputStyle()}
                  />
                  {startLocal && !Number.isNaN(new Date(startLocal).getTime()) && (
                    <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
                      Opens {new Date(startLocal).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </p>
                  )}
                </div>
                <div>
                  <label className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                    Closes
                  </label>
                  <input
                    type="datetime-local"
                    value={endLocal}
                    onChange={(e) => setEndLocal(e.target.value)}
                    className="w-full h-10 px-3 text-[13.5px] rounded-[6px] border bg-transparent"
                    style={inputStyle()}
                  />
                  {endLocal && !Number.isNaN(new Date(endLocal).getTime()) && (
                    <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
                      Closes {new Date(endLocal).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {readyVideoCount > 0 && (
              <div className="flex items-center gap-2 mb-5 text-[12.5px]" style={{ color: 'var(--color-char-soft)' }}>
                <Icon name="play" className="h-3.5 w-3.5" style={{ color: 'var(--color-gold)' }} />
                Granting <span style={{ color: 'var(--color-char)' }}>{readyVideoCount} video{readyVideoCount === 1 ? '' : 's'}</span> to{' '}
                {memberIds.length} {AUDIENCE_LABELS[audience].toLowerCase()}
              </div>
            )}

            {error && (
              <p className="text-[13px] mb-5" style={{ color: 'var(--color-clay)' }}>
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pb-10">
              <GhostButton onClick={() => navigate('/admin/video-tutorials?tab=batches')}>Cancel</GhostButton>
              <PrimaryButton onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create batch'}
              </PrimaryButton>
            </div>
          </>
        )}
      </div>

      {previewVideo && <VideoPreviewModal video={previewVideo} onClose={() => setPreviewKey(null)} />}
    </PrimaryAdminShell>
  )
}

function ReachOption({ selected, onClick, title, hint }: { selected: boolean; onClick: () => void; title: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-[8px] border px-4 py-3 transition-colors flex items-start gap-3"
      style={{
        borderColor: selected ? 'var(--color-gold)' : 'var(--color-line)',
        backgroundColor: selected ? 'color-mix(in srgb, var(--color-gold) 8%, transparent)' : 'transparent',
      }}
    >
      <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border flex items-center justify-center" style={{ borderColor: selected ? 'var(--color-gold)' : 'var(--color-line)' }}>
        {selected && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--color-gold)' }} />}
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium" style={{ color: 'var(--color-char)' }}>
          {title}
        </span>
        <span className="block text-[12px] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
          {hint}
        </span>
      </span>
    </button>
  )
}
