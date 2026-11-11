import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { PrimaryAdminShell } from './shell/PrimaryAdminShell'
import { Card, Field, GhostButton, Modal, PrimaryButton, Skeleton, Badge, inputClass } from './shell/ui'
import { Icon } from './shell/Icon'
import { CreateTemplateModal } from '../../components/formEngine/CreateTemplateModal'
import { VideoCard, VideoListRow, VideoThumbnail, VideoPreviewModal, deleteVideoAndFiles, AUDIENCE_LABELS } from './shell/VideoShared'
import { watchInstitution } from '../../lib/firestore/institutions'
import {
  watchAllDepartments,
  createDepartment,
  deleteDepartment,
  watchInstitutionDepartmentOverrides,
  setDepartmentEnabledForInstitution,
} from '../../lib/firestore/departments'
import {
  watchGlobalTemplates,
  watchInstitutionTemplates,
  watchTreeNodes,
  createTemplate,
  deleteTemplate,
  watchInstitutionCompetencyOverrides,
  setCompetencyEnabledForInstitution,
  watchInstitutionCompetencyFormOverrides,
  deleteInstitutionCompetencyFormOverride,
  deleteTreeNode,
} from '../../lib/firestore/logTemplates'
import { deleteFormSchema } from '../../lib/firestore/formSchemas'
import { watchAllVideoTutorials, watchInstitutionVideoOverrides, setVideoEnabledForInstitution } from '../../lib/firestore/videoTutorials'
import { useAuth } from '../../auth/AuthContext'
import { MBBS_YEARS } from '../../lib/academicStructure'
import type {
  Department,
  Institution,
  InstitutionDepartmentOverride,
  InstitutionCompetencyOverride,
  InstitutionCompetencyFormOverride,
  InstitutionVideoOverride,
  LogTemplate,
  LogType,
  MbbsYear,
  TreeNode,
  VideoAudience,
  VideoTutorial,
} from '../../types'

type Tab = 'departments' | 'sslLogs' | 'competencies' | 'videos'

const BORDER = 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)'
const ROW_DIVIDER = '1px solid color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)'

type NameSortOrder = 'name-asc' | 'name-desc'
const NAME_SORT_LABELS: Record<NameSortOrder, string> = {
  'name-asc': 'Name (A → Z)',
  'name-desc': 'Name (Z → A)',
}

