import { useEffect, useRef, useState } from 'react'
import { deleteObject, ref as storageRef } from 'firebase/storage'
import { GhostButton, Badge } from './ui'
import { Icon } from './Icon'
import { deleteVideoTutorial, isVideoActive, ALL_DEPARTMENTS } from '../../../lib/firestore/videoTutorials'
import { storage } from '../../../lib/firebase'
import type { MbbsYear, VideoAudience, VideoPreviewable, VideoTutorial } from '../../../types'

// Shared between the global Video Tutorials catalog page and the
// Institution Management portal's Videos tab — the create/edit form,
// thumbnail/card/row/preview rendering, and delete-with-Storage-cleanup are
// identical either way, parameterized only by which institutionId (if any)
// a newly created video belongs to.

export const AUDIENCE_LABELS: Record<VideoAudience, string> = { student: 'Students', faculty: 'Faculty' }
export const MAX_UPLOAD_BYTES = 500 * 1024 * 1024
// "Anatomy · Year 1", "All departments · Year 1", "All departments" —
// faculty videos aren't year-scoped, so no year for them.
export function videoScopeLabel(video: Pick<VideoTutorial, 'department' | 'mbbsYear' | 'audience'>): string {
  const dept = video.department === ALL_DEPARTMENTS ? 'All departments' : video.department
  return video.audience === 'faculty' ? dept : `${dept} · Year ${video.mbbsYear}`
}

// Toggle copy: the college's include/exclude override vs. the author's own
// publish switch read differently.
export type VideoToggleKind = 'include' | 'publish'
export function toggleLabel(kind: VideoToggleKind, on: boolean): string {
  if (kind === 'publish') return on ? 'Enabled — click to disable' : 'Disabled — click to enable'
  return on ? 'Included — click to exclude' : 'Excluded — click to include'
}

export const ROW_DIVIDER = '1px solid color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)'

// --- URL parsing — drives both the thumbnail and the embed choice --------

type ParsedVideo =
  | { kind: 'youtube'; embedUrl: string; thumbnailUrl: string }
  | { kind: 'vimeo'; embedUrl: string }
  | { kind: 'drive'; embedUrl: string }
  | { kind: 'file' }

export function parseVideoUrl(url: string): ParsedVideo {
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/)
  if (yt) {
    return {
      kind: 'youtube',
      embedUrl: `https://www.youtube.com/embed/${yt[1]}`,
      thumbnailUrl: `https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg`,
    }
  }
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)
  if (vimeo) return { kind: 'vimeo', embedUrl: `https://player.vimeo.com/video/${vimeo[1]}` }
  const drive = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/)
  if (drive) return { kind: 'drive', embedUrl: `https://drive.google.com/file/d/${drive[1]}/preview` }
  return { kind: 'file' }
}

export function recognizedSourceLabel(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  switch (parseVideoUrl(trimmed).kind) {
    case 'youtube':
      return 'Recognized as a YouTube video.'
    case 'vimeo':
      return 'Recognized as a Vimeo video.'
    case 'drive':
      return 'Recognized as a Google Drive video.'
    case 'file':
      return 'Will play as a direct video file.'
  }
}

// Deletes a video's Storage files (the video itself, if uploaded, and its
// custom thumbnail, if any) before deleting the Firestore doc — used by
// both pages so there's one implementation of the cleanup order.
export async function deleteVideoAndFiles(video: VideoTutorial): Promise<void> {
  if (video.source === 'upload' && video.storagePath) {
    await deleteObject(storageRef(storage, video.storagePath)).catch(() => {})
  }
  if (video.thumbnailStoragePath) {
    await deleteObject(storageRef(storage, video.thumbnailStoragePath)).catch(() => {})
  }
  await deleteVideoTutorial(video.id)
}

// --- Thumbnail --------------------------------------------------------

