import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { HodShell } from './shell/HodShell'
import { Card, Skeleton } from './shell/ui'
import { Icon } from '../primary-admin/shell/Icon'
import { VideoThumbnail, VideoPreviewModal } from '../primary-admin/shell/VideoShared'
import { watchFacultyVideos, watchInstitutionVideoOverrides } from '../../lib/firestore/videoTutorials'
import { watchDepartment } from '../../lib/firestore/departments'
import type { InstitutionVideoOverride, VideoTutorial } from '../../types'

// Reuses watchFacultyVideos() — the `audience` tag on a video is
// role-scoped ('faculty'/'student'), not keyed to a specific uid, and HOD
// has "Full Faculty-level capabilities" per the build spec, so the same
// faculty-audience catalog applies to them too.
export function HodVideosPage() {
  const { appUser } = useAuth()
  const institutionId = appUser?.institutionId ?? null

  // The HOD's own department name — videos can be published to one
  // department or to all of them.
  const departmentId = appUser?.departmentId ?? null
  const [departmentName, setDepartmentName] = useState<string | null | undefined>(undefined)
  useEffect(() => {
    if (!departmentId) {
      setDepartmentName(null)
      return
    }
    return watchDepartment(departmentId, (d) => setDepartmentName(d?.name ?? null))
  }, [departmentId])

  const [videos, setVideos] = useState<VideoTutorial[] | null>(null)
  useEffect(() => {
    if (!institutionId || departmentName === undefined) return
    return watchFacultyVideos(institutionId, departmentName, setVideos)
  }, [institutionId, departmentName])

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

  const [preview, setPreview] = useState<VideoTutorial | null>(null)
  const loading = videos === null

  return (
    <HodShell eyebrow="Guides & tutorials" title="Videos">
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Skeleton className="h-32 rounded-[8px]" />
          <Skeleton className="h-32 rounded-[8px]" />
        </div>
      ) : visible.length === 0 ? (
        <Card elevated>
          <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            No videos are available yet.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {visible.map((v, i) => (
            <button
              key={v.id}
              onClick={() => setPreview(v)}
              className="fade-up group text-left overflow-hidden rounded-[10px] border transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-14px_rgba(11,18,32,0.35)] hover:border-[var(--color-gold-line)]"
              style={{ backgroundColor: 'var(--color-paper-raised)', borderColor: 'var(--color-line)', animationDelay: `${i * 30}ms` }}
            >
              <div className="relative w-full" style={{ aspectRatio: '16 / 9' }}>
                <VideoThumbnail video={v} className="absolute inset-0 w-full h-full" />
                <span
                  className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 30%, transparent)' }}
                >
                  <span className="h-9 w-9 rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--color-gold)' }}>
                    <Icon name="play" className="h-3.5 w-3.5" style={{ color: 'var(--color-frost)' }} />
                  </span>
                </span>
              </div>
              <div className="p-3">
                <div className="text-[13px] leading-snug" style={{ color: 'var(--color-char)' }}>
                  {v.title}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {preview && <VideoPreviewModal video={preview} onClose={() => setPreview(null)} />}
    </HodShell>
  )
}