// A single institution's management portal — opened by clicking its card on
// the Institutions list. Structurally adapted from a design reference
// (attaching references/Institution Management Portal.dc.html — a tabbed
// department/competency/template browser with a stat header) onto our own
// ink/gold/Cormorant Garamond design language and real data model. Every
// catalog department and every global SSL competency is enabled for every
// institution by default (absence of an override doc means enabled); this
// page is where a Primary Admin curates per-institution exclusions, on top
// of letting the institution have its own exclusive departments and SSL
// templates. The reference's per-department "code" field and templates'
// "field count" don't exist in our data model, so those are dropped rather
// than fabricated — MBBS-year badges and live competency counts stand in
// for them, since we do have that data.
export function PrimaryAdminInstitutionDetailPage() {
  const { institutionId } = useParams<{ institutionId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { appUser } = useAuth()

  const [institution, setInstitution] = useState<Institution | null | undefined>(undefined)
  useEffect(() => {
    if (!institutionId) return
    return watchInstitution(institutionId, setInstitution)
  }, [institutionId])

  // Lets other pages deep-link straight into a tab (e.g. the Competencies
  // page's "By institution" picker → `?tab=competencies`) instead of
  // always landing on Departments. Read once on mount, not kept in sync
  // with the URL afterward — same convention as `?institutionId=` on
  // CompetencyEditorPage.tsx.
  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get('tab')
    return t === 'sslLogs' || t === 'competencies' || t === 'videos' ? t : 'departments'
  })
  const [deptSubTab, setDeptSubTab] = useState<'global' | 'own'>('global')
  const [sslSubTab, setSslSubTab] = useState<'global' | 'own'>('global')
  const [compFormSubTab, setCompFormSubTab] = useState<'global' | 'own'>('global')
  const [videoSubTab, setVideoSubTab] = useState<'global' | 'own'>('global')
  const [videoViewMode, setVideoViewMode] = useState<'grid' | 'list'>('grid')
  const [videoSearch, setVideoSearch] = useState('')
  const [videoYearFilter, setVideoYearFilter] = useState<'all' | MbbsYear>('all')
  const [videoAudienceFilter, setVideoAudienceFilter] = useState<'all' | VideoAudience>('all')
  // Checklist attached/not — meaningful on both Competencies sub-tabs (a
  // global competency's own form, or an institution-owned skill's form).
  const [compChecklistFilter, setCompChecklistFilter] = useState<'all' | 'with' | 'without'>('all')
  // Whether this institution has its own edited version — on Global
  // Competencies, "customized" means a formOverride exists for that node;
  // on Institution-specific Competencies, it's the same idea applied to an
  // already-institution-specific list, so it doubles as a fork/native type
  // filter there.
  const [compEditedFilter, setCompEditedFilter] = useState<'all' | 'edited' | 'notEdited'>('all')
  const [deptSearch, setDeptSearch] = useState('')
  const [deptSort, setDeptSort] = useState<NameSortOrder>('name-asc')
  const [deptYearFilter, setDeptYearFilter] = useState<'all' | MbbsYear>('all')
  const [sslSearch, setSslSearch] = useState('')
  const [sslSort, setSslSort] = useState<NameSortOrder>('name-asc')
  const [sslYearFilter, setSslYearFilter] = useState<'all' | MbbsYear>('all')
  const [sslDepartmentFilter, setSslDepartmentFilter] = useState<'all' | string>('all')

  function filterSortDepts(list: Department[]): Department[] {
    const q = deptSearch.trim().toLowerCase()
    let filtered = q ? list.filter((d) => d.name.toLowerCase().includes(q)) : list
    if (deptYearFilter !== 'all') filtered = filtered.filter((d) => d.mbbsYear === deptYearFilter)
    return [...filtered].sort((a, b) => (deptSort === 'name-desc' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)))
  }

  // Same list, grouped into "Year N" sections — used for both the catalog
  // and institution-only lists so they share one consistent structure.
  function groupDeptsByYear(list: Department[]): { year: MbbsYear; depts: Department[] }[] {
    const filtered = filterSortDepts(list)
    const years = deptYearFilter === 'all' ? MBBS_YEARS : [deptYearFilter]
    return years
      .map((year) => ({ year, depts: filtered.filter((d) => d.mbbsYear === year) }))
      .filter((g) => g.depts.length > 0)
  }

  // --- Departments -----------------------------------------------------
  const [departments, setDepartments] = useState<Department[] | null>(null)
  const [deptOverrides, setDeptOverrides] = useState<InstitutionDepartmentOverride[]>([])
  useEffect(() => watchAllDepartments(setDepartments), [])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionDepartmentOverrides(institutionId, setDeptOverrides)
  }, [institutionId])

  const catalogDepartments = useMemo(
    () => (departments ?? []).filter((d) => d.institutionId === '').sort((a, b) => a.name.localeCompare(b.name)),
    [departments],
  )
  const ownDepartments = useMemo(
    () => (departments ?? []).filter((d) => d.institutionId === institutionId).sort((a, b) => a.name.localeCompare(b.name)),
    [departments, institutionId],
  )

  // Every department name in play for this institution — used to populate
  // the SSL Logs department filter (catalog + this institution's own).
  const allDepartmentNames = useMemo(() => {
    const names = new Set([...catalogDepartments.map((d) => d.name), ...ownDepartments.map((d) => d.name)])
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [catalogDepartments, ownDepartments])

  // Toggling a department (individually or via "Include all") only edits
  // this local draft — nothing is written to Firestore until "Save
  // changes" is clicked. `isDeptEnabled` checks the draft first, falling
  // back to the last-saved override, falling back to the true default.
  const [deptDraft, setDeptDraft] = useState<Record<string, boolean>>({})
  const [deptSavingChanges, setDeptSavingChanges] = useState(false)

  function isDeptEnabled(departmentId: string): boolean {
    if (departmentId in deptDraft) return deptDraft[departmentId]
    const override = deptOverrides.find((o) => o.departmentId === departmentId)
    return override ? override.enabled : true
  }

  function stageDeptToggle(departmentId: string) {
    setDeptDraft((prev) => ({ ...prev, [departmentId]: !isDeptEnabled(departmentId) }))
  }

  // Shared by both the catalog list and the institution-only department
  // grid — own departments use the exact same override mechanism as
  // catalog ones (a department override doc doesn't care whether the
  // department it points at is shared or exclusive), so "toggle it off"
  // and "select/deselect all" behave identically for both.
  function stageDeptGroupAll(list: Department[], enabled: boolean) {
    setDeptDraft((prev) => {
      const next = { ...prev }
      list.forEach((d) => {
        next[d.id] = enabled
      })
      return next
    })
  }

  function discardDeptChanges() {
    setDeptDraft({})
  }

  async function saveDeptChanges() {
    if (!institutionId) return
    setDeptSavingChanges(true)
    await Promise.all(
      Object.entries(deptDraft).map(([id, enabled]) => setDepartmentEnabledForInstitution(institutionId, id, enabled)),
    )
    setDeptSavingChanges(false)
    setDeptDraft({})
  }

  const includedDepartmentNames = useMemo(() => {
    const names = new Set<string>()
    ;[...catalogDepartments, ...ownDepartments].forEach((d) => {
      if (isDeptEnabled(d.id)) names.add(d.name)
    })
    return names
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogDepartments, ownDepartments, deptOverrides, deptDraft])

  const excludedCatalogDepartments = catalogDepartments.filter((d) => !isDeptEnabled(d.id))
  const includedCatalogCount = catalogDepartments.length - excludedCatalogDepartments.length

  const [deptModalOpen, setDeptModalOpen] = useState(false)
  const [deptName, setDeptName] = useState('')
  const [deptYear, setDeptYear] = useState<MbbsYear>(1)
  const [deptDescription, setDeptDescription] = useState('')
  const [deptSaving, setDeptSaving] = useState(false)

  function closeDeptModal() {
    setDeptModalOpen(false)
    setDeptName('')
    setDeptYear(1)
    setDeptDescription('')
  }

  async function handleCreateDepartment() {
    if (!institutionId || !deptName.trim()) return
    setDeptSaving(true)
    await createDepartment({
      institutionId,
      name: deptName.trim(),
      mbbsYear: deptYear,
      description: deptDescription.trim(),
    })
    setDeptSaving(false)
    closeDeptModal()
  }

  // --- Global SSL competencies ------------------------------------------
  const [globalTemplates, setGlobalTemplates] = useState<LogTemplate[] | null>(null)
  const [nodesByTemplate, setNodesByTemplate] = useState<Record<string, TreeNode[]>>({})
  const [competencyOverrides, setCompetencyOverrides] = useState<InstitutionCompetencyOverride[]>([])

  useEffect(() => watchGlobalTemplates({}, (all) => setGlobalTemplates(all.filter((t) => t.logType === 'SSL'))), [])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionCompetencyOverrides(institutionId, setCompetencyOverrides)
  }, [institutionId])

  // --- Institution-specific forked evaluation forms (Competencies tab) --
  const [formOverrides, setFormOverrides] = useState<InstitutionCompetencyFormOverride[]>([])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionCompetencyFormOverrides(institutionId, setFormOverrides)
  }, [institutionId])

  function formOverrideFor(nodeId: string): InstitutionCompetencyFormOverride | undefined {
    return formOverrides.find((o) => o.nodeId === nodeId)
  }

  async function handleResetToGlobal(override: InstitutionCompetencyFormOverride) {
    await deleteFormSchema(override.formSchemaId)
    await deleteInstitutionCompetencyFormOverride(override.institutionId, override.nodeId)
  }

  // node lookup across every global template's tree — used by the
  // Institution-specific Competencies list to show each override's title
  // and department without re-deriving competencyGroups (which filters to
  // included departments only, and overrides should still show even if the
  // department was excluded afterward).
  const nodeLookup = useMemo(() => {
    const map: Record<string, { node: TreeNode; template: LogTemplate }> = {}
    ;(globalTemplates ?? []).forEach((t) => {
      ;(nodesByTemplate[t.id] ?? []).forEach((n) => {
        map[n.id] = { node: n, template: t }
      })
    })
    return map
  }, [globalTemplates, nodesByTemplate])

  const globalTemplateIds = useMemo(() => (globalTemplates ?? []).map((t) => t.id).join(','), [globalTemplates])
  useEffect(() => {
    if (!globalTemplates) return
    const unsubs = globalTemplates.map((t) =>
      watchTreeNodes(t.id, (nodes) => setNodesByTemplate((prev) => ({ ...prev, [t.id]: nodes }))),
    )
    return () => unsubs.forEach((u) => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalTemplateIds])

  // Same draft-then-save pattern as departments above.
  const [compDraft, setCompDraft] = useState<Record<string, boolean>>({})
  const [compSavingChanges, setCompSavingChanges] = useState(false)

  function isCompetencyEnabled(nodeId: string): boolean {
    if (nodeId in compDraft) return compDraft[nodeId]
    const override = competencyOverrides.find((o) => o.nodeId === nodeId)
    return override ? override.enabled : true
  }

  function stageCompToggle(nodeId: string) {
    setCompDraft((prev) => ({ ...prev, [nodeId]: !isCompetencyEnabled(nodeId) }))
  }

  function stageAllInGroup(nodes: TreeNode[], enabled: boolean) {
    setCompDraft((prev) => {
      const next = { ...prev }
      nodes.forEach((n) => {
        next[n.id] = enabled
      })
      return next
    })
  }

  function discardCompChanges() {
    setCompDraft({})
  }

  async function saveCompChanges() {
    if (!institutionId) return
    setCompSavingChanges(true)
    await Promise.all(
      Object.entries(compDraft).map(([id, enabled]) => setCompetencyEnabledForInstitution(institutionId, id, enabled)),
    )
    setCompSavingChanges(false)
    setCompDraft({})
  }

  // Counts against every catalog department (not just included ones), so
  // the Departments tab can show "X / Y competencies" even for a currently
  // excluded department — matches the reference's per-row count column.
  const deptCompCounts = useMemo(() => {
    const map: Record<string, { total: number; included: number }> = {}
    ;(globalTemplates ?? []).forEach((t) => {
      const nodes = nodesByTemplate[t.id] ?? []
      const entry = map[t.department] ?? { total: 0, included: 0 }
      entry.total += nodes.length
      entry.included += nodes.filter((n) => isCompetencyEnabled(n.id)).length
      map[t.department] = entry
    })
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalTemplates, nodesByTemplate, competencyOverrides, compDraft])

  const competencyGroups = useMemo(() => {
    return (globalTemplates ?? [])
      .filter((t) => includedDepartmentNames.has(t.department))
      .map((t) => ({ template: t, nodes: (nodesByTemplate[t.id] ?? []).slice().sort((a, b) => a.order - b.order) }))
      .filter((g) => g.nodes.length > 0)
      .sort((a, b) => a.template.department.localeCompare(b.template.department))
  }, [globalTemplates, nodesByTemplate, includedDepartmentNames])

  const totalComps = competencyGroups.reduce((sum, g) => sum + g.nodes.length, 0)
  const includedComps = competencyGroups.reduce(
    (sum, g) => sum + g.nodes.filter((n) => isCompetencyEnabled(n.id)).length,
    0,
  )

  // Same "Year N" sectioning as the Departments tab — each global SSL
  // template carries one mbbsYear, so its department-card slots into that
  // year's section.
  const competencyYearGroups = useMemo(
    () =>
      MBBS_YEARS.map((year) => ({ year, groups: competencyGroups.filter((g) => g.template.mbbsYear === year) })).filter(
        (yg) => yg.groups.length > 0,
      ),
    [competencyGroups],
  )

  // Search/year/sort applied on top of competencyYearGroups for display —
  // a department stays visible if its name matches, or any competency
  // inside it does (so searching a skill by name still surfaces it), but
  // the rows shown and the counts/progress bar stay based on the full
  // group so Select-all/Deselect-all and the stats never disagree with
  // what's actually saved.
  function visibleCompetencyYearGroups() {
    const q = sslSearch.trim().toLowerCase()
    return competencyYearGroups
      .filter((yg) => sslYearFilter === 'all' || yg.year === sslYearFilter)
      .map((yg) => ({
        year: yg.year,
        groups: yg.groups
          .filter((g) => sslDepartmentFilter === 'all' || g.template.department === sslDepartmentFilter)
          .filter(
            (g) =>
              q === '' ||
              g.template.department.toLowerCase().includes(q) ||
              g.nodes.some((n) => n.title.toLowerCase().includes(q)),
          )
          .sort((a, b) =>
            sslSort === 'name-desc'
              ? b.template.department.localeCompare(a.template.department)
              : a.template.department.localeCompare(b.template.department),
          ),
      }))
      .filter((yg) => yg.groups.length > 0)
  }

  // Same base data as visibleCompetencyYearGroups above, with the
  // Competencies tab's own checklist-attached/customized filters applied
  // per node (not per group) — kept separate from that function since the
  // SSL Logs tab's Global SSL sub-tab shares the same base data but has no
  // use for these two filters.
  function visibleGlobalCompetenciesForCompTab() {
    return visibleCompetencyYearGroups()
      .map((yg) => ({
        year: yg.year,
        groups: yg.groups
          .map((g) => ({
            template: g.template,
            nodes: g.nodes.filter((n) => {
              if (compChecklistFilter !== 'all' && (compChecklistFilter === 'with') !== !!n.formSchemaId) return false
              if (compEditedFilter !== 'all' && (compEditedFilter === 'edited') !== !!formOverrideFor(n.id)) return false
              return true
            }),
          }))
          .filter((g) => g.nodes.length > 0),
      }))
      .filter((yg) => yg.groups.length > 0)
  }

  // Same base data as visibleGlobalCompetenciesForCompTab, just re-bucketed
  // by department instead of by year — the Competencies tab's own
  // categorization (matching how the Institution Admin panel's
  // Competencies page groups: department heading first, one card per SSL
  // log underneath). The Departments/SSL Logs tabs above keep the
  // year-first grouping untouched; this is purely a display re-shape for
  // this one tab, not a change to the underlying year-filtered data.
  function visibleGlobalCompetencyDepartmentGroups() {
    const flat = visibleGlobalCompetenciesForCompTab().flatMap((yg) => yg.groups)
    const byDept = new Map<string, { template: LogTemplate; nodes: TreeNode[] }[]>()
    flat.forEach((g) => {
      const arr = byDept.get(g.template.department) ?? []
      arr.push(g)
      byDept.set(g.template.department, arr)
    })
    return [...byDept.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([department, groups]) => ({
        department,
        groups: groups.slice().sort((a, b) => a.template.title.localeCompare(b.template.title)),
      }))
  }

  // --- This institution's own SSL templates -----------------------------
  const [ownTemplates, setOwnTemplates] = useState<LogTemplate[] | null>(null)
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionTemplates(institutionId, {}, setOwnTemplates)
  }, [institutionId])

  // Each institution-owned log has its own competency tree, same as a
  // global SSL template — loaded so a log's row can show what skills it
  // actually contains instead of just repeating its own title.
  const [ownNodesByTemplate, setOwnNodesByTemplate] = useState<Record<string, TreeNode[]>>({})
  const ownTemplateIds = useMemo(() => (ownTemplates ?? []).map((t) => t.id).join(','), [ownTemplates])
  useEffect(() => {
    if (!ownTemplates) return
    const unsubs = ownTemplates.map((t) =>
      watchTreeNodes(t.id, (nodes) => setOwnNodesByTemplate((prev) => ({ ...prev, [t.id]: nodes }))),
    )
    return () => unsubs.forEach((u) => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownTemplateIds])

  // Flat year → logs list, one card per log — same shape as the Global SSL
  // view (one card per department there, since a department has exactly
  // one global template; one card per log here, since a department can
  // have several institution-owned logs). No department-wrapper nesting
  // layer, so both views read as the same simple pattern.
  function visibleOwnTemplates(): { year: MbbsYear; templates: LogTemplate[] }[] {
    const q = sslSearch.trim().toLowerCase()
    const years = sslYearFilter === 'all' ? MBBS_YEARS : [sslYearFilter]
    return years
      .map((year) => {
        const templates = (ownTemplates ?? [])
          .filter((t) => t.mbbsYear === year)
          .filter((t) => sslDepartmentFilter === 'all' || t.department === sslDepartmentFilter)
          .filter((t) => q === '' || t.title.toLowerCase().includes(q) || t.department.toLowerCase().includes(q))
          .sort((a, b) => (sslSort === 'name-desc' ? b.title.localeCompare(a.title) : a.title.localeCompare(b.title)))
        return { year, templates }
      })
      .filter((yg) => yg.templates.length > 0)
  }

  const [creatingTemplate, setCreatingTemplate] = useState(false)
  const [confirmDeleteTemplateId, setConfirmDeleteTemplateId] = useState<string | null>(null)
  const [deletingTemplate, setDeletingTemplate] = useState(false)

  async function handleCreateTemplate(input: { logType: LogType; department: string; mbbsYear: MbbsYear; title: string }) {
    if (!institutionId) return
    await createTemplate({
      ...input,
      scope: 'institution',
      institutionId,
      createdBy: appUser?.uid ?? '',
    })
    setCreatingTemplate(false)
  }

  // Removes one of this institution's own logs entirely — unlike a plain
  // deleteTemplate() call (which only removes the template doc, same as
  // the global Log Templates page does today), this also cleans up every
  // skill node under it and each node's own FormSchema, so nothing orphaned
  // is left behind: the user explicitly wants "delete the log, all its
  // skills go with it."
  async function handleDeleteOwnTemplate(template: LogTemplate) {
    const nodes = ownNodesByTemplate[template.id] ?? []
    await Promise.all(nodes.filter((n) => n.formSchemaId).map((n) => deleteFormSchema(n.formSchemaId!)))
    await Promise.all(nodes.map((n) => deleteTreeNode(template.id, n.id)))
    await deleteTemplate(template.id)
  }

  const ownDepartmentOptionsByYear = useMemo(() => {
    const byYear: Record<MbbsYear, string[]> = { 1: [], 2: [], 3: [], 4: [] }
    ;[...catalogDepartments.filter((d) => isDeptEnabled(d.id)), ...ownDepartments].forEach((d) => {
      byYear[d.mbbsYear].push(d.name)
    })
    return byYear
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogDepartments, ownDepartments, deptOverrides, deptDraft])

  // --- Videos -------------------------------------------------------------
  const [allVideos, setAllVideos] = useState<VideoTutorial[] | null>(null)
  const [videoOverrides, setVideoOverrides] = useState<InstitutionVideoOverride[]>([])
  useEffect(() => watchAllVideoTutorials(setAllVideos), [])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionVideoOverrides(institutionId, setVideoOverrides)
  }, [institutionId])

  const catalogVideos = useMemo(() => (allVideos ?? []).filter((v) => v.institutionId === ''), [allVideos])
  const ownVideos = useMemo(
    () => (allVideos ?? []).filter((v) => v.institutionId === institutionId),
    [allVideos, institutionId],
  )

  // Same draft-then-save pattern as departments/competencies above.
  const [videoDraft, setVideoDraft] = useState<Record<string, boolean>>({})
  const [videoSavingChanges, setVideoSavingChanges] = useState(false)

  function isVideoEnabled(videoId: string): boolean {
    if (videoId in videoDraft) return videoDraft[videoId]
    const override = videoOverrides.find((o) => o.videoId === videoId)
    return override ? override.enabled : true
  }

  function stageVideoToggle(videoId: string) {
    setVideoDraft((prev) => ({ ...prev, [videoId]: !isVideoEnabled(videoId) }))
  }

  function stageVideoGroupAll(list: VideoTutorial[], enabled: boolean) {
    setVideoDraft((prev) => {
      const next = { ...prev }
      list.forEach((v) => {
        next[v.id] = enabled
      })
      return next
    })
  }

  function discardVideoChanges() {
    setVideoDraft({})
  }

  async function saveVideoChanges() {
    if (!institutionId) return
    setVideoSavingChanges(true)
    await Promise.all(
      Object.entries(videoDraft).map(([id, enabled]) => setVideoEnabledForInstitution(institutionId, id, enabled)),
    )
    setVideoSavingChanges(false)
    setVideoDraft({})
  }

  function filterSortVideos(list: VideoTutorial[]): VideoTutorial[] {
    const q = videoSearch.trim().toLowerCase()
    let filtered = q ? list.filter((v) => v.title.toLowerCase().includes(q)) : list
    if (videoYearFilter !== 'all') filtered = filtered.filter((v) => v.mbbsYear === videoYearFilter)
    if (videoAudienceFilter !== 'all') filtered = filtered.filter((v) => v.audience === videoAudienceFilter)
    return [...filtered].sort((a, b) => a.title.localeCompare(b.title))
  }

  function groupVideosByYear(list: VideoTutorial[]): { year: MbbsYear; videos: VideoTutorial[] }[] {
    const filtered = filterSortVideos(list)
    const years = videoYearFilter === 'all' ? MBBS_YEARS : [videoYearFilter]
    return years.map((year) => ({ year, videos: filtered.filter((v) => v.mbbsYear === year) })).filter((g) => g.videos.length > 0)
  }

  const [previewVideo, setPreviewVideo] = useState<VideoTutorial | null>(null)

  if (institution === undefined) {
    return (
      <PrimaryAdminShell eyebrow="People & institutions" title="Loading…">
        <div className="space-y-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-64" />
        </div>
      </PrimaryAdminShell>
    )
  }

  if (institution === null) {
    return (
      <PrimaryAdminShell eyebrow="People & institutions" title="Institution not found">
        <Card className="chamfer max-w-lg">
          <p className="text-[13.5px] mb-4" style={{ color: 'var(--color-char-soft)' }}>
            This institution doesn't exist, or was deleted.
          </p>
          <GhostButton onClick={() => navigate('/admin/institutions')}>Back to Institutions</GhostButton>
        </Card>
      </PrimaryAdminShell>
    )
  }

  const location = [institution.city, institution.state].filter(Boolean).join(', ')
  const initial = institution.name.trim()[0]?.toUpperCase() ?? '?'

  const TABS: { key: Tab; label: string }[] = [
    { key: 'departments', label: 'Departments' },
    { key: 'sslLogs', label: 'SSL Logs' },
    { key: 'competencies', label: 'Competencies' },
    { key: 'videos', label: 'Videos' },
  ]

  return (
    <PrimaryAdminShell eyebrow="People & institutions" title={institution.name}>
      {/* Back button */}
      <button
        onClick={() => navigate('/admin/institutions')}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium mb-4 hover:opacity-70 transition-opacity"
        style={{ color: 'var(--color-char-soft)' }}
      >
        <Icon name="chevron" className="h-3 w-3 rotate-180" />
        Back to Institutions
      </button>

      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div
          className="shrink-0 rounded-full border-[1.5px] flex items-center justify-center font-display text-[21px]"
          style={{ width: 52, height: 52, borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)' }}
        >
          {initial}
        </div>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] mb-1" style={{ color: 'var(--color-gold)' }}>
            Institution Management
          </div>
          <h1 className="font-display text-[28px] leading-tight" style={{ color: 'var(--color-char)' }}>
            {institution.name}
          </h1>
          <div className="text-[13px] mt-1" style={{ color: 'var(--color-char-soft)' }}>
            {[institution.type, location].filter(Boolean).join(' · ') || 'Details not set'}
          </div>
        </div>
      </div>

      {/* Inline stats */}
      <div className="flex gap-8 mb-6 flex-wrap">
        <div>
          <div className="font-display text-[22px] tabular-nums" style={{ color: 'var(--color-char)' }}>
            {includedCatalogCount} / {catalogDepartments.length}
          </div>
          <div className="text-[11px] uppercase tracking-[0.06em] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
            Departments included
          </div>
        </div>
        <div>
          <div className="font-display text-[22px] tabular-nums" style={{ color: 'var(--color-char)' }}>
            {includedComps} / {totalComps}
          </div>
          <div className="text-[11px] uppercase tracking-[0.06em] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
            Competencies included
          </div>
        </div>
        <div>
          <div className="font-display text-[22px] tabular-nums" style={{ color: 'var(--color-char)' }}>
            {ownTemplates?.length ?? 0}
          </div>
          <div className="text-[11px] uppercase tracking-[0.06em] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
            Institution-only templates
          </div>
        </div>
      </div>

      {/* Tabs — chamfered primary-chrome buttons, deliberately bolder and
          shape-distinct from the plain rounded sub-tab pills inside each
          tab, so the two navigation levels never read as the same control. */}
      <div className="flex gap-3 mb-7">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="chamfer-sm flex items-center gap-2 px-5 py-2.5 text-[13.5px] font-semibold transition-colors"
            style={{
              backgroundColor: tab === t.key ? 'var(--color-ink)' : 'var(--color-paper-raised)',
              color: tab === t.key ? 'var(--color-gold)' : 'var(--color-char-soft)',
              border: `1px solid ${tab === t.key ? 'var(--color-ink)' : 'var(--color-line)'}`,
            }}
          >
            <Icon
              name={
                t.key === 'departments'
                  ? 'departments'
                  : t.key === 'sslLogs'
                    ? 'templates'
                    : t.key === 'competencies'
                      ? 'competencies'
                      : 'video'
              }
              className="h-4 w-4"
            />
            {t.label}
          </button>
        ))}
      </div>

      {/* ---------- Departments tab ---------- */}
      {tab === 'departments' && (
        <div>
          <div className="inline-flex border rounded-[6px] overflow-hidden mb-6" style={{ borderColor: 'var(--color-line)' }}>
            <button
              onClick={() => setDeptSubTab('global')}
              className="px-4 py-2 text-[12.5px] font-medium transition-colors"
              style={{
                backgroundColor: deptSubTab === 'global' ? 'var(--color-ink)' : 'transparent',
                color: deptSubTab === 'global' ? 'var(--color-frost)' : 'var(--color-char-soft)',
              }}
            >
              Global departments
            </button>
            <button
              onClick={() => setDeptSubTab('own')}
              className="px-4 py-2 text-[12.5px] font-medium transition-colors border-l"
              style={{
                borderColor: 'var(--color-line)',
                backgroundColor: deptSubTab === 'own' ? 'var(--color-ink)' : 'transparent',
                color: deptSubTab === 'own' ? 'var(--color-frost)' : 'var(--color-char-soft)',
              }}
            >
              Institution-only departments
            </button>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap mb-5">
            <div className="relative flex-1 min-w-[200px]">
              <Icon
                name="search"
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none"
                style={{ color: 'var(--color-char-soft)' }}
              />
              <input
                value={deptSearch}
                onChange={(e) => setDeptSearch(e.target.value)}
                placeholder="Search departments"
                className={`${inputClass} pl-8`}
                style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              />
            </div>
            <select
              className={inputClass}
              style={{ width: 140, borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              value={deptYearFilter}
              onChange={(e) => setDeptYearFilter(e.target.value === 'all' ? 'all' : (Number(e.target.value) as MbbsYear))}
            >
              <option value="all">All years</option>
              {MBBS_YEARS.map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              style={{ width: 172, borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              value={deptSort}
              onChange={(e) => setDeptSort(e.target.value as NameSortOrder)}
            >
              {(Object.keys(NAME_SORT_LABELS) as NameSortOrder[]).map((key) => (
                <option key={key} value={key}>
                  {NAME_SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </div>

          <SaveChangesBar
            pendingCount={Object.keys(deptDraft).length}
            saving={deptSavingChanges}
            onSave={saveDeptChanges}
            onDiscard={discardDeptChanges}
          />

          {deptSubTab === 'own' ? (
            <div>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <p className="text-[12.5px]" style={{ color: 'var(--color-char-soft)' }}>
                  Belong exclusively to {institution.name} — not part of the shared catalog.
                </p>
                <PrimaryButton onClick={() => setDeptModalOpen(true)}>
                  <Icon name="plus" className="h-3.5 w-3.5" />
                  New department
                </PrimaryButton>
              </div>

              {ownDepartments.length > 0 && (
                <div className="flex gap-2 mt-3">
                  <button
                    onClick={() => stageDeptGroupAll(ownDepartments, true)}
                    className="text-[11.5px] font-medium hover:opacity-70 transition-opacity"
                    style={{ color: 'var(--color-gold)' }}
                  >
                    Select all
                  </button>
                  <button
                    onClick={() => stageDeptGroupAll(ownDepartments, false)}
                    className="text-[11.5px] font-medium hover:opacity-70 transition-opacity"
                    style={{ color: 'var(--color-char-soft)' }}
                  >
                    Deselect all
                  </button>
                </div>
              )}

              {ownDepartments.length === 0 ? (
                <p className="text-[13.5px] py-4" style={{ color: 'var(--color-char-soft)' }}>
                  No institution-only departments yet.
                </p>
              ) : groupDeptsByYear(ownDepartments).length === 0 ? (
                <p className="text-[13.5px] py-4" style={{ color: 'var(--color-char-soft)' }}>
                  No departments match "{deptSearch}".
                </p>
              ) : (
                <div className="mt-4 flex flex-col gap-8">
                  {groupDeptsByYear(ownDepartments).map(({ year, depts }) => (
                    <div key={year}>
                      <div className="flex items-center gap-2 mb-3">
                        <span
                          className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] px-2 py-1 rounded-[4px]"
                          style={{ color: 'var(--color-gold)', backgroundColor: 'color-mix(in srgb, var(--color-gold) 14%, transparent)' }}
                        >
                          Year {year}
                        </span>
                        <span className="text-[11px]" style={{ color: 'var(--color-char-soft)' }}>
                          {depts.length} department{depts.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="border rounded-[10px] overflow-hidden" style={{ backgroundColor: 'var(--color-paper)', borderColor: BORDER }}>
                        {depts.map((d, i) => {
                          const enabled = isDeptEnabled(d.id)
                          return (
                            <DepartmentRow
                              key={d.id}
                              department={d}
                              enabled={enabled}
                              onToggle={() => stageDeptToggle(d.id)}
                              isLast={i === depts.length - 1}
                              right={
                                <button
                                  onClick={() => deleteDepartment(d.id)}
                                  title="Delete department"
                                  className="shrink-0 h-6 w-6 flex items-center justify-center rounded-[3px] hover:bg-black/[0.06]"
                                  style={{ color: 'var(--color-char-soft)' }}
                                >
                                  <Icon name="trash" className="h-3.5 w-3.5" />
                                </button>
                              }
                            />
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <div className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
                  {includedCatalogCount} of {catalogDepartments.length} catalog departments included
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => stageDeptGroupAll(catalogDepartments, true)}
                    className="text-[11.5px] font-medium hover:opacity-70 transition-opacity"
                    style={{ color: 'var(--color-gold)' }}
                  >
                    Select all
                  </button>
                  <button
                    onClick={() => stageDeptGroupAll(catalogDepartments, false)}
                    className="text-[11.5px] font-medium hover:opacity-70 transition-opacity"
                    style={{ color: 'var(--color-char-soft)' }}
                  >
                    Deselect all
                  </button>
                </div>
              </div>

              {!departments ? (
                <Skeleton className="h-32" />
              ) : catalogDepartments.length === 0 ? (
                <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
                  No shared-catalog departments exist yet — add some from the Departments page.
                </p>
              ) : groupDeptsByYear(catalogDepartments).length === 0 ? (
                <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
                  No departments match "{deptSearch}".
                </p>
              ) : (
                <div className="flex flex-col gap-8">
                  {groupDeptsByYear(catalogDepartments).map(({ year, depts }) => (
                    <div key={year}>
                      <div className="flex items-center gap-2 mb-3">
                        <span
                          className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] px-2 py-1 rounded-[4px]"
                          style={{ color: 'var(--color-gold)', backgroundColor: 'color-mix(in srgb, var(--color-gold) 14%, transparent)' }}
                        >
                          Year {year}
                        </span>
                        <span className="text-[11px]" style={{ color: 'var(--color-char-soft)' }}>
                          {depts.length} department{depts.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="border rounded-[10px] overflow-hidden" style={{ backgroundColor: 'var(--color-paper)', borderColor: BORDER }}>
                        {depts.map((d, i) => {
                          const enabled = isDeptEnabled(d.id)
                          const counts = deptCompCounts[d.name]
                          return (
                            <DepartmentRow
                              key={d.id}
                              department={d}
                              enabled={enabled}
                              onToggle={() => stageDeptToggle(d.id)}
                              isLast={i === depts.length - 1}
                              right={
                                <div className="shrink-0 text-[12px] text-right w-[150px]" style={{ color: 'var(--color-char-soft)' }}>
                                  {enabled ? `${counts?.included ?? 0} / ${counts?.total ?? 0} competencies` : 'Excluded'}
                                </div>
                              }
                            />
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---------- SSL Logs tab ---------- */}
      {tab === 'sslLogs' && (
        <div>
          <div className="inline-flex border rounded-[6px] overflow-hidden mb-6" style={{ borderColor: 'var(--color-line)' }}>
            <button
              onClick={() => setSslSubTab('global')}
              className="px-4 py-2 text-[12.5px] font-medium transition-colors"
              style={{
                backgroundColor: sslSubTab === 'global' ? 'var(--color-ink)' : 'transparent',
                color: sslSubTab === 'global' ? 'var(--color-frost)' : 'var(--color-char-soft)',
              }}
            >
              Global SSL
            </button>
            <button
              onClick={() => setSslSubTab('own')}
              className="px-4 py-2 text-[12.5px] font-medium transition-colors border-l"
              style={{
                borderColor: 'var(--color-line)',
                backgroundColor: sslSubTab === 'own' ? 'var(--color-ink)' : 'transparent',
                color: sslSubTab === 'own' ? 'var(--color-frost)' : 'var(--color-char-soft)',
              }}
            >
              Institution-specific logs
            </button>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap mb-6">
            <div className="relative flex-1 min-w-[200px]">
              <Icon
                name="search"
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none"
                style={{ color: 'var(--color-char-soft)' }}
              />
              <input
                value={sslSearch}
                onChange={(e) => setSslSearch(e.target.value)}
                placeholder="Search department or skill/log name"
                className={`${inputClass} pl-8`}
                style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              />
            </div>
            <select
              className={inputClass}
              style={{ width: 172, borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              value={sslDepartmentFilter}
              onChange={(e) => setSslDepartmentFilter(e.target.value)}
            >
              <option value="all">All departments</option>
              {allDepartmentNames.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              style={{ width: 140, borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              value={sslYearFilter}
              onChange={(e) => setSslYearFilter(e.target.value === 'all' ? 'all' : (Number(e.target.value) as MbbsYear))}
            >
              <option value="all">All years</option>
              {MBBS_YEARS.map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              style={{ width: 172, borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              value={sslSort}
              onChange={(e) => setSslSort(e.target.value as NameSortOrder)}
            >
              {(Object.keys(NAME_SORT_LABELS) as NameSortOrder[]).map((key) => (
                <option key={key} value={key}>
                  {NAME_SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </div>

          <SaveChangesBar
            pendingCount={Object.keys(compDraft).length}
            saving={compSavingChanges}
            onSave={saveCompChanges}
            onDiscard={discardCompChanges}
          />

          {sslSubTab === 'own' ? (
            <div>
              <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
                <div>
                  <h2 className="font-display text-[19px]" style={{ color: 'var(--color-char)' }}>
                    {institution.name}'s own SSL logs
                  </h2>
                  <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
                    {ownTemplates?.length ?? 0} log{(ownTemplates?.length ?? 0) === 1 ? '' : 's'} — belong
                    exclusively to this institution. Open one to add its competencies/skills in the editor.
                  </p>
                </div>
                <PrimaryButton onClick={() => setCreatingTemplate(true)}>
                  <Icon name="plus" className="h-3.5 w-3.5" />
                  New institution log
                </PrimaryButton>
              </div>

              {!ownTemplates ? (
                <Skeleton className="h-24" />
              ) : ownTemplates.length === 0 ? (
                <div
                  className="chamfer text-center py-16 px-6"
                  style={{ border: `1px solid ${'var(--color-gold-line)'}`, backgroundColor: 'color-mix(in srgb, var(--color-gold) 6%, var(--color-paper-raised) 94%)' }}
                >
                  <div
                    className="chamfer-sm mx-auto mb-4 flex items-center justify-center"
                    style={{ width: 44, height: 44, backgroundColor: 'var(--color-ink)' }}
                  >
                    <Icon name="templates" className="h-5 w-5" style={{ color: 'var(--color-gold)' }} />
                  </div>
                  <div className="font-display text-[21px] mb-1.5" style={{ color: 'var(--color-char)' }}>
                    No institution-only logs yet
                  </div>
                  <div className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
                    Create one, then open it in the editor to add {institution.name}'s own competencies/skills.
                  </div>
                </div>
              ) : visibleOwnTemplates().length === 0 ? (
                <p className="text-[13.5px] py-4" style={{ color: 'var(--color-char-soft)' }}>
                  No departments or logs match "{sslSearch}".
                </p>
              ) : (
                <div className="flex flex-col gap-8">
                  {visibleOwnTemplates().map(({ year, templates }) => (
                    <div key={year}>
                      <div className="flex items-center gap-2 mb-3">
                        <span
                          className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] px-2 py-1 rounded-[4px]"
                          style={{ color: 'var(--color-gold)', backgroundColor: 'color-mix(in srgb, var(--color-gold) 14%, transparent)' }}
                        >
                          Year {year}
                        </span>
                        <span className="text-[11px]" style={{ color: 'var(--color-char-soft)' }}>
                          {templates.length} log{templates.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="space-y-5">
                        {templates.map((t) => {
                          const skillNodes = ownNodesByTemplate[t.id] ?? []
                          // The log's master toggle reads as ON while *any*
                          // skill is still included, and only flips OFF once
                          // every skill is excluded — turning off a single
                          // skill no longer drags the whole log's switch
                          // off. Clicking it excludes all (when currently
                          // on) or includes all (when currently off).
                          const anySkillEnabled = skillNodes.some((n) => isCompetencyEnabled(n.id))
                          return (
                            <div
                              key={t.id}
                              className="group relative overflow-hidden rounded-[10px] border"
                              style={{
                                backgroundColor: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)',
                                borderColor: 'var(--color-line)',
                              }}
                            >
                              <div className="px-5 pt-5 pb-4">
                                {confirmDeleteTemplateId === t.id ? (
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <p className="text-[12.5px]" style={{ color: 'var(--color-clay)' }}>
                                      Delete <span className="font-medium">"{t.title || 'Untitled log'}"</span> and all{' '}
                                      {(ownNodesByTemplate[t.id] ?? []).length} of its skills? This can't be undone.
                                    </p>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <GhostButton
                                        tone="danger"
                                        onClick={async () => {
                                          setDeletingTemplate(true)
                                          await handleDeleteOwnTemplate(t)
                                          setDeletingTemplate(false)
                                          setConfirmDeleteTemplateId(null)
                                        }}
                                      >
                                        {deletingTemplate ? 'Deleting…' : 'Delete log'}
                                      </GhostButton>
                                      <GhostButton onClick={() => setConfirmDeleteTemplateId(null)}>Cancel</GhostButton>
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-between gap-3 flex-wrap">
                                    <div className="flex items-center gap-3 min-w-0">
                                      {skillNodes.length > 0 && (
                                        <ToggleSwitch
                                          on={anySkillEnabled}
                                          onChange={() => stageAllInGroup(skillNodes, !anySkillEnabled)}
                                          label={
                                            anySkillEnabled
                                              ? 'Some or all skills included — click to exclude all'
                                              : 'All skills excluded — click to include all'
                                          }
                                        />
                                      )}
                                      <span
                                        className="chamfer-sm shrink-0 inline-flex items-center justify-center font-mono text-[10.5px] font-semibold tracking-[0.04em] px-1.5 py-0.5"
                                        style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-gold)' }}
                                      >
                                        {t.logType}
                                      </span>
                                      <div className="min-w-0">
                                        <div className="font-display text-[16.5px] leading-snug truncate" style={{ color: 'var(--color-char)' }}>
                                          {t.title}
                                        </div>
                                        <div className="text-[12px] truncate" style={{ color: 'var(--color-char-soft)' }}>
                                          {t.department}
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0">
                                      <button
                                        role="button"
                                        onClick={() => navigate(`/admin/log-templates/${t.id}?institutionId=${institutionId}`)}
                                        className="text-[11.5px] font-medium px-2.5 py-1 rounded-[5px] border transition-colors"
                                        style={{ color: 'var(--color-gold)', borderColor: 'var(--color-gold-line)' }}
                                      >
                                        Open in editor
                                      </button>
                                      <button
                                        onClick={() => setConfirmDeleteTemplateId(t.id)}
                                        title="Delete this log"
                                        className="h-7 w-7 flex items-center justify-center rounded-[5px] border transition-colors shrink-0"
                                        style={{ color: 'var(--color-clay)', borderColor: 'var(--color-line)' }}
                                      >
                                        <Icon name="trash" className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </div>

                              {skillNodes.length === 0 ? (
                                <div
                                  className="px-5 py-3 text-[12px]"
                                  style={{ color: 'var(--color-char-soft)', borderTop: `1px solid ${'var(--color-line)'}` }}
                                >
                                  No skills/competencies added yet — open in editor to add some.
                                </div>
                              ) : (
                                <div style={{ borderTop: `1px solid ${'var(--color-line)'}` }}>
                                  {skillNodes.map((n, i) => (
                                    <OwnSkillRow
                                      key={n.id}
                                      node={n}
                                      enabled={isCompetencyEnabled(n.id)}
                                      isLast={i === skillNodes.length - 1}
                                      onToggle={() => stageCompToggle(n.id)}
                                      onOpenEditor={() => navigate(`/admin/competencies/${t.id}/${n.id}`)}
                                      onDelete={async () => {
                                        if (n.formSchemaId) await deleteFormSchema(n.formSchemaId)
                                        await deleteTreeNode(t.id, n.id)
                                      }}
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="mb-6">
                <h2 className="font-display text-[19px]" style={{ color: 'var(--color-char)' }}>
                  Global SSL competencies
                </h2>
                <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
                  Curate which of the platform's global competencies {institution.name}'s faculty and students can
                  see — on by default. Only included departments are shown.
                </p>
              </div>

              {!globalTemplates ? (
                <Skeleton className="h-40" />
              ) : competencyGroups.length === 0 ? (
                <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
                  No global competencies in an included department yet.
                </p>
              ) : visibleCompetencyYearGroups().length === 0 ? (
                <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
                  No departments or skills match "{sslSearch}".
                </p>
              ) : (
                <div className="flex flex-col gap-8">
                  {visibleCompetencyYearGroups().map(({ year, groups }) => (
                    <div key={year}>
                      <div className="flex items-center gap-2 mb-3">
                        <span
                          className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] px-2 py-1 rounded-[4px]"
                          style={{ color: 'var(--color-gold)', backgroundColor: 'color-mix(in srgb, var(--color-gold) 14%, transparent)' }}
                        >
                          Year {year}
                        </span>
                        <span className="text-[11px]" style={{ color: 'var(--color-char-soft)' }}>
                          {groups.length} department{groups.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="space-y-5">
                        {groups.map(({ template, nodes }) => {
                          const includedCount = nodes.filter((n) => isCompetencyEnabled(n.id)).length
                          return (
                            <div
                              key={template.id}
                              className="relative overflow-hidden rounded-[10px] border"
                              style={{
                                backgroundColor: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)',
                                borderColor: 'var(--color-line)',
                              }}
                            >
                              <div className="px-5 pt-5 pb-4">
                                <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                                  <div className="flex items-center gap-3 min-w-0">
                                    <ToggleSwitch
                                      on={includedCount > 0}
                                      onChange={() => stageAllInGroup(nodes, includedCount === 0)}
                                      label={
                                        includedCount > 0
                                          ? 'Some or all skills included — click to exclude all'
                                          : 'All skills excluded — click to include all'
                                      }
                                    />
                                    <span
                                      className="chamfer-sm shrink-0 inline-flex items-center justify-center font-display text-[13px] font-semibold"
                                      style={{ width: 32, height: 32, backgroundColor: 'var(--color-ink)', color: 'var(--color-gold)' }}
                                    >
                                      {template.title.trim()[0]?.toUpperCase() ?? '?'}
                                    </span>
                                    <div className="min-w-0">
                                      <div className="font-display text-[16.5px] leading-snug truncate" style={{ color: 'var(--color-char)' }}>
                                        {template.title}
                                      </div>
                                      <div className="text-[12px] truncate" style={{ color: 'var(--color-char-soft)' }}>
                                        {template.department}
                                      </div>
                                      <div className="text-[11.5px] font-mono tracking-[0.02em] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
                                        {includedCount} / {nodes.length} enabled
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div style={{ borderTop: `1px solid ${'var(--color-line)'}` }}>
                                {nodes.map((n, i) => {
                                  const enabled = isCompetencyEnabled(n.id)
                                  return (
                                    <div
                                      key={n.id}
                                      className="flex items-center gap-3.5 px-5 py-2.5 transition-colors hover:bg-black/[0.02]"
                                      style={{
                                        borderBottom: i === nodes.length - 1 ? undefined : ROW_DIVIDER,
                                        borderLeft: `3px solid ${enabled ? 'var(--color-gold-line)' : 'transparent'}`,
                                      }}
                                    >
                                      <ToggleSwitch
                                        on={enabled}
                                        onChange={() => stageCompToggle(n.id)}
                                        label={enabled ? 'Included — click to exclude' : 'Excluded — click to include'}
                                        size="sm"
                                      />
                                      <span className="text-[13.5px]" style={{ color: enabled ? 'var(--color-char)' : 'var(--color-char-soft)' }}>
                                        {n.title || 'Untitled competency'}
                                      </span>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {excludedCatalogDepartments.length > 0 && (
                <p className="text-[12.5px] px-1 mt-5" style={{ color: 'var(--color-char-soft)' }}>
                  Excluded departments (enable in the Departments tab to manage their competencies):{' '}
                  {excludedCatalogDepartments.map((d) => d.name).join(', ')}.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---------- Competencies tab ---------- */}
      {tab === 'competencies' && (
        <div>
          <div className="inline-flex border rounded-[6px] overflow-hidden mb-6" style={{ borderColor: 'var(--color-line)' }}>
            <button
              onClick={() => setCompFormSubTab('global')}
              className="px-4 py-2 text-[12.5px] font-medium transition-colors"
              style={{
                backgroundColor: compFormSubTab === 'global' ? 'var(--color-ink)' : 'transparent',
                color: compFormSubTab === 'global' ? 'var(--color-frost)' : 'var(--color-char-soft)',
              }}
            >
              Global competencies
            </button>
            <button
              onClick={() => setCompFormSubTab('own')}
              className="px-4 py-2 text-[12.5px] font-medium transition-colors border-l"
              style={{
                borderColor: 'var(--color-line)',
                backgroundColor: compFormSubTab === 'own' ? 'var(--color-ink)' : 'transparent',
                color: compFormSubTab === 'own' ? 'var(--color-frost)' : 'var(--color-char-soft)',
              }}
            >
              Institution-specific competencies
            </button>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap mb-6">
            <div className="relative flex-1 min-w-[200px]">
              <Icon
                name="search"
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none"
                style={{ color: 'var(--color-char-soft)' }}
              />
              <input
                value={sslSearch}
                onChange={(e) => setSslSearch(e.target.value)}
                placeholder="Search department or skill name"
                className={`${inputClass} pl-8`}
                style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              />
            </div>
            <select
              className={inputClass}
              style={{ width: 172, borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              value={sslDepartmentFilter}
              onChange={(e) => setSslDepartmentFilter(e.target.value)}
            >
              <option value="all">All departments</option>
              {allDepartmentNames.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              style={{ width: 140, borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              value={sslYearFilter}
              onChange={(e) => setSslYearFilter(e.target.value === 'all' ? 'all' : (Number(e.target.value) as MbbsYear))}
            >
              <option value="all">All years</option>
              {MBBS_YEARS.map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              style={{ width: 156, borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              value={compChecklistFilter}
              onChange={(e) => setCompChecklistFilter(e.target.value as 'all' | 'with' | 'without')}
            >
              <option value="all">All checklists</option>
              <option value="with">Checklist added</option>
              <option value="without">No checklist</option>
            </select>
            <select
              className={inputClass}
              style={{ width: 160, borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              value={compEditedFilter}
              onChange={(e) => setCompEditedFilter(e.target.value as 'all' | 'edited' | 'notEdited')}
            >
              <option value="all">All types</option>
              <option value="edited">Customized</option>
              <option value="notEdited">Not customized</option>
            </select>
            <select
              className={inputClass}
              style={{ width: 172, borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              value={sslSort}
              onChange={(e) => setSslSort(e.target.value as NameSortOrder)}
            >
              {(Object.keys(NAME_SORT_LABELS) as NameSortOrder[]).map((key) => (
                <option key={key} value={key}>
                  {NAME_SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </div>

          {compFormSubTab === 'own' ? (
            <div>
              <div className="mb-6">
                <h2 className="font-display text-[19px]" style={{ color: 'var(--color-char)' }}>
                  {institution.name}'s institution-specific competencies
                </h2>
                <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
                  Every skill that belongs only to {institution.name} — added under its own SSL logs — plus any
                  global competency customized just for this institution.
                </p>
              </div>

              {(() => {
                type Row =
                  | { kind: 'fork'; key: string; node: TreeNode; template: LogTemplate; override: InstitutionCompetencyFormOverride }
                  | { kind: 'native'; key: string; node: TreeNode; template: LogTemplate }

                const forkRows: Row[] = formOverrides
                  .map((o): Row | null => {
                    const found = nodeLookup[o.nodeId]
                    return found ? { kind: 'fork', key: o.id, node: found.node, template: found.template, override: o } : null
                  })
                  .filter((r): r is Row => r !== null)

                const nativeRows: Row[] = (ownTemplates ?? []).flatMap((t) =>
                  (ownNodesByTemplate[t.id] ?? []).map(
                    (n): Row => ({ kind: 'native', key: `${t.id}_${n.id}`, node: n, template: t }),
                  ),
                )

                const allRows = [...forkRows, ...nativeRows]
                const totalCount = allRows.length

                const q = sslSearch.trim().toLowerCase()
                const rows = allRows
                  .filter((r) => sslDepartmentFilter === 'all' || r.template.department === sslDepartmentFilter)
                  .filter((r) => compChecklistFilter === 'all' || (compChecklistFilter === 'with') === !!r.node.formSchemaId)
                  .filter((r) => compEditedFilter === 'all' || (compEditedFilter === 'edited') === (r.kind === 'fork'))
                  .filter(
                    (r) =>
                      q === '' || r.node.title.toLowerCase().includes(q) || r.template.department.toLowerCase().includes(q),
                  )
                // Group by department first, then by the SSL log (the
                // template) — matching the Institution Admin panel's
                // Competencies page layout: a department heading, then one
                // card per log with its skills nested underneath.
                const byTemplate = new Map<string, { template: LogTemplate; rows: Row[] }>()
                for (const r of rows) {
                  const g = byTemplate.get(r.template.id) ?? { template: r.template, rows: [] }
                  g.rows.push(r)
                  byTemplate.set(r.template.id, g)
                }
                const byDept = new Map<string, { template: LogTemplate; rows: Row[] }[]>()
                for (const g of byTemplate.values()) {
                  if (sslYearFilter !== 'all' && g.template.mbbsYear !== sslYearFilter) continue
                  const arr = byDept.get(g.template.department) ?? []
                  arr.push({
                    template: g.template,
                    rows: g.rows
                      .slice()
                      .sort((a, b) =>
                        sslSort === 'name-desc'
                          ? b.node.title.localeCompare(a.node.title)
                          : a.node.title.localeCompare(b.node.title),
                      ),
                  })
                  byDept.set(g.template.department, arr)
                }
                const deptGroups = [...byDept.entries()]
                  .sort((a, b) => a[0].localeCompare(b[0]))
                  .map(([department, templates]) => ({
                    department,
                    templates: templates.sort((a, b) => a.template.title.localeCompare(b.template.title)),
                  }))

                if (totalCount === 0) {
                  return (
                    <div
                      className="chamfer text-center py-16 px-6"
                      style={{ border: `1px solid ${'var(--color-gold-line)'}`, backgroundColor: 'color-mix(in srgb, var(--color-gold) 6%, var(--color-paper-raised) 94%)' }}
                    >
                      <div
                        className="chamfer-sm mx-auto mb-4 flex items-center justify-center"
                        style={{ width: 44, height: 44, backgroundColor: 'var(--color-ink)' }}
                      >
                        <Icon name="competencies" className="h-5 w-5" style={{ color: 'var(--color-gold)' }} />
                      </div>
                      <div className="font-display text-[21px] mb-1.5" style={{ color: 'var(--color-char)' }}>
                        No institution-specific competencies yet
                      </div>
                      <div className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
                        Add skills to one of {institution.name}'s own SSL logs, or edit a global competency from the
                        Global Competencies sub-tab to create {institution.name}'s own version.
                      </div>
                    </div>
                  )
                }

                if (deptGroups.length === 0) {
                  return (
                    <p className="text-[13.5px] py-4" style={{ color: 'var(--color-char-soft)' }}>
                      No institution-specific competencies match the current filters.
                    </p>
                  )
                }

                return (
                  <div className="flex flex-col gap-8">
                    {deptGroups.map(({ department, templates: deptTemplates }) => (
                      <div key={department}>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="font-display text-[19px]" style={{ color: 'var(--color-char)' }}>
                            {department}
                          </span>
                          <span className="text-[11px]" style={{ color: 'var(--color-char-soft)' }}>
                            {deptTemplates.length} log{deptTemplates.length === 1 ? '' : 's'}
                          </span>
                        </div>
                        <div className="space-y-5">
                          {deptTemplates.map(({ template, rows: tRows }) => (
                            <div
                              key={template.id}
                              className="relative overflow-hidden rounded-[10px] border"
                              style={{
                                backgroundColor: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)',
                                borderColor: 'var(--color-line)',
                              }}
                            >
                              <div className="px-5 pt-5 pb-4">
                                <div className="flex items-center gap-3 min-w-0">
                                  <span
                                    className="chamfer-sm shrink-0 inline-flex items-center justify-center font-display text-[13px] font-semibold"
                                    style={{ width: 32, height: 32, backgroundColor: 'var(--color-ink)', color: 'var(--color-gold)' }}
                                  >
                                    {template.title.trim()[0]?.toUpperCase() ?? '?'}
                                  </span>
                                  <div className="min-w-0">
                                    <div className="font-display text-[16.5px] leading-snug truncate" style={{ color: 'var(--color-char)' }}>
                                      {template.title}
                                    </div>
                                    <div className="text-[12px] truncate" style={{ color: 'var(--color-char-soft)' }}>
                                      {template.department} ·{' '}
                                      {template.scope === 'institution' ? 'Institution-owned log' : 'Global log — customized'}
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div style={{ borderTop: `1px solid ${'var(--color-line)'}` }}>
                                {tRows.map((r, i) => {
                                  // Only meaningful for native rows — a native
                                  // institution-owned skill toggled off (SSL
                                  // Logs → Institution-specific logs) shouldn't
                                  // be editable from here either.
                                  const turnedOn = r.kind === 'fork' || isCompetencyEnabled(r.node.id)
                                  return (
                                    <div
                                      key={r.key}
                                      className="flex items-center gap-3.5 px-5 py-2.5"
                                      style={{ borderBottom: i === tRows.length - 1 ? undefined : ROW_DIVIDER }}
                                    >
                                      <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                                          <span className="text-[13.5px] truncate" style={{ color: 'var(--color-char)' }}>
                                            {r.node.title || 'Untitled competency'}
                                          </span>
                                          <span
                                            className="shrink-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.06em] px-1.5 py-0.5 rounded-[4px]"
                                            style={{
                                              color: r.kind === 'fork' ? 'var(--color-gold)' : 'var(--color-char-soft)',
                                              backgroundColor:
                                                r.kind === 'fork'
                                                  ? 'color-mix(in srgb, var(--color-gold) 16%, transparent)'
                                                  : 'color-mix(in srgb, var(--color-char-soft) 14%, transparent)',
                                            }}
                                          >
                                            {r.kind === 'fork' ? 'Customized' : 'Institution-owned'}
                                          </span>
                                          {!turnedOn && (
                                            <span
                                              className="shrink-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.06em] px-1.5 py-0.5 rounded-[4px]"
                                              style={{ color: 'var(--color-clay)', backgroundColor: 'var(--color-clay-soft)' }}
                                            >
                                              Excluded
                                            </span>
                                          )}
                                          {r.kind === 'native' && !r.node.formSchemaId && (
                                            <span className="shrink-0 text-[11px]" style={{ color: 'var(--color-char-soft)' }}>
                                              No checklist yet
                                            </span>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2 shrink-0">
                                        {r.kind === 'fork' ? (
                                          <>
                                            <GhostButton
                                              onClick={() => navigate(`/admin/competencies/${r.template.id}/${r.node.id}?institutionId=${institutionId}`)}
                                            >
                                              <Icon name="edit" className="h-3.5 w-3.5" />
                                              Edit
                                            </GhostButton>
                                            <button
                                              onClick={() => handleResetToGlobal(r.override)}
                                              className="text-[11.5px] font-medium px-2.5 py-1.5 rounded-[5px] border transition-colors"
                                              style={{ color: 'var(--color-clay)', borderColor: 'var(--color-line)' }}
                                            >
                                              Reset to global version
                                            </button>
                                          </>
                                        ) : (
                                          <button
                                            onClick={() => turnedOn && navigate(`/admin/competencies/${r.template.id}/${r.node.id}`)}
                                            disabled={!turnedOn}
                                            title={turnedOn ? undefined : 'Include this skill (SSL Logs tab) to edit its checklist'}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium border transition-colors duration-150 disabled:opacity-40 disabled:cursor-not-allowed"
                                            style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
                                          >
                                            <Icon name="edit" className="h-3.5 w-3.5" />
                                            {r.node.formSchemaId ? 'Edit checklist' : 'Add checklist'}
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          ) : (
            <div>
              <div className="mb-6">
                <h2 className="font-display text-[19px]" style={{ color: 'var(--color-char)' }}>
                  Global competencies
                </h2>
                <p className="text-[12.5px] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
                  Edit a competency's checklist just for {institution.name} — this never changes the global form
                  every other institution shares.
                </p>
              </div>

              {!globalTemplates ? (
                <Skeleton className="h-40" />
              ) : competencyGroups.length === 0 ? (
                <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
                  No global competencies in an included department yet.
                </p>
              ) : visibleGlobalCompetencyDepartmentGroups().length === 0 ? (
                <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
                  No competencies match the current filters.
                </p>
              ) : (
                <div className="flex flex-col gap-8">
                  {visibleGlobalCompetencyDepartmentGroups().map(({ department, groups }) => (
                    <div key={department}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="font-display text-[19px]" style={{ color: 'var(--color-char)' }}>
                          {department}
                        </span>
                        <span className="text-[11px]" style={{ color: 'var(--color-char-soft)' }}>
                          {groups.length} log{groups.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="space-y-5">
                        {groups.map(({ template, nodes }) => (
                          <div
                            key={template.id}
                            className="relative overflow-hidden rounded-[10px] border"
                            style={{
                              backgroundColor: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)',
                              borderColor: 'var(--color-line)',
                            }}
                          >
                            <div className="px-5 pt-5 pb-4">
                              <div className="flex items-center gap-3 min-w-0">
                                <span
                                  className="chamfer-sm shrink-0 inline-flex items-center justify-center font-display text-[13px] font-semibold"
                                  style={{ width: 32, height: 32, backgroundColor: 'var(--color-ink)', color: 'var(--color-gold)' }}
                                >
                                  {template.title.trim()[0]?.toUpperCase() ?? '?'}
                                </span>
                                <div className="min-w-0">
                                  <div className="font-display text-[16.5px] leading-snug truncate" style={{ color: 'var(--color-char)' }}>
                                    {template.title}
                                  </div>
                                  <div className="text-[12px] truncate" style={{ color: 'var(--color-char-soft)' }}>
                                    {template.department}
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div style={{ borderTop: `1px solid ${'var(--color-line)'}` }}>
                              {nodes.map((n, i) => {
                                const override = formOverrideFor(n.id)
                                return (
                                  <div
                                    key={n.id}
                                    className="flex items-center gap-3.5 px-5 py-2.5"
                                    style={{ borderBottom: i === nodes.length - 1 ? undefined : ROW_DIVIDER }}
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center gap-2 min-w-0">
                                        <span className="text-[13.5px] truncate" style={{ color: 'var(--color-char)' }}>
                                          {n.title || 'Untitled competency'}
                                        </span>
                                        {override && (
                                          <span
                                            className="shrink-0 font-mono text-[9.5px] font-semibold uppercase tracking-[0.06em] px-1.5 py-0.5 rounded-[4px]"
                                            style={{ color: 'var(--color-gold)', backgroundColor: 'color-mix(in srgb, var(--color-gold) 16%, transparent)' }}
                                          >
                                            Customized
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                    <button
                                      onClick={() => navigate(`/admin/competencies/${template.id}/${n.id}?institutionId=${institutionId}`)}
                                      className="text-[11.5px] font-medium px-2.5 py-1 rounded-[5px] border transition-colors shrink-0 inline-flex items-center gap-1.5"
                                      style={{ color: 'var(--color-gold)', borderColor: 'var(--color-gold-line)' }}
                                    >
                                      <Icon name="copy" className="h-3 w-3" />
                                      {override ? `Edit ${institution.name}'s version` : `Edit for ${institution.name}`}
                                    </button>
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ---------- Videos tab ---------- */}
      {tab === 'videos' && (
        <div>
          <div className="inline-flex border rounded-[6px] overflow-hidden mb-6" style={{ borderColor: 'var(--color-line)' }}>
            <button
              onClick={() => setVideoSubTab('global')}
              className="px-4 py-2 text-[12.5px] font-medium transition-colors"
              style={{
                backgroundColor: videoSubTab === 'global' ? 'var(--color-ink)' : 'transparent',
                color: videoSubTab === 'global' ? 'var(--color-frost)' : 'var(--color-char-soft)',
              }}
            >
              Global videos
            </button>
            <button
              onClick={() => setVideoSubTab('own')}
              className="px-4 py-2 text-[12.5px] font-medium transition-colors border-l"
              style={{
                borderColor: 'var(--color-line)',
                backgroundColor: videoSubTab === 'own' ? 'var(--color-ink)' : 'transparent',
                color: videoSubTab === 'own' ? 'var(--color-frost)' : 'var(--color-char-soft)',
              }}
            >
              Institution-specific videos
            </button>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap mb-5">
            <div className="relative flex-1 min-w-[200px]">
              <Icon
                name="search"
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none"
                style={{ color: 'var(--color-char-soft)' }}
              />
              <input
                value={videoSearch}
                onChange={(e) => setVideoSearch(e.target.value)}
                placeholder="Search videos"
                className={`${inputClass} pl-8`}
                style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              />
            </div>
            <select
              className={inputClass}
              style={{ width: 140, borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              value={videoYearFilter}
              onChange={(e) => setVideoYearFilter(e.target.value === 'all' ? 'all' : (Number(e.target.value) as MbbsYear))}
            >
              <option value="all">All years</option>
              {MBBS_YEARS.map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
            <select
              className={inputClass}
              style={{ width: 140, borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              value={videoAudienceFilter}
              onChange={(e) => setVideoAudienceFilter(e.target.value as 'all' | VideoAudience)}
            >
              <option value="all">All audiences</option>
              <option value="student">Students</option>
              <option value="faculty">Faculty</option>
            </select>
            {videoSubTab === 'own' && (
              <div className="inline-flex border rounded-[6px] overflow-hidden shrink-0" style={{ borderColor: 'var(--color-line)' }}>
                <button
                  onClick={() => setVideoViewMode('grid')}
                  title="Grid view"
                  className="h-8 w-9 flex items-center justify-center transition-colors"
                  style={{
                    backgroundColor: videoViewMode === 'grid' ? 'var(--color-ink)' : 'transparent',
                    color: videoViewMode === 'grid' ? 'var(--color-frost)' : 'var(--color-char-soft)',
                  }}
                >
                  <Icon name="grid" className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => setVideoViewMode('list')}
                  title="List view"
                  className="h-8 w-9 flex items-center justify-center transition-colors border-l"
                  style={{
                    borderColor: 'var(--color-line)',
                    backgroundColor: videoViewMode === 'list' ? 'var(--color-ink)' : 'transparent',
                    color: videoViewMode === 'list' ? 'var(--color-frost)' : 'var(--color-char-soft)',
                  }}
                >
                  <Icon name="list" className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>

          <SaveChangesBar
            pendingCount={Object.keys(videoDraft).length}
            saving={videoSavingChanges}
            onSave={saveVideoChanges}
            onDiscard={discardVideoChanges}
          />

          {videoSubTab === 'global' ? (
            <div>
              {!allVideos ? (
                <Skeleton className="h-32" />
              ) : catalogVideos.length === 0 ? (
                <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
                  No global videos yet — add some from the Video Tutorials page.
                </p>
              ) : groupVideosByYear(catalogVideos).length === 0 ? (
                <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
                  No videos match "{videoSearch}".
                </p>
              ) : (
                <div className="flex flex-col gap-8">
                  {groupVideosByYear(catalogVideos).map(({ year, videos }) => (
                    <div key={year}>
                      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] px-2 py-1 rounded-[4px]"
                            style={{ color: 'var(--color-gold)', backgroundColor: 'color-mix(in srgb, var(--color-gold) 14%, transparent)' }}
                          >
                            Year {year}
                          </span>
                          <span className="text-[11px]" style={{ color: 'var(--color-char-soft)' }}>
                            {videos.length} video{videos.length === 1 ? '' : 's'}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => stageVideoGroupAll(videos, true)}
                            className="text-[11.5px] font-medium hover:opacity-70 transition-opacity"
                            style={{ color: 'var(--color-gold)' }}
                          >
                            Select all
                          </button>
                          <button
                            onClick={() => stageVideoGroupAll(videos, false)}
                            className="text-[11.5px] font-medium hover:opacity-70 transition-opacity"
                            style={{ color: 'var(--color-char-soft)' }}
                          >
                            Deselect all
                          </button>
                        </div>
                      </div>
                      <div className="border rounded-[10px] overflow-hidden" style={{ backgroundColor: 'var(--color-paper)', borderColor: BORDER }}>
                        {videos.map((v, i) => {
                          const enabled = isVideoEnabled(v.id)
                          return (
                            <div
                              key={v.id}
                              className="flex items-center gap-4 px-4 py-3"
                              style={{ borderBottom: i === videos.length - 1 ? undefined : ROW_DIVIDER }}
                            >
                              <ToggleSwitch
                                on={enabled}
                                onChange={() => stageVideoToggle(v.id)}
                                label={enabled ? 'Included — click to exclude' : 'Excluded — click to include'}
                              />
                              <div className="shrink-0 relative rounded-[6px] overflow-hidden" style={{ width: 56, height: 32 }}>
                                <VideoThumbnail video={v} className="absolute inset-0 w-full h-full" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div
                                  className="font-display text-[15px] leading-snug truncate"
                                  style={{ color: enabled ? 'var(--color-char)' : 'var(--color-char-soft)' }}
                                >
                                  {v.title}
                                </div>
                                <div className="text-[11.5px] truncate" style={{ color: 'var(--color-char-soft)' }}>
                                  {v.department}
                                </div>
                              </div>
                              <Badge tone={v.audience === 'student' ? 'gold' : 'teal'}>{AUDIENCE_LABELS[v.audience]}</Badge>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between gap-3 flex-wrap mb-6">
                <p className="text-[12.5px]" style={{ color: 'var(--color-char-soft)' }}>
                  Belong exclusively to {institution.name} — not part of the shared video catalog.
                </p>
                <PrimaryButton onClick={() => navigate(`/admin/institutions/${institutionId}/videos/new`)}>
                  <Icon name="plus" className="h-3.5 w-3.5" />
                  New video
                </PrimaryButton>
              </div>

              {!allVideos ? (
                <Skeleton className="h-32" />
              ) : ownVideos.length === 0 ? (
                <p className="text-[13.5px] py-4" style={{ color: 'var(--color-char-soft)' }}>
                  No institution-only videos yet.
                </p>
              ) : groupVideosByYear(ownVideos).length === 0 ? (
                <p className="text-[13.5px] py-4" style={{ color: 'var(--color-char-soft)' }}>
                  No videos match "{videoSearch}".
                </p>
              ) : (
                <div className="flex flex-col gap-8">
                  {groupVideosByYear(ownVideos).map(({ year, videos }) => (
                    <div key={year}>
                      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] px-2 py-1 rounded-[4px]"
                            style={{ color: 'var(--color-gold)', backgroundColor: 'color-mix(in srgb, var(--color-gold) 14%, transparent)' }}
                          >
                            Year {year}
                          </span>
                          <span className="text-[11px]" style={{ color: 'var(--color-char-soft)' }}>
                            {videos.length} video{videos.length === 1 ? '' : 's'}
                          </span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => stageVideoGroupAll(videos, true)}
                            className="text-[11.5px] font-medium hover:opacity-70 transition-opacity"
                            style={{ color: 'var(--color-gold)' }}
                          >
                            Select all
                          </button>
                          <button
                            onClick={() => stageVideoGroupAll(videos, false)}
                            className="text-[11.5px] font-medium hover:opacity-70 transition-opacity"
                            style={{ color: 'var(--color-char-soft)' }}
                          >
                            Deselect all
                          </button>
                        </div>
                      </div>
                      {videoViewMode === 'grid' ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                          {videos.map((v, i) => (
                            <VideoCard
                              key={v.id}
                              video={v}
                              index={i}
                              onOpen={() => setPreviewVideo(v)}
                              onEdit={() => navigate(`/admin/institutions/${institutionId}/videos/${v.id}/edit`)}
                              onDelete={() => deleteVideoAndFiles(v)}
                              enabled={isVideoEnabled(v.id)}
                              onToggle={() => stageVideoToggle(v.id)}
                            />
                          ))}
                        </div>
                      ) : (
                        <div className="border rounded-[10px] overflow-hidden" style={{ backgroundColor: 'var(--color-paper)', borderColor: BORDER }}>
                          {videos.map((v, i) => (
                            <VideoListRow
                              key={v.id}
                              video={v}
                              isLast={i === videos.length - 1}
                              onOpen={() => setPreviewVideo(v)}
                              onEdit={() => navigate(`/admin/institutions/${institutionId}/videos/${v.id}/edit`)}
                              onDelete={() => deleteVideoAndFiles(v)}
                              enabled={isVideoEnabled(v.id)}
                              onToggle={() => stageVideoToggle(v.id)}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {deptModalOpen && (
        <Modal title="New institution department" onClose={closeDeptModal}>
          <Field label="Department name">
            <input
              autoFocus
              className={inputClass}
              style={{ borderColor: 'var(--color-line)' }}
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              placeholder="e.g. Simulation & Skills Lab"
            />
          </Field>
          <Field label="MBBS year">
            <select
              className={inputClass}
              style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              value={deptYear}
              onChange={(e) => setDeptYear(Number(e.target.value) as MbbsYear)}
            >
              {MBBS_YEARS.map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Description (optional)">
            <input
              className={inputClass}
              style={{ borderColor: 'var(--color-line)' }}
              value={deptDescription}
              onChange={(e) => setDeptDescription(e.target.value)}
              placeholder="What this department covers"
            />
          </Field>
          <div className="flex justify-end gap-2 mt-2">
            <PrimaryButton onClick={handleCreateDepartment} disabled={!deptName.trim() || deptSaving}>
              {deptSaving ? 'Creating…' : 'Create department'}
            </PrimaryButton>
          </div>
        </Modal>
      )}

      {creatingTemplate && (
        <CreateTemplateModal
          departmentOptions={ownDepartmentOptionsByYear}
          onCreate={handleCreateTemplate}
          onClose={() => setCreatingTemplate(false)}
        />
      )}


      {previewVideo && <VideoPreviewModal video={previewVideo} onClose={() => setPreviewVideo(null)} />}
    </PrimaryAdminShell>
  )
}

// A single skill/competency row under one of this institution's own SSL
// logs (SSL Logs → Institution-specific logs). Owns its own confirm-before-
// delete state, same in-place-confirm pattern as DepartmentCard/TemplateRow
// elsewhere in this codebase — no native confirm() dialog.
function OwnSkillRow({
  node,
  enabled,
  isLast,
  onToggle,
  onOpenEditor,
  onDelete,
}: {
  node: TreeNode
  enabled: boolean
  isLast: boolean
  onToggle: () => void
  onOpenEditor: () => void
  onDelete: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)
  const hasChecklist = !!node.formSchemaId

  if (confirming) {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
        style={{ borderBottom: isLast ? undefined : ROW_DIVIDER, backgroundColor: 'var(--color-clay-soft)' }}
      >
        <p className="text-[12.5px]" style={{ color: 'var(--color-clay)' }}>
          Remove <span className="font-medium">"{node.title || 'Untitled competency'}"</span> from this log? This
          can't be undone.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <GhostButton
            tone="danger"
            onClick={async () => {
              setRemoving(true)
              await onDelete()
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
      className="group flex items-center gap-3.5 px-5 py-2.5 transition-colors hover:bg-black/[0.02]"
      style={{
        borderBottom: isLast ? undefined : ROW_DIVIDER,
        borderLeft: `3px solid ${enabled ? 'var(--color-gold-line)' : 'transparent'}`,
      }}
    >
      <ToggleSwitch
        on={enabled}
        onChange={onToggle}
        label={enabled ? 'Included — click to exclude' : 'Excluded — click to include'}
        size="sm"
      />
      <span className="min-w-0 flex-1 text-[13.5px] truncate" style={{ color: enabled ? 'var(--color-char)' : 'var(--color-char-soft)' }}>
        {node.title || 'Untitled competency'}
      </span>
      {!enabled ? (
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0"
          style={{ borderColor: 'var(--color-clay)', color: 'var(--color-clay)' }}
        >
          Excluded
        </span>
      ) : hasChecklist ? (
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0"
          style={{ borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)' }}
        >
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: 'var(--color-gold)' }} />
          Checklist attached
        </span>
      ) : (
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0"
          style={{ borderColor: 'var(--color-line)', color: 'var(--color-char-soft)' }}
        >
          No checklist yet
        </span>
      )}
      <button
        onClick={() => enabled && onOpenEditor()}
        disabled={!enabled}
        title={enabled ? undefined : 'Include this skill to edit its checklist'}
        className="text-[11.5px] font-medium px-2.5 py-1 rounded-[5px] border transition-colors shrink-0 inline-flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ color: 'var(--color-gold)', borderColor: 'var(--color-gold-line)' }}
      >
        <Icon name="edit" className="h-3 w-3" />
        Edit checklist
      </button>
      <button
        onClick={() => setConfirming(true)}
        title="Remove this skill"
        className="h-6 w-6 shrink-0 flex items-center justify-center rounded-[5px] transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:bg-black/[0.06]"
        style={{ color: 'var(--color-clay)' }}
      >
        <Icon name="trash" className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

// One row layout shared by both the catalog list and the institution-only
// list, so the two read as the same design instead of a list vs. a card
// grid — only the trailing `right` slot differs (a competency count for
// catalog rows, a delete button for institution-only rows).
function DepartmentRow({
  department,
  enabled,
  onToggle,
  right,
  isLast,
}: {
  department: Department
  enabled: boolean
  onToggle: () => void
  right: ReactNode
  isLast: boolean
}) {
  return (
    <div
      className="flex items-center gap-4 px-4 py-3"
      style={{ borderBottom: isLast ? undefined : ROW_DIVIDER }}
    >
      <ToggleSwitch
        on={enabled}
        onChange={onToggle}
        label={enabled ? 'Included — click to exclude' : 'Excluded — click to include'}
      />
      <div className="min-w-0 flex-1">
        <div className="font-display text-[16px] leading-snug" style={{ color: enabled ? 'var(--color-char)' : 'var(--color-char-soft)' }}>
          {department.name}
        </div>
        {department.description && (
          <div className="text-[11.5px] mt-0.5 truncate" style={{ color: 'var(--color-char-soft)' }}>
            {department.description}
          </div>
        )}
      </div>
      {right}
    </div>
  )
}

// Appears whenever a section has unsaved toggle changes queued locally —
// nothing is written to Firestore until "Save changes" is clicked here.
function SaveChangesBar({
  pendingCount,
  saving,
  onSave,
  onDiscard,
}: {
  pendingCount: number
  saving: boolean
  onSave: () => void
  onDiscard: () => void
}) {
  if (pendingCount === 0) return null
  return (
    <div
      className="fade-up flex items-center gap-3 rounded-[8px] px-4 py-3 mb-4"
      style={{ backgroundColor: 'color-mix(in srgb, var(--color-gold) 10%, transparent)', border: '1px solid var(--color-gold-line)' }}
    >
      <span className="text-[12.5px] font-medium" style={{ color: 'var(--color-char)' }}>
        {pendingCount} unsaved change{pendingCount === 1 ? '' : 's'}
      </span>
      <div className="flex-1" />
      <button
        onClick={onDiscard}
        disabled={saving}
        className="text-[12.5px] font-medium hover:opacity-70 transition-opacity disabled:opacity-50"
        style={{ color: 'var(--color-char-soft)' }}
      >
        Discard
      </button>
      <PrimaryButton onClick={onSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </PrimaryButton>
    </div>
  )
}

// Explicit `left` anchor + translateX on the knob — a real bug was hit and
// fixed earlier for this exact pattern (relying on the default static
// position instead of an explicit left value made the knob render
// off-position). Don't regress that.
function ToggleSwitch({
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
