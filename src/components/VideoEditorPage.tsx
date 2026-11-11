import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes, uploadBytesResumable } from 'firebase/storage'
import { useAuth } from '../auth/AuthContext'
import { storage } from '../lib/firebase'
import { GhostButton, PrimaryButton, Skeleton, Badge } from '../roles/primary-admin/shell/ui'
import { Icon } from '../roles/primary-admin/shell/Icon'
import {
  AUDIENCE_LABELS,
  FileAttachControl,
  MAX_UPLOAD_BYTES,
  Segmented,
  ToggleSwitch,
  VideoPreviewModal,
  VideoThumbnail,
  reachSummary,
  recognizedSourceLabel,
  toggleLabel,
  videoScopeLabel,
} from '../roles/primary-admin/shell/VideoShared'
import {
  ALL_DEPARTMENTS,
  createVideoTutorial,
  deleteVideoTutorial,
  isVideoActive,
  updateVideoTutorial,
  watchVideoTutorial,
} from '../lib/firestore/videoTutorials'
import { watchCatalogDepartments, watchInstitutionDepartments, watchInstitutionDepartmentOverrides } from '../lib/firestore/departments'
import { MBBS_YEARS } from '../lib/academicStructure'
import type { Department, InstitutionDepartmentOverride, MbbsYear, VideoAudience, VideoPreviewable, VideoSource, VideoTutorial } from '../types'

type ShellProps = { eyebrow?: string; title: string; actions?: ReactNode; children: ReactNode }

// Same "merges with the page, defined by its border" treatment the batch
// page and FormEditorPage/CompetencyEditorPage use.
const BORDER = 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)'
const CARD_STYLE = { backgroundColor: 'var(--color-paper)', borderColor: BORDER }
const LABEL = 'font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]'
const INPUT = 'w-full h-10 px-3 text-[13.5px] rounded-[6px] border bg-transparent'
const INPUT_STYLE = { borderColor: 'var(--color-line)', color: 'var(--color-char)' }

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

function Label({ children }: { children: ReactNode }) {
  return (
    <span className={LABEL} style={{ color: 'var(--color-char-soft)' }}>
      {children}
    </span>
  )
}

