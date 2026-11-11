import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { InstitutionAdminShell } from './shell/InstitutionAdminShell'
import { SaveChangesBar, SubTabBar } from './shell/toggleUi'
import { VideoCard, VideoListRow, VideoPreviewModal, deleteVideoAndFiles } from '../primary-admin/shell/VideoShared'
import { Card, PrimaryButton, Skeleton, inputClass } from '../primary-admin/shell/ui'
import { Icon } from '../primary-admin/shell/Icon'
import { watchAllVideoTutorials, watchInstitutionVideoOverrides, setVideoEnabledForInstitution, updateVideoTutorial, isVideoActive } from '../../lib/firestore/videoTutorials'
import { MBBS_YEARS } from '../../lib/academicStructure'
import type { InstitutionVideoOverride, MbbsYear, VideoAudience, VideoTutorial } from '../../types'

type SubTab = 'catalog' | 'own'

export function InstitutionAdminVideoTutorialsPage() {
  const { appUser } = useAuth()
  const institutionId = appUser?.institutionId ?? null

  const [subTab, setSubTab] = useState<SubTab>('catalog')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [search, setSearch] = useState('')
  const [yearFilter, setYearFilter] = useState<MbbsYear | 'all'>('all')
  const [audienceFilter, setAudienceFilter] = useState<VideoAudience | 'all'>('all')

  const [allVideos, setAllVideos] = useState<VideoTutorial[] | null>(null)
  const [overrides, setOverrides] = useState<InstitutionVideoOverride[] | null>(null)
  const [draft, setDraft] = useState<Record<string, boolean>>({})
  const [savingChanges, setSavingChanges] = useState(false)
  const navigate = useNavigate()
  const [previewVideo, setPreviewVideo] = useState<VideoTutorial | null>(null)

  useEffect(() => watchAllVideoTutorials(setAllVideos), [])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionVideoOverrides(institutionId, setOverrides)
  }, [institutionId])

  const loading = !allVideos || !overrides
  // A catalog video Primary Admin has disabled reaches nobody, so it isn't
  // listed for the college to include/exclude.
  const catalogVideos = (allVideos ?? []).filter((v) => v.institutionId === '' && isVideoActive(v))
  const ownVideos = (allVideos ?? []).filter((v) => v.institutionId === institutionId)

  function isEnabled(videoId: string): boolean {
    if (videoId in draft) return draft[videoId]
    const override = overrides?.find((o) => o.videoId === videoId)
    return override ? override.enabled : true
  }
  function stageToggle(videoId: string) {
    setDraft((prev) => ({ ...prev, [videoId]: !isEnabled(videoId) }))
  }
  async function saveChanges() {
    if (!institutionId) return
    setSavingChanges(true)
    await Promise.all(Object.entries(draft).map(([id, enabled]) => setVideoEnabledForInstitution(institutionId, id, enabled)))
    setDraft({})
    setSavingChanges(false)
  }

  // Catalog: the college's own include/exclude (staged, Save changes).
  // Own videos: the college authored them, so edit/delete plus the
  // publish switch, written immediately.
  function videoControls(v: VideoTutorial) {
    if (subTab === 'catalog') {
      return { enabled: isEnabled(v.id), onToggle: () => stageToggle(v.id) }
    }
    return {
      onEdit: () => navigate(`/institution-admin/video-tutorials/${v.id}/edit`),
      onDelete: () => deleteVideoAndFiles(v),
      enabled: isVideoActive(v),
      onToggle: () => updateVideoTutorial(v.id, { active: !isVideoActive(v) }),
      toggleKind: 'publish' as const,
    }
  }

  const filtered = useMemo(() => {
    const list = subTab === 'catalog' ? catalogVideos : ownVideos
    const q = search.trim().toLowerCase()
    return list.filter(
      (v) =>
        (q === '' || v.title.toLowerCase().includes(q)) &&
        (yearFilter === 'all' || v.mbbsYear === yearFilter) &&
        (audienceFilter === 'all' || v.audience === audienceFilter),
    )
  }, [subTab, catalogVideos, ownVideos, search, yearFilter, audienceFilter])

  return (
    <InstitutionAdminShell
      eyebrow="Content"
      title="Video Tutorials"
      actions={
        subTab === 'own' ? (
          <PrimaryButton onClick={() => navigate('/institution-admin/video-tutorials/new')}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            New video
          </PrimaryButton>
        ) : undefined
      }
    >
      <SubTabBar
        value={subTab}
        onChange={setSubTab}
        options={[
          { v: 'catalog', label: 'Catalog videos' },
          { v: 'own', label: 'Institution-specific videos' },
        ]}
      />

      <div className="flex items-center gap-2.5 flex-wrap mb-5">
        <div className="relative flex-1 min-w-[200px]">
          <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: 'var(--color-char-soft)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search videos"
            className={`${inputClass} pl-8`}
            style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
          />
        </div>
        <select className={inputClass} style={{ width: 140, borderColor: 'var(--color-line)', color: 'var(--color-char)' }} value={yearFilter} onChange={(e) => setYearFilter(e.target.value === 'all' ? 'all' : (Number(e.target.value) as MbbsYear))}>
          <option value="all">All years</option>
          {MBBS_YEARS.map((y) => (
            <option key={y} value={y}>
              Year {y}
            </option>
          ))}
        </select>
        <select className={inputClass} style={{ width: 150, borderColor: 'var(--color-line)', color: 'var(--color-char)' }} value={audienceFilter} onChange={(e) => setAudienceFilter(e.target.value as VideoAudience | 'all')}>
          <option value="all">All audiences</option>
          <option value="student">Students</option>
          <option value="faculty">Faculty</option>
        </select>
        <div className="inline-flex border rounded-[6px] overflow-hidden shrink-0" style={{ borderColor: 'var(--color-line)' }}>
          <button onClick={() => setViewMode('grid')} title="Grid view" className="h-9 w-9 flex items-center justify-center transition-colors" style={{ backgroundColor: viewMode === 'grid' ? 'var(--color-ink)' : 'transparent', color: viewMode === 'grid' ? 'var(--color-frost)' : 'var(--color-char-soft)' }}>
            <Icon name="grid" className="h-3.5 w-3.5" />
          </button>
          <button onClick={() => setViewMode('list')} title="List view" className="h-9 w-9 flex items-center justify-center transition-colors border-l" style={{ borderColor: 'var(--color-line)', backgroundColor: viewMode === 'list' ? 'var(--color-ink)' : 'transparent', color: viewMode === 'list' ? 'var(--color-frost)' : 'var(--color-char-soft)' }}>
            <Icon name="list" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <SaveChangesBar pendingCount={Object.keys(draft).length} saving={savingChanges} onSave={saveChanges} onDiscard={() => setDraft({})} />

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="chamfer max-w-lg">
          <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            {subTab === 'catalog' ? 'No catalog videos match your filters.' : 'No institution-specific videos yet.'}
          </p>
        </Card>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((v, i) => (
            <VideoCard
              key={v.id}
              video={v}
              index={i}
              onOpen={() => setPreviewVideo(v)}
              {...videoControls(v)}
            />
          ))}
        </div>
      ) : (
        <div className="border rounded-[10px] overflow-hidden" style={{ backgroundColor: 'var(--color-paper)', borderColor: 'var(--color-line)' }}>
          {filtered.map((v, i) => (
            <VideoListRow
              key={v.id}
              video={v}
              isLast={i === filtered.length - 1}
              onOpen={() => setPreviewVideo(v)}
              {...videoControls(v)}
            />
          ))}
        </div>
      )}

      {previewVideo && <VideoPreviewModal video={previewVideo} onClose={() => setPreviewVideo(null)} />}
    </InstitutionAdminShell>
  )
}
