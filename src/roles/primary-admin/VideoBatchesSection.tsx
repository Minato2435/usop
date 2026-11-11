import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, Badge, GhostButton, Skeleton } from './shell/ui'
import { Icon } from './shell/Icon'
import { VideoThumbnail, VideoPreviewModal } from './shell/VideoShared'
import { watchAllVideoBatches, deleteVideoBatchAndFiles, videoBatchStatus, batchVideoView } from '../../lib/firestore/videoBatches'
import { watchInstitutions } from '../../lib/firestore/institutions'
import type { Department, Institution, VideoBatch, VideoBatchStatus, VideoPreviewable } from '../../types'

const STATUS_LABELS: Record<VideoBatchStatus, string> = { scheduled: 'Scheduled', active: 'Active', expired: 'Expired' }
const STATUS_TONES: Record<VideoBatchStatus, 'neutral' | 'teal' | 'clay'> = { scheduled: 'neutral', active: 'teal', expired: 'clay' }
const STATUS_ORDER: VideoBatchStatus[] = ['active', 'scheduled', 'expired']

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

// Clubs a hand-picked set of students/faculty from one college/department/
// year into a group that gets temporary, scheduled access to one specific
// video — independent of that video's own department/year tags (the whole
// point is overriding normal catalog visibility for a cohort, not just
// repeating it). "Auto-closes itself" is computed, not scheduled: there is
// no Cloud Function/cron in this project, so videoBatchStatus() derives
// scheduled/active/expired from startAt/endAt vs. now on every read — a
// batch past its own endAt is never deleted automatically, it just stops
// granting access and reads as "Expired" until an admin removes it.
//
// This component is now list-only — creation lives on its own full page
// (VideoBatchCreatePage.tsx, routed at /admin/video-tutorials/batches/new)
// rather than a Modal here, so the video pick can show real thumbnail
// previews and the whole flow gets room to breathe. The page's own "+ New
// batch" button (in VideoTutorialsPage.tsx) navigates straight there.
export function VideoBatchesSection({ departments }: { departments: Department[] }) {
  const navigate = useNavigate()
  const [batches, setBatches] = useState<VideoBatch[] | null>(null)
  useEffect(() => watchAllVideoBatches(setBatches), [])
  const [institutions, setInstitutions] = useState<Institution[]>([])
  useEffect(() => watchInstitutions(setInstitutions), [])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [preview, setPreview] = useState<VideoPreviewable | null>(null)

  const loading = batches === null

  const grouped = useMemo(() => {
    if (!batches) return []
    return STATUS_ORDER.map((status) => ({
      status,
      items: batches
        .filter((b) => videoBatchStatus(b, now) === status)
        .sort((a, b) => (status === 'expired' ? b.endAt - a.endAt : a.startAt - b.startAt)),
    })).filter((g) => g.items.length > 0)
  }, [batches, now])

  async function handleDelete(batch: VideoBatch) {
    setConfirmDeleteId(null)
    await deleteVideoBatchAndFiles(batch)
  }

  return (
    <>
      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : batches!.length === 0 ? (
        <Card className="chamfer max-w-lg">
          <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            No batches yet — club a set of students or faculty together and grant them a specific
            video for a scheduled window.
          </p>
        </Card>
      ) : (
        <div className="space-y-7">
          {grouped.map(({ status, items }) => (
            <div key={status}>
              <div className="flex items-center gap-2 mb-3">
                <Badge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</Badge>
                <span className="text-[11px]" style={{ color: 'var(--color-char-soft)' }}>
                  {items.length} batch{items.length === 1 ? '' : 'es'}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {items.map((b) => {
                  const institution = institutions.find((i) => i.id === b.institutionId)
                  const department = departments.find((d) => d.id === b.departmentId)
                  return (
                    <div
                      key={b.id}
                      className="rounded-[10px] border p-5"
                      style={{
                        backgroundColor: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)',
                        borderColor: 'var(--color-line)',
                      }}
                    >
                      <div className="flex items-start justify-between gap-3 mb-2.5">
                        <div className="font-display text-[16.5px] leading-snug" style={{ color: 'var(--color-char)' }}>
                          {b.title}
                        </div>
                        {confirmDeleteId === b.id ? (
                          <div className="flex items-center gap-1.5 text-[11px] shrink-0">
                            <button onClick={() => handleDelete(b)} className="font-medium" style={{ color: 'var(--color-clay)' }}>
                              Remove
                            </button>
                            <button onClick={() => setConfirmDeleteId(null)} style={{ color: 'var(--color-char-soft)' }}>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDeleteId(b.id)}
                            title="Remove"
                            className="h-6 w-6 flex items-center justify-center rounded-[3px] hover:bg-black/[0.06] shrink-0"
                            style={{ color: 'var(--color-char-soft)' }}
                          >
                            <Icon name="trash" className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mb-3 overflow-x-auto">
                        {b.videos.map((video) => (
                          <button
                            key={video.id}
                            onClick={() => setPreview(batchVideoView(b, video, department?.name ?? ''))}
                            title={video.title}
                            className="relative shrink-0 w-16 h-10 rounded-[5px] overflow-hidden border"
                            style={{ backgroundColor: 'var(--color-ink)', borderColor: 'var(--color-line)' }}
                          >
                            <VideoThumbnail video={batchVideoView(b, video, department?.name ?? '')} className="absolute inset-0 w-full h-full" />
                          </button>
                        ))}
                      </div>
                      <div className="text-[12px] mb-3" style={{ color: 'var(--color-char-soft)' }}>
                        {b.videos.length} video{b.videos.length === 1 ? '' : 's'}
                        {b.videos.length === 1 ? ` · ${b.videos[0].title}` : ''}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        <Badge tone="neutral">{institution?.name ?? '—'}</Badge>
                        <Badge tone="neutral">{b.departmentId === '' ? 'All departments' : (department?.name ?? '—')}</Badge>
                        <Badge tone="neutral">Year {b.mbbsYear}</Badge>
                        <Badge tone="gold">{b.audience === 'student' ? 'Students' : 'Faculty'}</Badge>
                      </div>
                      <div className="flex items-center gap-1.5 text-[12px] mb-1" style={{ color: 'var(--color-char-soft)' }}>
                        <Icon name="users" className="h-3.5 w-3.5" />
                        {b.memberIds.length} member{b.memberIds.length === 1 ? '' : 's'}
                      </div>
                      <div className="flex items-center gap-1.5 text-[12px] mb-3" style={{ color: 'var(--color-char-soft)' }}>
                        <Icon name="clock" className="h-3.5 w-3.5" />
                        {formatDateTime(b.startAt)} → {formatDateTime(b.endAt)}
                      </div>
                      <GhostButton onClick={() => navigate(`/admin/video-tutorials/batches/${b.id}/edit`)}>
                        <Icon name="edit" className="h-3.5 w-3.5" />
                        Edit
                      </GhostButton>
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {preview && <VideoPreviewModal video={preview} onClose={() => setPreview(null)} />}
    </>
  )
}