// YouTube gets a real static thumbnail for free. Uploaded files get a
// best-effort client-side first-frame capture (an off-screen <video>
// seeked to ~0.1s, drawn onto a <canvas>) — this only succeeds if the
// Storage bucket's CORS config allows canvas pixel reads from this origin;
// where it doesn't, it fails silently and falls back to the placeholder
// tile. Vimeo/Drive links always show the placeholder tile — neither
// offers a no-auth static-thumbnail URL the way YouTube does.
export function VideoThumbnail({ video, className }: { video: VideoPreviewable; className?: string }) {
  const [capturedPoster, setCapturedPoster] = useState<string | null>(null)
  const parsed = video.source === 'link' ? parseVideoUrl(video.url) : null

  useEffect(() => {
    // Skip the off-screen capture entirely once a custom thumbnail exists
    // — no point doing the work if it'll be overridden anyway.
    if (video.thumbnailUrl || video.source !== 'upload' || !video.url) return
    let cancelled = false
    const el = document.createElement('video')
    el.crossOrigin = 'anonymous'
    el.preload = 'metadata'
    el.muted = true
    el.playsInline = true
    el.src = video.url

    function onLoaded() {
      try {
        el.currentTime = Math.min(0.1, el.duration || 0.1)
      } catch {
        // duration not ready yet on some browsers — seeked never fires, harmless
      }
    }
    function onSeeked() {
      if (cancelled) return
      const canvas = document.createElement('canvas')
      canvas.width = el.videoWidth || 320
      canvas.height = el.videoHeight || 180
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      try {
        ctx.drawImage(el, 0, 0, canvas.width, canvas.height)
        setCapturedPoster(canvas.toDataURL('image/jpeg', 0.7))
      } catch {
        // Tainted canvas (no CORS on the bucket) — stay on the placeholder tile
      }
    }
    el.addEventListener('loadeddata', onLoaded)
    el.addEventListener('seeked', onSeeked)
    return () => {
      cancelled = true
      el.removeEventListener('loadeddata', onLoaded)
      el.removeEventListener('seeked', onSeeked)
    }
  }, [video.thumbnailUrl, video.source, video.url])

  const thumbnailUrl =
    video.thumbnailUrl ?? (parsed?.kind === 'youtube' ? parsed.thumbnailUrl : video.source === 'upload' ? capturedPoster : null)

  if (thumbnailUrl) {
    return <img src={thumbnailUrl} alt="" className={className} style={{ objectFit: 'cover' }} />
  }

  return (
    <div className={className} style={{ backgroundColor: 'var(--color-ink)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="play" className="h-6 w-6" style={{ color: 'var(--color-gold)' }} />
    </div>
  )
}

// --- Grid card ----------------------------------------------------------

export function VideoCard({
  video,
  index,
  onOpen,
  onEdit,
  onDelete,
  enabled,
  onToggle,
  toggleKind = 'include',
}: {
  video: VideoTutorial
  index: number
  onOpen: () => void
  onEdit?: () => void
  onDelete?: () => Promise<void>
  // Optional on/off switch — either a college's include/exclude override
  // ('include') or the author's own publish switch ('publish').
  enabled?: boolean
  onToggle?: () => void
  toggleKind?: VideoToggleKind
}) {
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)

  return (
    <div
      className="fade-up group overflow-hidden rounded-[10px] border transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-14px_rgba(11,18,32,0.35)]"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)',
        borderColor: confirming ? 'var(--color-clay)' : 'var(--color-line)',
        animationDelay: `${index * 35}ms`,
      }}
    >
      <button onClick={onOpen} className="relative w-full block" style={{ aspectRatio: '16 / 9' }}>
        <VideoThumbnail video={video} className="absolute inset-0 w-full h-full" />
        <span
          className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 30%, transparent)' }}
        >
          <span
            className="h-10 w-10 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'var(--color-gold)' }}
          >
            <Icon name="play" className="h-4 w-4" style={{ color: 'var(--color-ink)' }} />
          </span>
        </span>
      </button>

      <div className="p-4">
        {confirming ? (
          <>
            <p className="text-[12.5px] leading-relaxed mb-3" style={{ color: 'var(--color-clay)' }}>
              Remove <span className="font-medium">"{video.title}"</span>? This can't be undone.
            </p>
            <div className="flex gap-2">
              <GhostButton
                tone="danger"
                onClick={async () => {
                  setRemoving(true)
                  await onDelete?.()
                }}
              >
                {removing ? 'Removing…' : 'Remove'}
              </GhostButton>
              <GhostButton onClick={() => setConfirming(false)}>Cancel</GhostButton>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 min-w-0 flex-1">
                {onToggle && (
                  <div className="pt-0.5">
                    <ToggleSwitch on={!!enabled} onChange={onToggle} label={toggleLabel(toggleKind, !!enabled)} size="sm" />
                  </div>
                )}
                <div
                  className="min-w-0 flex-1 font-display text-[16px] leading-snug break-words"
                  style={{ color: onToggle && !enabled ? 'var(--color-char-soft)' : 'var(--color-char)' }}
                >
                  {video.title}
                </div>
              </div>
              {(onEdit || onDelete) && (
                <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  {onEdit && <IconButton icon="edit" title="Edit video" onClick={onEdit} />}
                  {onDelete && <IconButton icon="trash" title="Remove video" tone="danger" onClick={() => setConfirming(true)} />}
                </div>
              )}
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
              <span className="text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
                {videoScopeLabel(video)}
              </span>
              <Badge tone={video.audience === 'student' ? 'gold' : 'teal'}>{AUDIENCE_LABELS[video.audience]}</Badge>
              {!isVideoActive(video) && <Badge tone="clay">Disabled</Badge>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// --- List row -------------------------------------------------------------

export function VideoListRow({
  video,
  isLast,
  onOpen,
  onEdit,
  onDelete,
  enabled,
  onToggle,
  toggleKind = 'include',
}: {
  video: VideoTutorial
  isLast: boolean
  onOpen: () => void
  onEdit?: () => void
  onDelete?: () => Promise<void>
  // Same optional switch as VideoCard — see its comment.
  enabled?: boolean
  onToggle?: () => void
  toggleKind?: VideoToggleKind
}) {
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)

  if (confirming) {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
        style={{ borderBottom: isLast ? undefined : ROW_DIVIDER, backgroundColor: 'var(--color-clay-soft)' }}
      >
        <p className="text-[12.5px]" style={{ color: 'var(--color-clay)' }}>
          Remove <span className="font-medium">"{video.title}"</span>? This can't be undone.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <GhostButton
            tone="danger"
            onClick={async () => {
              setRemoving(true)
              await onDelete?.()
            }}
          >
            {removing ? 'Removing…' : 'Remove'}
          </GhostButton>
          <GhostButton onClick={() => setConfirming(false)}>Cancel</GhostButton>
        </div>
      </div>
    )
  }

  return (
    <div
      className="group flex items-center gap-3.5 px-4 py-2.5 transition-colors hover:bg-black/[0.02]"
      style={{ borderBottom: isLast ? undefined : ROW_DIVIDER }}
    >
      {onToggle && (
        <ToggleSwitch on={!!enabled} onChange={onToggle} label={toggleLabel(toggleKind, !!enabled)} size="sm" />
      )}
      <button onClick={onOpen} className="shrink-0 relative rounded-[6px] overflow-hidden" style={{ width: 64, height: 36 }}>
        <VideoThumbnail video={video} className="absolute inset-0 w-full h-full" />
      </button>
      <button onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div
          className="font-display text-[15px] leading-snug truncate"
          style={{ color: onToggle && !enabled ? 'var(--color-char-soft)' : 'var(--color-char)' }}
        >
          {video.title}
        </div>
        <div className="text-[11.5px] truncate" style={{ color: 'var(--color-char-soft)' }}>
          {videoScopeLabel(video)}
        </div>
      </button>
      {!isVideoActive(video) && <Badge tone="clay">Disabled</Badge>}
      <Badge tone={video.audience === 'student' ? 'gold' : 'teal'}>{AUDIENCE_LABELS[video.audience]}</Badge>
      {(onEdit || onDelete) && (
        <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          {onEdit && <IconButton icon="edit" title="Edit video" onClick={onEdit} />}
          {onDelete && <IconButton icon="trash" title="Remove video" tone="danger" onClick={() => setConfirming(true)} />}
        </div>
      )}
    </div>
  )
}

// A dashed "attach card" — deliberately not a native <input type="file">
// (unstylable, looks plain) or a plain bordered button (flat, no real
// affordance for "this is a drop target"). Icon badge + filename/hint, a
// gold accent once a file's picked, and its own × to clear just that pick
// — used for both the video-file and thumbnail-image attach fields so they
// read as one consistent control.
export function FileAttachControl({
  accept,
  file,
  onChange,
  label,
  hint,
}: {
  accept: string
  file: File | null
  onChange: (file: File | null) => void
  label: string
  hint?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div
      className="flex items-center gap-3 pl-3 pr-2 py-2.5 rounded-[10px] border border-dashed transition-colors duration-150"
      style={{
        borderColor: file ? 'var(--color-gold-line)' : 'var(--color-line)',
        backgroundColor: file ? 'color-mix(in srgb, var(--color-gold) 6%, transparent)' : 'transparent',
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
      <button type="button" onClick={() => inputRef.current?.click()} className="flex items-center gap-3 min-w-0 flex-1 text-left">
        <span
          className="shrink-0 h-8 w-8 rounded-full flex items-center justify-center"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-gold) 16%, transparent)' }}
        >
          <Icon name="upload" className="h-3.5 w-3.5" style={{ color: 'var(--color-gold)' }} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-medium truncate" style={{ color: 'var(--color-char)' }}>
            {file ? file.name : label}
          </span>
          <span className="block text-[11px] mt-0.5 truncate" style={{ color: 'var(--color-char-soft)' }}>
            {file ? `${(file.size / (1024 * 1024)).toFixed(1)}MB` : hint}
          </span>
        </span>
      </button>
      {file && (
        <button
          type="button"
          onClick={() => onChange(null)}
          title="Clear selection"
          className="shrink-0 h-6 w-6 flex items-center justify-center rounded-[5px] transition-colors hover:bg-black/[0.06]"
          style={{ color: 'var(--color-char-soft)' }}
        >
          <Icon name="close" className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

// Explicit `left` anchor + translateX on the knob, same as the identical
// component in InstitutionDetailPage.tsx — a real bug was hit and fixed
// there once for this exact pattern (relying on the default static
// position made the knob render off-position). Don't regress that.
export function ToggleSwitch({
  on,
  onChange,
  label,
  size = 'md',
}: {
  on: boolean
  onChange: () => void
  label?: string
  size?: 'md' | 'sm'
}) {
  const width = size === 'md' ? 34 : 30
  const height = size === 'md' ? 19 : 17
  const knob = size === 'md' ? 15 : 13
  return (
    <button
      onClick={onChange}
      role="switch"
      aria-checked={on}
      title={label}
      className="relative shrink-0 p-0 border-0 cursor-pointer"
      style={{
        width,
        height,
        borderRadius: 999,
        backgroundColor: on ? 'var(--color-gold)' : 'var(--color-line)',
        transition: 'background-color .15s ease',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: 2,
          width: knob,
          height: knob,
          borderRadius: '50%',
          backgroundColor: '#fff',
          transform: on ? `translateX(${width - knob - 4}px)` : 'translateX(0px)',
          transition: 'transform .15s ease',
        }}
      />
    </button>
  )
}

export function IconButton({
  icon,
  title,
  onClick,
  tone = 'default',
}: {
  icon: 'edit' | 'trash'
  title: string
  onClick: () => void
  tone?: 'default' | 'danger'
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="h-6 w-6 flex items-center justify-center transition-colors duration-150 hover:bg-black/[0.06]"
      style={{ color: tone === 'danger' ? 'var(--color-clay)' : 'var(--color-char-soft)' }}
    >
      <Icon name={icon} className="h-3.5 w-3.5" />
    </button>
  )
}

// --- Preview / playback modal ---------------------------------------------

// Deliberately not the shared Modal (fixed max-w-md) — video benefits from
// real width, so this is its own wider lightbox with the same backdrop +
// Esc-to-close behavior. Nothing streams until this opens: the grid/list
// only ever show static thumbnails, never autoplay or preload video bytes.
export function VideoPreviewModal({ video, onClose }: { video: VideoPreviewable; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const parsed = video.source === 'link' ? parseVideoUrl(video.url) : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 55%, transparent)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="chamfer w-full max-w-3xl fade-up" style={{ backgroundColor: 'var(--color-paper-raised)' }}>
        <div className="flex items-center justify-between px-5 py-4">
          <div className="min-w-0">
            <div className="font-display text-[19px] leading-snug truncate" style={{ color: 'var(--color-char)' }}>
              {video.title}
            </div>
            <div className="text-[12px] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
              {videoScopeLabel(video)} · {AUDIENCE_LABELS[video.audience]}
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 h-8 w-8 flex items-center justify-center" style={{ color: 'var(--color-char-soft)' }}>
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>

        <div className="relative w-full" style={{ aspectRatio: '16 / 9', backgroundColor: 'var(--color-ink)' }}>
          {parsed && parsed.kind !== 'file' ? (
            <iframe
              src={parsed.embedUrl}
              className="absolute inset-0 w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          ) : video.url ? (
            <video src={video.url} controls autoPlay preload="metadata" className="absolute inset-0 w-full h-full" />
          ) : (
            // An upload that never finished (no URL saved) — nothing to play.
            <div className="absolute inset-0 flex items-center justify-center text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
              This video isn't available — its upload didn't finish.
            </div>
          )}
        </div>

        {video.description && (
          <p className="px-5 py-4 text-[13.5px] leading-relaxed" style={{ color: 'var(--color-char-soft)' }}>
            {video.description}
          </p>
        )}
      </div>
    </div>
  )
}

// Plain-language "who will see this" line under the form's targeting fields.
export function reachSummary(audience: VideoAudience, department: string, mbbsYear: MbbsYear, institutionId: string): string {
  const where = institutionId ? 'at this college' : 'at every college that has it switched on'
  if (department === ALL_DEPARTMENTS) {
    return audience === 'student'
      ? `Every Year ${mbbsYear} student ${where}, in all departments.`
      : `Every faculty member and HOD ${where}, in all departments.`
  }
  if (!department) return 'Pick a department.'
  return audience === 'student'
    ? `Year ${mbbsYear} students ${where} who have ${department}.`
    : `Faculty and HOD of ${department} ${where}.`
}

// Small two-or-more-way pill switch, same look as the form's source toggle.
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { v: T; label: string }[]
}) {
  return (
    <div className="inline-flex border rounded-[6px] overflow-hidden" style={{ borderColor: 'var(--color-line)' }}>
      {options.map((o, i) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className="px-4 py-2 text-[12.5px] font-medium transition-colors"
          style={{
            backgroundColor: value === o.v ? 'var(--color-ink)' : 'transparent',
            color: value === o.v ? 'var(--color-frost)' : 'var(--color-char-soft)',
            borderLeft: i > 0 ? '1px solid var(--color-line)' : undefined,
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