// Full-page create/edit for a catalog or college video — replaces the old
// VideoFormModal, which outgrew a modal. Role-agnostic like
// SubmissionReviewPage: the caller supplies the Shell, which college the
// video belongs to ('' = platform catalog) and where Back/Cancel/Save go.
// Edit mode is driven by a `:videoId` route param.
export function VideoEditorPage({
  Shell,
  institutionId,
  backTo,
  backLabel,
}: {
  Shell: ComponentType<ShellProps>
  institutionId: string
  backTo: string
  backLabel: string
}) {
  const { appUser } = useAuth()
  const navigate = useNavigate()
  const { videoId } = useParams<{ videoId: string }>()
  const isEditing = !!videoId

  // --- Existing video (edit mode), hydrated once ---------------------------
  const [existing, setExisting] = useState<VideoTutorial | null | undefined>(undefined)
  useEffect(() => {
    if (!videoId) return
    return watchVideoTutorial(videoId, setExisting)
  }, [videoId])

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [sourceType, setSourceType] = useState<VideoSource>('upload')
  const [linkUrl, setLinkUrl] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null)
  const [thumbnailRemoved, setThumbnailRemoved] = useState(false)
  const [audience, setAudience] = useState<VideoAudience>('student')
  const [reach, setReach] = useState<'all' | 'one'>('all')
  const [department, setDepartment] = useState('')
  const [mbbsYear, setMbbsYear] = useState<MbbsYear>(1)
  const [active, setActive] = useState(true)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (loaded || !existing) return
    setTitle(existing.title)
    setDescription(existing.description)
    setSourceType(existing.source)
    setLinkUrl(existing.source === 'link' ? existing.url : '')
    setAudience(existing.audience)
    setReach(existing.department === ALL_DEPARTMENTS ? 'all' : 'one')
    setDepartment(existing.department)
    setMbbsYear(existing.mbbsYear)
    setActive(isVideoActive(existing))
    setLoaded(true)
  }, [existing, loaded])

  // --- Departments that can be targeted ------------------------------------
  // Catalog video: the shared department catalog. College video: catalog +
  // the college's own, minus anything switched off for that college.
  const [catalogDepts, setCatalogDepts] = useState<Department[]>([])
  const [ownDepts, setOwnDepts] = useState<Department[]>([])
  const [overrides, setOverrides] = useState<InstitutionDepartmentOverride[]>([])
  useEffect(() => watchCatalogDepartments(setCatalogDepts), [])
  useEffect(() => {
    if (!institutionId) return
    const a = watchInstitutionDepartments(institutionId, setOwnDepts)
    const b = watchInstitutionDepartmentOverrides(institutionId, setOverrides)
    return () => {
      a()
      b()
    }
  }, [institutionId])

  // Students: only departments of the chosen year (a department belongs to
  // one year). Faculty: any department.
  const departmentOptions = useMemo(() => {
    const disabled = new Set(overrides.filter((o) => !o.enabled).map((o) => o.departmentId))
    const pool = [...catalogDepts, ...(institutionId ? ownDepts : [])].filter((d) => !disabled.has(d.id))
    const names = new Set(pool.filter((d) => audience === 'faculty' || d.mbbsYear === mbbsYear).map((d) => d.name))
    if (department) names.add(department) // keep an existing pick visible
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [catalogDepts, ownDepts, overrides, institutionId, audience, mbbsYear, department])

  // Changing audience/year can make the picked department meaningless —
  // clear it on the user's change (not in an effect, so hydration is safe).
  function changeAudience(a: VideoAudience) {
    setAudience(a)
    setDepartment('')
  }
  function changeYear(y: MbbsYear) {
    setMbbsYear(y)
    setDepartment('')
  }

  // --- Local previews (object URLs, revoked on change) ---------------------
  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!uploadFile) {
      setUploadPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(uploadFile)
    setUploadPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [uploadFile])
  const [thumbnailPreviewUrl, setThumbnailPreviewUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!thumbnailFile) {
      setThumbnailPreviewUrl(null)
      return
    }
    const url = URL.createObjectURL(thumbnailFile)
    setThumbnailPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [thumbnailFile])

  const existingThumbnail = existing && !thumbnailRemoved ? existing.thumbnailUrl : null
  const shownThumbnail = thumbnailPreviewUrl ?? existingThumbnail
  const publishedDepartment = reach === 'all' ? ALL_DEPARTMENTS : department

  const videoUrl = isEditing
    ? sourceType === 'link'
      ? linkUrl.trim()
      : existing?.url ?? ''
    : sourceType === 'link'
      ? linkUrl.trim()
      : uploadPreviewUrl ?? ''
  const preview: VideoPreviewable = {
    title: title.trim() || 'Untitled video',
    description: description.trim(),
    department: publishedDepartment,
    mbbsYear,
    audience,
    source: sourceType,
    url: videoUrl,
    thumbnailUrl: shownThumbnail,
  }
  const [previewOpen, setPreviewOpen] = useState(false)

  // --- Save -----------------------------------------------------------------
  const [saving, setSaving] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [formError, setFormError] = useState('')

  const missing: string[] = []
  if (!isEditing && sourceType === 'upload' && !uploadFile) missing.push('a video file')
  if (sourceType === 'link' && !linkUrl.trim()) missing.push('a video link')
  if (!title.trim()) missing.push('a title')
  if (reach === 'one' && !department) missing.push('a department')
  const canSave = missing.length === 0 && !saving

  async function uploadThumbnail(id: string): Promise<Partial<VideoTutorial>> {
    if (!thumbnailFile) return {}
    const path = `videoTutorials/${id}/thumbnail`
    const fileRef = storageRef(storage, path)
    await uploadBytes(fileRef, thumbnailFile)
    return { thumbnailUrl: await getDownloadURL(fileRef), thumbnailStoragePath: path }
  }

  async function handleSave() {
    if (!canSave) return
    setFormError('')
    if (!isEditing && sourceType === 'upload' && uploadFile && uploadFile.size > MAX_UPLOAD_BYTES) {
      setFormError(`That file is too large (max ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB).`)
      return
    }
    setSaving(true)
    setUploadProgress(0)
    let createdId: string | null = null
    try {
      if (isEditing && existing) {
        const patch: Partial<VideoTutorial> = {
          title: title.trim(),
          description: description.trim(),
          department: publishedDepartment,
          mbbsYear,
          audience,
          active,
        }
        if (existing.source === 'link') patch.url = linkUrl.trim()
        const dropThumbnail = !thumbnailFile && thumbnailRemoved && existing.thumbnailStoragePath
        if (thumbnailFile) {
          Object.assign(patch, await uploadThumbnail(existing.id))
        } else if (dropThumbnail) {
          patch.thumbnailUrl = null
          patch.thumbnailStoragePath = null
        }
        await updateVideoTutorial(existing.id, patch)
        // Delete the old file only once the doc no longer points at it.
        if (dropThumbnail) await deleteObject(storageRef(storage, existing.thumbnailStoragePath!)).catch(() => {})
      } else {
        createdId = await createVideoTutorial({
          title: title.trim(),
          description: description.trim(),
          source: sourceType,
          url: sourceType === 'link' ? linkUrl.trim() : '',
          storagePath: null,
          thumbnailUrl: null,
          thumbnailStoragePath: null,
          institutionId,
          department: publishedDepartment,
          mbbsYear,
          audience,
          active,
          createdBy: appUser?.uid ?? '',
          createdAt: Date.now(),
        })
        const id = createdId
        const patch: Partial<VideoTutorial> = {}
        if (sourceType === 'upload' && uploadFile) {
          const path = `videoTutorials/${id}/${uploadFile.name}`
          const fileRef = storageRef(storage, path)
          const task = uploadBytesResumable(fileRef, uploadFile)
          await new Promise<void>((resolve, reject) => {
            task.on('state_changed', (snap) => setUploadProgress(snap.totalBytes ? snap.bytesTransferred / snap.totalBytes : 0), reject, () => resolve())
          })
          patch.url = await getDownloadURL(fileRef)
          patch.storagePath = path
        }
        Object.assign(patch, await uploadThumbnail(id))
        if (Object.keys(patch).length > 0) await updateVideoTutorial(id, patch)
      }
      navigate(backTo)
    } catch {
      // A new video whose upload failed would otherwise stay behind as a
      // broken entry with an empty link — remove it and anything uploaded.
      if (createdId) {
        const files = [`videoTutorials/${createdId}/thumbnail`, ...(uploadFile ? [`videoTutorials/${createdId}/${uploadFile.name}`] : [])]
        await Promise.all(files.map((f) => deleteObject(storageRef(storage, f)).catch(() => {})))
        await deleteVideoTutorial(createdId).catch(() => {})
      }
      setSaving(false)
      setFormError('Saving failed — check your connection and try again.')
    }
  }

  const pageLoading = isEditing && (existing === undefined || (existing !== null && !loaded))
  const notFound = isEditing && existing === null
  const saveLabel = saving ? (sourceType === 'upload' && !isEditing ? 'Uploading…' : 'Saving…') : isEditing ? 'Save changes' : 'Publish video'

  return (
    <Shell
      eyebrow="Content · Video tutorials"
      title={isEditing ? 'Edit video' : 'New video'}
      actions={
        !pageLoading && !notFound ? (
          <div className="flex items-center gap-2">
            <GhostButton onClick={() => navigate(backTo)}>Cancel</GhostButton>
            <PrimaryButton onClick={handleSave} disabled={!canSave}>
              {saveLabel}
            </PrimaryButton>
          </div>
        ) : undefined
      }
    >
      <div className="max-w-[1080px] mx-auto">
        <button
          onClick={() => navigate(backTo)}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium mb-5 hover:opacity-70 transition-opacity"
          style={{ color: 'var(--color-char-soft)' }}
        >
          <Icon name="chevron" className="h-3 w-3 rotate-180" />
          {backLabel}
        </button>

        {pageLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-40" />
          </div>
        ) : notFound ? (
          <div className="rounded-[10px] border p-5" style={CARD_STYLE}>
            <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
              This video doesn't exist or you don't have access to it.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-8 items-start">
            {/* ---------------- Form column ---------------- */}
            <div className="min-w-0">
              <StepHeader step="01" title="The video" hint="Upload a file or paste a link, then name it." />
              <div className="rounded-[10px] border p-5 mb-9" style={CARD_STYLE}>
                {isEditing ? (
                  <p className="text-[12.5px] mb-5 px-3 py-2 rounded-[6px]" style={{ color: 'var(--color-char-soft)', backgroundColor: 'color-mix(in srgb, var(--color-gold) 8%, transparent)' }}>
                    {sourceType === 'upload'
                      ? 'Uploaded video — the file itself can’t be swapped. To replace it, delete this video and add a new one.'
                      : 'Linked video — you can update the link below.'}
                  </p>
                ) : (
                  <div className="mb-5">
                    <Label>Video source</Label>
                    <Segmented
                      value={sourceType}
                      onChange={setSourceType}
                      options={[
                        { v: 'upload', label: 'Upload file' },
                        { v: 'link', label: 'External link' },
                      ]}
                    />
                  </div>
                )}

                {sourceType === 'link' ? (
                  <div className="mb-5">
                    <Label>Video link</Label>
                    <input
                      value={linkUrl}
                      onChange={(e) => setLinkUrl(e.target.value)}
                      placeholder="YouTube, Vimeo, Google Drive, or a direct video URL"
                      className={INPUT}
                      style={INPUT_STYLE}
                    />
                    {linkUrl.trim() && (
                      <p className="mt-1.5 text-[12px]" style={{ color: 'var(--color-gold)' }}>
                        {recognizedSourceLabel(linkUrl)}
                      </p>
                    )}
                  </div>
                ) : !isEditing ? (
                  <div className="mb-5">
                    <Label>Video file</Label>
                    <FileAttachControl accept="video/*" file={uploadFile} onChange={setUploadFile} label="Choose a video file" hint="Max 500MB" />
                    {saving && (
                      <div className="mt-2">
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-line)' }}>
                          <div className="h-full transition-all duration-200" style={{ width: `${Math.round(uploadProgress * 100)}%`, backgroundColor: 'var(--color-gold)' }} />
                        </div>
                        <p className="mt-1 text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
                          Uploading… {Math.round(uploadProgress * 100)}%
                        </p>
                      </div>
                    )}
                  </div>
                ) : null}

                <div className="mb-5">
                  <Label>Title</Label>
                  <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Aseptic Technique — Basics" className={INPUT} style={INPUT_STYLE} />
                </div>
                <div className="mb-5">
                  <Label>Description (optional)</Label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                    placeholder="What this video covers"
                    className="w-full px-3 py-2 text-[13.5px] rounded-[6px] border bg-transparent resize-none"
                    style={INPUT_STYLE}
                  />
                </div>
                <div>
                  <Label>Thumbnail image (optional)</Label>
                  <FileAttachControl accept="image/*" file={thumbnailFile} onChange={setThumbnailFile} label="Choose thumbnail image" hint="Overrides the automatic thumbnail" />
                  {existingThumbnail && !thumbnailFile && (
                    <button onClick={() => setThumbnailRemoved(true)} className="mt-1.5 text-[11.5px] font-medium hover:opacity-70 transition-opacity" style={{ color: 'var(--color-clay)' }}>
                      Remove current thumbnail
                    </button>
                  )}
                </div>
              </div>

              <StepHeader step="02" title="Who it's for" hint="Everyone in the audience, or one department." />
              <div className="rounded-[10px] border p-5 mb-9" style={CARD_STYLE}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-5">
                  <div>
                    <Label>Audience</Label>
                    <Segmented value={audience} onChange={changeAudience} options={(['student', 'faculty'] as VideoAudience[]).map((a) => ({ v: a, label: AUDIENCE_LABELS[a] }))} />
                  </div>
                  {audience === 'student' ? (
                    <div>
                      <Label>MBBS year</Label>
                      <select value={mbbsYear} onChange={(e) => changeYear(Number(e.target.value) as MbbsYear)} className={INPUT} style={INPUT_STYLE}>
                        {MBBS_YEARS.map((y) => (
                          <option key={y} value={y}>
                            Year {y}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="text-[12px] leading-relaxed sm:pt-6" style={{ color: 'var(--color-char-soft)' }}>
                      Faculty videos aren't tied to a year — every faculty member it reaches sees it.
                    </div>
                  )}
                </div>

                <Label>Departments</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <ReachOption
                    selected={reach === 'all'}
                    onClick={() => setReach('all')}
                    title="All departments"
                    hint={audience === 'student' ? `Every Year ${mbbsYear} student, whatever their department` : 'Every faculty member and HOD'}
                  />
                  <ReachOption
                    selected={reach === 'one'}
                    onClick={() => setReach('one')}
                    title="Specific department"
                    hint={audience === 'student' ? 'Only students who have that department' : 'Only that department’s faculty and HOD'}
                  />
                </div>
                {reach === 'one' && (
                  <div className="mt-4">
                    <select
                      value={department}
                      onChange={(e) => setDepartment(e.target.value)}
                      className={INPUT}
                      style={{ ...INPUT_STYLE, color: department ? 'var(--color-char)' : 'var(--color-char-soft)' }}
                    >
                      <option value="" disabled>
                        Select a department
                      </option>
                      {departmentOptions.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                    {departmentOptions.length === 0 && (
                      <p className="mt-1.5 text-[12px]" style={{ color: 'var(--color-clay)' }}>
                        No departments {audience === 'student' ? `in Year ${mbbsYear}` : ''} yet — add one first, or publish to all departments.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <StepHeader step="03" title="Visibility" hint="Turn it off any time without deleting it." />
              <div className="rounded-[10px] border p-5 mb-9 flex items-center justify-between gap-4" style={CARD_STYLE}>
                <div className="min-w-0">
                  <div className="font-display text-[16px]" style={{ color: 'var(--color-char)' }}>
                    {active ? 'Enabled' : 'Disabled'}
                  </div>
                  <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
                    {active ? 'Visible to everyone it reaches as soon as it’s saved.' : 'Hidden from everyone — it stays in your list so you can switch it back on.'}
                  </div>
                </div>
                <ToggleSwitch on={active} onChange={() => setActive((a) => !a)} label={toggleLabel('publish', active)} />
              </div>

              {formError && (
                <p className="text-[12.5px] mb-3" style={{ color: 'var(--color-clay)' }}>
                  {formError}
                </p>
              )}
              <div className="flex items-center justify-end gap-3 flex-wrap pb-6">
                {missing.length > 0 && (
                  <span className="text-[12px] mr-auto" style={{ color: 'var(--color-char-soft)' }}>
                    Still needed: {missing.join(', ')}
                  </span>
                )}
                <GhostButton onClick={() => navigate(backTo)}>Cancel</GhostButton>
                <PrimaryButton onClick={handleSave} disabled={!canSave}>
                  {saveLabel}
                </PrimaryButton>
              </div>
            </div>

            {/* ---------------- Live preview column ---------------- */}
            <aside className="lg:sticky lg:top-0">
              <div className="font-mono text-[11px] tracking-[0.14em] uppercase mb-3" style={{ color: 'var(--color-gold)' }}>
                Live preview
              </div>
              <div className="rounded-[10px] border overflow-hidden" style={CARD_STYLE}>
                <button
                  onClick={() => preview.url && setPreviewOpen(true)}
                  disabled={!preview.url}
                  className="group relative w-full block"
                  style={{ aspectRatio: '16 / 9', backgroundColor: 'var(--color-ink)' }}
                >
                  {preview.url || preview.thumbnailUrl ? (
                    <VideoThumbnail video={preview} className="absolute inset-0 w-full h-full" />
                  ) : (
                    <span className="absolute inset-0 flex flex-col items-center justify-center gap-2" style={{ color: 'var(--color-char-soft)' }}>
                      <Icon name="play" className="h-5 w-5" style={{ color: 'var(--color-gold)' }} />
                      <span className="text-[11.5px]">Add a file or link to preview</span>
                    </span>
                  )}
                  {preview.url && (
                    <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 30%, transparent)' }}>
                      <span className="h-10 w-10 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-gold)' }}>
                        <Icon name="play" className="h-4 w-4" style={{ color: 'var(--color-ink)' }} />
                      </span>
                    </span>
                  )}
                </button>
                <div className="p-4">
                  <div className="font-display text-[16px] leading-snug break-words" style={{ color: title.trim() ? 'var(--color-char)' : 'var(--color-char-soft)' }}>
                    {preview.title}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
                      {reach === 'one' && !department ? 'Pick a department' : videoScopeLabel(preview)}
                    </span>
                    <Badge tone={audience === 'student' ? 'gold' : 'teal'}>{AUDIENCE_LABELS[audience]}</Badge>
                    {!active && <Badge tone="clay">Disabled</Badge>}
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-[10px] border p-4" style={CARD_STYLE}>
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon name="users" className="h-3.5 w-3.5" style={{ color: 'var(--color-gold)' }} />
                  <span className="text-[11px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                    Who will see it
                  </span>
                </div>
                <p className="text-[13px] leading-relaxed" style={{ color: active ? 'var(--color-char)' : 'var(--color-char-soft)' }}>
                  {active ? reachSummary(audience, publishedDepartment, mbbsYear, institutionId) : 'Nobody while it’s disabled.'}
                </p>
              </div>
            </aside>
          </div>
        )}
      </div>

      {previewOpen && preview.url && <VideoPreviewModal video={preview} onClose={() => setPreviewOpen(false)} />}
    </Shell>
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
      <span
        className="mt-0.5 h-4 w-4 shrink-0 rounded-full border flex items-center justify-center"
        style={{ borderColor: selected ? 'var(--color-gold)' : 'var(--color-line)' }}
      >
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
