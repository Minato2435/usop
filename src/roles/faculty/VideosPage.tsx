import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { FacultyShell } from './shell/FacultyShell'
import { Card, Skeleton } from './shell/ui'
import { Icon } from '../primary-admin/shell/Icon'
import { VideoThumbnail, VideoPreviewModal } from '../primary-admin/shell/VideoShared'
import { watchFacultyVideos, watchInstitutionVideoOverrides } from '../../lib/firestore/videoTutorials'
import { watchCatalogDepartments, watchInstitutionDepartments } from '../../lib/firestore/departments'
import { watchMyVideoBatches, videoBatchStatus, batchVideoView } from '../../lib/firestore/videoBatches'
import type { Department, InstitutionVideoOverride, VideoBatch, VideoPreviewable, VideoTutorial } from '../../types'

function formatBatchExpiry(endAt: number): string {
  const diffMs = endAt - Date.now()
  const hours = Math.round(diffMs / 3_600_000)
  if (hours < 1) return 'Expires soon'
  if (hours < 24) return `Expires in ${hours}h`
  return `Expires in ${Math.round(hours / 24)}d`
}

export function FacultyVideosPage() {
  const { appUser } = useAuth()
  const institutionId = appUser?.institutionId ?? null

  // Department names — for this faculty member's own department (videos
  // can be published to one department or to all) and batch display.
  const [catalogDepts, setCatalogDepts] = useState<Department[]>([])
  const [ownDepts, setOwnDepts] = useState<Department[]>([])
  const [deptsLoaded, setDeptsLoaded] = useState(false)
  useEffect(() => watchCatalogDepartments(setCatalogDepts), [])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionDepartments(institutionId, (d) => {
      setOwnDepts(d)
      setDeptsLoaded(true)
    })
  }, [institutionId])
  const departments = useMemo(() => [...catalogDepts, ...ownDepts], [catalogDepts, ownDepts])
  const myDepartmentName = departments.find((d) => d.id === appUser?.departmentId)?.name ?? null

  const [videos, setVideos] = useState<VideoTutorial[] | null>(null)
  useEffect(() => {
    if (!institutionId || !deptsLoaded) return
    return watchFacultyVideos(institutionId, myDepartmentName, setVideos)
  }, [institutionId, deptsLoaded, myDepartmentName])

  const [overrides, setOverrides] = useState<InstitutionVideoOverride[]>([])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionVideoOverrides(institutionId, setOverrides)
  }, [institutionId])

  const visible = useMemo(() => {
    return (videos ?? []).filter((v) => {
      const o = overrides.find((x) => x.videoId === v.id)
      return o ? o.enabled : true
    })
  }, [videos, overrides])

  // Batch grants — see the matching block in student/VideosPage.tsx for
  // the full rationale (the video is embedded directly on the batch, never
  // a catalog VideoTutorial, so batchVideoView() builds the display view
  // with no extra fetch).

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
      video: batchVideoView(batch, item, departments.find((d) => d.id === batch.departmentId)?.name ?? ''),
    })),
  )

  const [preview, setPreview] = useState<VideoPreviewable | null>(null)
  const loading = videos === null
  const totalCount = visible.length + batchEntries.length

  return (
    <FacultyShell eyebrow="Guides & tutorials" title="Videos">
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Skeleton className="h-32 rounded-[8px]" />
          <Skeleton className="h-32 rounded-[8px]" />
        </div>
      ) : totalCount === 0 ? (
        <Card>
          <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            No videos are available yet.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visible.map((v) => (
            <VideoGridItem key={v.id} video={v} onOpen={() => setPreview(v)} />
          ))}
          {batchEntries.map(({ key, endAt, video }) => (
            <VideoGridItem key={`batch-${key}`} video={video} onOpen={() => setPreview(video)} batchExpiry={formatBatchExpiry(endAt)} />
          ))}
        </div>
      )}

      {preview && <VideoPreviewModal video={preview} onClose={() => setPreview(null)} />}
    </FacultyShell>
  )
}

function VideoGridItem({ video, onOpen, batchExpiry }: { video: VideoPreviewable; onOpen: () => void; batchExpiry?: string }) {
  return (
    <button
      onClick={onOpen}
      className="group text-left overflow-hidden rounded-[8px] border transition-colors hover:border-[var(--color-teal)]"
      style={{ backgroundColor: 'var(--color-paper-raised)', borderColor: 'var(--color-line)' }}
    >
      <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}>
        <VideoThumbnail video={video} className="absolute inset-0 w-full h-full" />
        <span
          className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 30%, transparent)' }}
        >
          <span className="h-9 w-9 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-teal)' }}>
            <Icon name="play" className="h-3.5 w-3.5" style={{ color: 'var(--color-frost)' }} />
          </span>
        </span>
      </div>
      <div className="p-3">
        <div className="text-[13px] leading-snug" style={{ color: 'var(--color-char)' }}>
          {video.title}
        </div>
        {batchExpiry && (
          <div className="flex items-center gap-1 mt-1 text-[10.5px]" style={{ color: 'var(--color-char-soft)' }}>
            <Icon name="clock" className="h-3 w-3" />
            {batchExpiry}
          </div>
        )}
      </div>
    </button>
  )
}
