import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { StudentShell } from './shell/StudentShell'
import { Card, Skeleton } from './shell/ui'
import { Icon } from '../primary-admin/shell/Icon'
import { VideoThumbnail, VideoPreviewModal } from '../primary-admin/shell/VideoShared'
import { useStudentDepartments } from '../../lib/enabledDepartments'
import { watchStudentVideos, watchInstitutionVideoOverrides } from '../../lib/firestore/videoTutorials'
import { watchMyVideoBatches, videoBatchStatus, batchVideoView } from '../../lib/firestore/videoBatches'
import type { InstitutionVideoOverride, VideoBatch, VideoPreviewable, VideoTutorial } from '../../types'

function formatBatchExpiry(endAt: number): string {
  const diffMs = endAt - Date.now()
  const hours = Math.round(diffMs / 3_600_000)
  if (hours < 1) return 'Expires soon'
  if (hours < 24) return `Expires in ${hours}h`
  return `Expires in ${Math.round(hours / 24)}d`
}

export function StudentVideosPage() {
  const { appUser } = useAuth()
  const institutionId = appUser?.institutionId ?? null
  const mbbsYear = appUser?.mbbsYear ?? null

  // A student is bound by year only — every department enabled for their
  // college in that year applies — so merge the catalog videos from every
  // one of them, rather than a single fixed department.
  const { departments: myDepartments, loading: departmentsLoading } = useStudentDepartments(institutionId, mbbsYear)
  const departmentIdsKey = myDepartments.map((d) => d.id).join(',')

  const [videosByDept, setVideosByDept] = useState<Record<string, VideoTutorial[]>>({})
  useEffect(() => {
    if (!institutionId || !mbbsYear || myDepartments.length === 0) {
      setVideosByDept({})
      return
    }
    const unsubs = myDepartments.map((d) =>
      watchStudentVideos(institutionId, d.name, mbbsYear, (vids) => setVideosByDept((prev) => ({ ...prev, [d.id]: vids }))),
    )
    return () => unsubs.forEach((u) => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institutionId, mbbsYear, departmentIdsKey])
  const videosLoaded = myDepartments.every((d) => d.id in videosByDept)
  const videos = useMemo(() => {
    const seen = new Set<string>()
    const merged: VideoTutorial[] = []
    for (const d of myDepartments) {
      for (const v of videosByDept[d.id] ?? []) {
        if (!seen.has(v.id)) {
          seen.add(v.id)
          merged.push(v)
        }
      }
    }
    return merged
  }, [myDepartments, videosByDept])

  const [overrides, setOverrides] = useState<InstitutionVideoOverride[]>([])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionVideoOverrides(institutionId, setOverrides)
  }, [institutionId])

  const visible = useMemo(() => {
    return videos.filter((v) => {
      const o = overrides.find((x) => x.videoId === v.id)
      return o ? o.enabled : true
    })
  }, [videos, overrides])

  // Batch grants (Primary Admin's "Batches" panel) — a temporary, scheduled
  // unlock of one video that's uploaded/linked directly onto the batch
  // itself, never a catalog VideoTutorial, so there's nothing to fetch
  // here — batchVideoView() builds the display-only object straight from
  // the batch doc already in hand. Re-checked every 30s (not just on
  // snapshot) so a batch that just entered or left its active window
  // disappears/appears without needing a manual refresh.
  const [myBatches, setMyBatches] = useState<VideoBatch[]>([])
  useEffect(() => {
    if (!appUser) return
    return watchMyVideoBatches(appUser.uid, setMyBatches)
  }, [appUser])
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  const activeBatches = useMemo(() => myBatches.filter((b) => videoBatchStatus(b, now) === 'active'), [myBatches, now])
  const batchEntries = activeBatches.flatMap((batch) =>
    batch.videos.map((item) => ({
      key: `${batch.id}-${item.id}`,
      endAt: batch.endAt,
      video: batchVideoView(batch, item, myDepartments.find((d) => d.id === batch.departmentId)?.name ?? ''),
    })),
  )

  const [preview, setPreview] = useState<VideoPreviewable | null>(null)
  const loading = departmentsLoading || (myDepartments.length > 0 && !videosLoaded)
  const totalCount = visible.length + batchEntries.length

  return (
    <StudentShell eyebrow={myDepartments.length === 1 ? myDepartments[0].name : 'Video tutorials'} title="Videos">
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          <Skeleton className="h-40 rounded-[14px]" />
          <Skeleton className="h-40 rounded-[14px]" />
        </div>
      ) : totalCount === 0 ? (
        <Card>
          <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            No videos are available for your department(s) and year yet.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {visible.map((v, i) => (
            <VideoGridItem key={v.id} video={v} index={i} onOpen={() => setPreview(v)} />
          ))}
          {batchEntries.map(({ key, endAt, video }, i) => (
            <VideoGridItem
              key={`batch-${key}`}
              video={video}
              index={visible.length + i}
              onOpen={() => setPreview(video)}
              batchExpiry={formatBatchExpiry(endAt)}
            />
          ))}
        </div>
      )}

      {preview && <VideoPreviewModal video={preview} onClose={() => setPreview(null)} />}
    </StudentShell>
  )
}

function VideoGridItem({
  video,
  index,
  onOpen,
  batchExpiry,
}: {
  video: VideoPreviewable
  index: number
  onOpen: () => void
  batchExpiry?: string
}) {
  return (
    <button
      onClick={onOpen}
      className="fade-up group text-left overflow-hidden rounded-[14px] border transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-14px_rgba(11,18,32,0.35)]"
      style={{ backgroundColor: 'var(--color-paper-raised)', borderColor: 'var(--color-line)', animationDelay: `${index * 40}ms` }}
    >
      <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}>
        <VideoThumbnail video={video} className="absolute inset-0 w-full h-full" />
        <span
          className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 30%, transparent)' }}
        >
          <span className="h-11 w-11 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-teal)' }}>
            <Icon name="play" className="h-4 w-4" style={{ color: 'var(--color-frost)' }} />
          </span>
        </span>
      </div>
      <div className="p-3.5">
        <div className="font-display text-[15px] leading-snug" style={{ color: 'var(--color-char)' }}>
          {video.title}
        </div>
        {batchExpiry && (
          <div className="flex items-center gap-1 mt-1 text-[11px]" style={{ color: 'var(--color-char-soft)' }}>
            <Icon name="clock" className="h-3 w-3" />
            {batchExpiry}
          </div>
        )}
      </div>
    </button>
  )
}
