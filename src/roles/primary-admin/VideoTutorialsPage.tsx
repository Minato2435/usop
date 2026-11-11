import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { PrimaryAdminShell } from './shell/PrimaryAdminShell'
import { Card, PrimaryButton, GhostButton, Skeleton, Badge, inputClass } from './shell/ui'
import { Icon } from './shell/Icon'
import {
  VideoCard,
  VideoListRow,
  VideoPreviewModal,
  deleteVideoAndFiles,
} from './shell/VideoShared'
import { InstitutionPickerModal } from './shell/InstitutionPicker'
import { VideoBatchesSection } from './VideoBatchesSection'
import { watchAllVideoTutorials, updateVideoTutorial, isVideoActive, ALL_DEPARTMENTS } from '../../lib/firestore/videoTutorials'
import { watchAllDepartments } from '../../lib/firestore/departments'
import { MBBS_YEARS } from '../../lib/academicStructure'
import type { Department, MbbsYear, VideoAudience, VideoTutorial } from '../../types'

type SortOrder = 'name-asc' | 'name-desc' | 'newest' | 'oldest'
const SORT_LABELS: Record<SortOrder, string> = {
  'name-asc': 'Name (A → Z)',
  'name-desc': 'Name (Z → A)',
  newest: 'Newest first',
  oldest: 'Oldest first',
}

const BORDER = 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)'

// Video tutorials are Primary-Admin-authored catalog content — department +
// MBBS year + audience (student/faculty) tagged, same shared-catalog
// convention as Department/LogTemplate. This page is the *global* catalog
// only (institutionId === ""); institution-exclusive videos are managed
// from that institution's own Videos tab in the Institution Management
// portal (InstitutionDetailPage.tsx), reusing the exact same form/card/row/
// preview components from ./shell/VideoShared.
export function PrimaryAdminVideoTutorialsPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [allVideos, setAllVideos] = useState<VideoTutorial[] | null>(null)
  const [departments, setDepartments] = useState<Department[] | null>(null)
  const [institutionPickerOpen, setInstitutionPickerOpen] = useState(false)
  // A second top-level panel on this page, alongside the catalog — Primary
  // Admin clubs students/faculty into a batch and grants them one specific
  // video for a scheduled window (see VideoBatchesSection.tsx). Batch
  // creation itself is a full page (VideoBatchCreatePage.tsx), which
  // navigates back here with ?tab=batches so returning from it lands back
  // on the tab it was created from, not a reset-to-default Catalog tab.
  const [pageTab, setPageTab] = useState<'catalog' | 'batches'>(searchParams.get('tab') === 'batches' ? 'batches' : 'catalog')

  useEffect(() => watchAllVideoTutorials(setAllVideos), [])
  useEffect(() => watchAllDepartments(setDepartments), [])

  // watchAllVideoTutorials returns every video platform-wide, including
  // institution-exclusive ones — this page is only the shared catalog
  // (institutionId === ""), same fix already applied to DepartmentsPage.tsx
  // for the identical bug class.
  const videos = useMemo(() => (allVideos ? allVideos.filter((v) => v.institutionId === '') : null), [allVideos])

  const departmentOptions = useMemo(
    () => (departments ?? []).filter((d) => d.institutionId === '').map((d) => d.name).sort((a, b) => a.localeCompare(b)),
    [departments],
  )

  // Filters
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState<'all' | string>('all')
  const [yearFilter, setYearFilter] = useState<MbbsYear | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all')
  // Not a plain filter — a page-mode switch, like the Global/Institution-
  // specific sub-tabs elsewhere in the admin panel: this page is always
  // showing either the student track or the faculty track, never a mixed
  // "all" view, since the two are meant to read as two distinct spaces.
  const [audienceFilter, setAudienceFilter] = useState<VideoAudience>('student')
  const [sortOrder, setSortOrder] = useState<SortOrder>('newest')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

    const [previewVideo, setPreviewVideo] = useState<VideoTutorial | null>(null)

  const loading = !videos
  const catalogEmpty = !loading && videos!.length === 0

  const filtered = useMemo(() => {
    if (!videos) return []
    const q = search.trim().toLowerCase()
    return videos.filter((v) => {
      const matchesSearch = q === '' || v.title.toLowerCase().includes(q)
      const matchesDept = deptFilter === 'all' || v.department === deptFilter
      // Faculty videos aren't year-scoped, so the year filter only applies to students.
      const matchesYear = audienceFilter === 'faculty' || yearFilter === 'all' || v.mbbsYear === yearFilter
      const matchesAudience = v.audience === audienceFilter
      const matchesStatus = statusFilter === 'all' || (statusFilter === 'enabled') === isVideoActive(v)
      return matchesSearch && matchesDept && matchesYear && matchesAudience && matchesStatus
    })
  }, [videos, search, deptFilter, yearFilter, audienceFilter, statusFilter])

  const filtersActive = search.trim() !== '' || deptFilter !== 'all' || yearFilter !== 'all' || statusFilter !== 'all'
  const noMatches = !loading && !catalogEmpty && filtered.length === 0

  function sortVideos(list: VideoTutorial[]): VideoTutorial[] {
    const copy = [...list]
    copy.sort((a, b) => {
      if (sortOrder === 'name-desc') return b.title.localeCompare(a.title)
      if (sortOrder === 'name-asc') return a.title.localeCompare(b.title)
      return sortOrder === 'newest' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt
    })
    return copy
  }

  const yearGroups = useMemo(() => {
    // Faculty videos have no year — one flat group.
    if (audienceFilter === 'faculty') {
      const all = sortVideos(filtered)
      return all.length > 0 ? [{ year: null as MbbsYear | null, videos: all }] : []
    }
    return MBBS_YEARS.map((year) => ({ year, videos: sortVideos(filtered.filter((v) => v.mbbsYear === year)) })).filter(
      (g) => g.videos.length > 0,
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortOrder, audienceFilter])

  const studentCount = (videos ?? []).filter((v) => v.audience === 'student').length
  const facultyCount = (videos ?? []).filter((v) => v.audience === 'faculty').length
  const departmentsCovered = new Set((videos ?? []).map((v) => v.department).filter((d) => d !== ALL_DEPARTMENTS)).size

  return (
    <PrimaryAdminShell
      eyebrow="Content"
      title="Video tutorials"
      actions={
        pageTab === 'catalog' ? (
          <div className="flex items-center gap-2">
            <GhostButton onClick={() => setInstitutionPickerOpen(true)}>
              <Icon name="institutions" className="h-3.5 w-3.5" />
              By institution
            </GhostButton>
            <PrimaryButton onClick={() => navigate('/admin/video-tutorials/new')}>
              <Icon name="plus" className="h-3.5 w-3.5" />
              New video
            </PrimaryButton>
          </div>
        ) : (
          <PrimaryButton onClick={() => navigate('/admin/video-tutorials/batches/new')}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            New batch
          </PrimaryButton>
        )
      }
    >
      <div className="inline-flex border rounded-[6px] overflow-hidden mb-6" style={{ borderColor: 'var(--color-line)' }}>
        <button
          onClick={() => setPageTab('catalog')}
          className="px-5 py-2.5 text-[13px] font-medium transition-colors"
          style={{
            backgroundColor: pageTab === 'catalog' ? 'var(--color-ink)' : 'transparent',
            color: pageTab === 'catalog' ? 'var(--color-frost)' : 'var(--color-char-soft)',
          }}
        >
          Catalog
        </button>
        <button
          onClick={() => setPageTab('batches')}
          className="px-5 py-2.5 text-[13px] font-medium transition-colors border-l"
          style={{
            borderColor: 'var(--color-line)',
            backgroundColor: pageTab === 'batches' ? 'var(--color-ink)' : 'transparent',
            color: pageTab === 'batches' ? 'var(--color-frost)' : 'var(--color-char-soft)',
          }}
        >
          Batches
        </button>
      </div>

      {pageTab === 'batches' ? (
        <VideoBatchesSection departments={departments ?? []} />
      ) : (
      <>
      {!loading && !catalogEmpty && (
        <>
          <div
            className="grid grid-cols-2 sm:grid-cols-4 border rounded-[6px] overflow-hidden mb-7 divide-x divide-y sm:divide-y-0 divide-[var(--color-line)]"
            style={{ borderColor: 'var(--color-line)' }}
          >
            <div className="px-5 py-4">
              <div className="font-display text-[28px] leading-none tabular-nums" style={{ color: 'var(--color-gold)' }}>
                {videos!.length}
              </div>
              <div className="mt-2 text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                Videos
              </div>
            </div>
            <div className="px-5 py-4">
              <div className="font-display text-[28px] leading-none tabular-nums" style={{ color: 'var(--color-char)' }}>
                {studentCount}
              </div>
              <div className="mt-2 text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                Student videos
              </div>
            </div>
            <div className="px-5 py-4">
              <div className="font-display text-[28px] leading-none tabular-nums" style={{ color: 'var(--color-char)' }}>
                {facultyCount}
              </div>
              <div className="mt-2 text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                Faculty videos
              </div>
            </div>
            <div className="px-5 py-4">
              <div className="font-display text-[28px] leading-none tabular-nums" style={{ color: 'var(--color-char)' }}>
                {departmentsCovered}
              </div>
              <div className="mt-2 text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                Departments covered
              </div>
            </div>
          </div>

          <div className="inline-flex border rounded-[6px] overflow-hidden mb-6" style={{ borderColor: 'var(--color-line)' }}>
            <button
              onClick={() => setAudienceFilter('student')}
              className="px-5 py-2.5 text-[13px] font-medium transition-colors"
              style={{
                backgroundColor: audienceFilter === 'student' ? 'var(--color-ink)' : 'transparent',
                color: audienceFilter === 'student' ? 'var(--color-frost)' : 'var(--color-char-soft)',
              }}
            >
              Student videos
            </button>
            <button
              onClick={() => setAudienceFilter('faculty')}
              className="px-5 py-2.5 text-[13px] font-medium transition-colors border-l"
              style={{
                borderColor: 'var(--color-line)',
                backgroundColor: audienceFilter === 'faculty' ? 'var(--color-ink)' : 'transparent',
                color: audienceFilter === 'faculty' ? 'var(--color-frost)' : 'var(--color-char-soft)',
              }}
            >
              Faculty videos
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 mb-6">
            <div className="relative flex-1 min-w-[200px]">
              <Icon
                name="search"
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none"
                style={{ color: 'var(--color-char-soft)' }}
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search videos"
                className={`${inputClass} pl-8`}
                style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              />
            </div>
            <select
              className={inputClass}
              style={{ width: 172, borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
            >
              <option value="all">Any department</option>
              <option value={ALL_DEPARTMENTS}>Published to all departments</option>
              {departmentOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              style={{ width: 140, borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'enabled' | 'disabled')}
            >
              <option value="all">Any status</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
            {audienceFilter === 'student' && (
            <select
              className={inputClass}
              style={{ width: 140, borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value === 'all' ? 'all' : (Number(e.target.value) as MbbsYear))}
            >
              <option value="all">All years</option>
              {MBBS_YEARS.map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
            )}
            <select
              className={inputClass}
              style={{ width: 172, borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value as SortOrder)}
            >
              {(Object.keys(SORT_LABELS) as SortOrder[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </select>
            <div className="inline-flex border rounded-[6px] overflow-hidden shrink-0" style={{ borderColor: 'var(--color-line)' }}>
              <button
                onClick={() => setViewMode('grid')}
                title="Grid view"
                className="h-8 w-9 flex items-center justify-center transition-colors"
                style={{
                  backgroundColor: viewMode === 'grid' ? 'var(--color-ink)' : 'transparent',
                  color: viewMode === 'grid' ? 'var(--color-frost)' : 'var(--color-char-soft)',
                }}
              >
                <Icon name="grid" className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                title="List view"
                className="h-8 w-9 flex items-center justify-center transition-colors border-l"
                style={{
                  borderColor: 'var(--color-line)',
                  backgroundColor: viewMode === 'list' ? 'var(--color-ink)' : 'transparent',
                  color: viewMode === 'list' ? 'var(--color-frost)' : 'var(--color-char-soft)',
                }}
              >
                <Icon name="list" className="h-3.5 w-3.5" />
              </button>
            </div>
            {filtersActive && (
              <button
                onClick={() => {
                  setSearch('')
                  setDeptFilter('all')
                  setYearFilter('all')
                }}
                className="text-[11.5px] font-medium hover:opacity-70 transition-opacity"
                style={{ color: 'var(--color-gold)' }}
              >
                Clear filters
              </button>
            )}
          </div>
        </>
      )}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : catalogEmpty ? (
        <Card className="chamfer max-w-lg">
          <p className="text-[13.5px] mb-4" style={{ color: 'var(--color-char-soft)' }}>
            No video tutorials yet — add one for a department's students or faculty to start
            building the library.
          </p>
          <PrimaryButton onClick={() => navigate('/admin/video-tutorials/new')}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            Add the first video
          </PrimaryButton>
        </Card>
      ) : noMatches ? (
        <Card className="chamfer max-w-lg">
          <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            No videos match the current filters.
          </p>
        </Card>
      ) : (
        <div className="space-y-8">
          {yearGroups.map(({ year, videos: yearVideos }) => (
            <div key={year ?? 'faculty'}>
              <div className="flex items-center gap-2 mb-3">
                <Badge tone="gold">{year ? `Year ${year}` : 'All faculty videos'}</Badge>
                <span className="text-[11px]" style={{ color: 'var(--color-char-soft)' }}>
                  {yearVideos.length} video{yearVideos.length === 1 ? '' : 's'}
                </span>
              </div>
              {viewMode === 'grid' ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {yearVideos.map((v, i) => (
                    <VideoCard
                      key={v.id}
                      video={v}
                      index={i}
                      onOpen={() => setPreviewVideo(v)}
                      onEdit={() => navigate(`/admin/video-tutorials/${v.id}/edit`)}
                      onDelete={() => deleteVideoAndFiles(v)}
                      enabled={isVideoActive(v)}
                      onToggle={() => updateVideoTutorial(v.id, { active: !isVideoActive(v) })}
                      toggleKind="publish"
                    />
                  ))}
                </div>
              ) : (
                <div className="border rounded-[10px] overflow-hidden" style={{ backgroundColor: 'var(--color-paper)', borderColor: BORDER }}>
                  {yearVideos.map((v, i) => (
                    <VideoListRow
                      key={v.id}
                      video={v}
                      isLast={i === yearVideos.length - 1}
                      onOpen={() => setPreviewVideo(v)}
                      onEdit={() => navigate(`/admin/video-tutorials/${v.id}/edit`)}
                      onDelete={() => deleteVideoAndFiles(v)}
                      enabled={isVideoActive(v)}
                      onToggle={() => updateVideoTutorial(v.id, { active: !isVideoActive(v) })}
                      toggleKind="publish"
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}


      {previewVideo && <VideoPreviewModal video={previewVideo} onClose={() => setPreviewVideo(null)} />}

      {institutionPickerOpen && (
        <InstitutionPickerModal
          title="Open an institution's videos"
          description="Pick an institution to see which videos are included for them, plus any video exclusive to that institution."
          onClose={() => setInstitutionPickerOpen(false)}
          onSelect={(inst) => navigate(`/admin/institutions/${inst.id}?tab=videos`)}
        />
      )}
      </>
      )}
    </PrimaryAdminShell>
  )
}
