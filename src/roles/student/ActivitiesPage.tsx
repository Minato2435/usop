import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { StudentShell } from './shell/StudentShell'
import { Card, GhostButton, PrimaryButton, Skeleton, inputClass } from './shell/ui'
import { RichTextEditor } from '../../components/RichTextEditor'
import { sanitizeRichText } from '../../lib/sanitizeHtml'
import { useStudentDepartments } from '../../lib/enabledDepartments'
import {
  watchGlobalTemplates,
  watchInstitutionTemplates,
  watchTreeNodes,
  watchInstitutionCompetencyOverrides,
  watchInstitutionCompetencyFormOverride,
} from '../../lib/firestore/logTemplates'
import { watchFormSchema } from '../../lib/firestore/formSchemas'
import { watchFacultyForDepartment } from '../../lib/firestore/users'
import { watchSubmission, createDraftSubmission, updateDraftSubmission, submitSubmission, newSubmissionId } from '../../lib/firestore/submissions'
import { deleteStoredImages, toDraftImages, uploadDraftImages, revokeDraft, type DraftImage } from '../../lib/submissionImages'
import type { AppUser, AttemptType, FormSchema, InstitutionCompetencyOverride, LogTemplate, Submission, SubmissionImage, TreeNode } from '../../types'

const ATTEMPT_TYPES: { value: AttemptType; label: string }[] = [
  { value: 'first', label: 'First attempt' },
  { value: 'repeat', label: 'Repeat attempt' },
  { value: 'remedial', label: 'Remedial attempt' },
]
function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

// Reconstructs the full root→leaf chain for a previously-chosen node, so
// resuming a saved draft can re-select every cascading dropdown exactly as
// the student left them, not just jump straight to the leaf.
function buildPathToNode(nodes: TreeNode[], nodeId: string): TreeNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const path: TreeNode[] = []
  let cur = byId.get(nodeId)
  while (cur) {
    path.unshift(cur)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return path
}

// Adapted from the "New Activity.dc.html" design reference (attaching
// references/), then taken a step further into its own card per step —
// a large, quiet display-font numeral over a small uppercase kicker label
// on the left, the actual title/hint/control on the right, each step its
// own lifted rounded-16 card rather than a row on a flat sheet. `locked`
// mutes a step that isn't reachable yet — dashed border, no shadow,
// faded — rather than not rendering it at all, so the full shape of the
// form is visible from the start. `active` marks whichever step the
// student should act on right now: a gold-tinted ground, a gold-line
// border, a soft gold glow, and a small "Current step" flag — the one
// spot of color the eye should land on as you scan down the page.
function FRow({
  n,
  kicker,
  title,
  hint,
  locked = false,
  active = false,
  index,
  children,
}: {
  n: string
  kicker: string
  title: string
  hint?: string
  locked?: boolean
  active?: boolean
  index: number
  children: ReactNode
}) {
  return (
    <div
      className={`fade-up relative grid gap-8 rounded-[16px] border mb-5 p-8 md:p-10 md:w-[calc(100%+220px)] md:-ml-[110px] transition-all duration-300 ease-out ${locked ? 'opacity-45 pointer-events-none' : ''}`}
      style={{
        gridTemplateColumns: '160px minmax(0,1fr)',
        backgroundColor: active
          ? 'color-mix(in srgb, var(--color-gold) 7%, var(--color-paper-raised) 93%)'
          : 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)',
        borderColor: active ? 'var(--color-gold-line)' : locked ? 'var(--color-line)' : BORDER,
        borderStyle: locked ? 'dashed' : 'solid',
        boxShadow: locked
          ? 'none'
          : active
            ? '0 18px 34px -20px color-mix(in srgb, var(--color-gold) 55%, transparent)'
            : '0 10px 24px -16px rgba(11,18,32,0.22)',
        animationDelay: `${index * 70}ms`,
      }}
    >
      {active && (
        <span
          className="absolute -top-2.5 left-6 px-2.5 py-[3px] rounded-full text-[9.5px] font-semibold uppercase tracking-[0.08em]"
          style={{ backgroundColor: 'var(--color-gold)', color: 'var(--color-frost)' }}
        >
          Current step
        </span>
      )}
      <div>
        <div className="font-display text-[38px] leading-none" style={{ color: active ? 'var(--color-gold)' : 'var(--color-gold-line)' }}>
          {n}
        </div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] mt-2.5 leading-snug whitespace-nowrap" style={{ color: 'var(--color-char-soft)' }}>
          {kicker}
        </div>
      </div>
      <div className="min-w-0">
        <div className="font-display text-[21px] leading-snug mb-1.5" style={{ color: 'var(--color-char)' }}>
          {title}
        </div>
        {hint && (
          <div className="text-[13px] mb-4" style={{ color: 'var(--color-char-soft)' }}>
            {hint}
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

function TrailChips({ path }: { path: TreeNode[] }) {
  if (path.length === 0) return null
  return (
    <div className="flex items-center flex-wrap gap-1.5 mt-4 pt-3.5 border-t" style={{ borderColor: 'var(--color-line)' }}>
      {path.map((node, i) => (
        <span key={node.id} className="flex items-center gap-1.5">
          <span
            className="inline-flex items-center px-2.5 py-1 rounded-full text-[12px] font-medium"
            style={{ color: 'var(--color-gold)', backgroundColor: 'var(--color-gold-soft)' }}
          >
            {node.title}
          </span>
          {i < path.length - 1 && (
            <span className="text-[12px]" style={{ color: 'var(--color-char-soft)' }}>
              →
            </span>
          )}
        </span>
      ))}
    </div>
  )
}

// Strips markup to get an honest character count for the note below the
// description editor — a `<b>hi</b>` shouldn't count as 7 characters.
function plainTextLength(html: string): number {
  const el = document.createElement('div')
  el.innerHTML = html
  return (el.textContent ?? '').trim().length
}

const BORDER = 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)'

export function StudentActivitiesPage() {
  const { appUser } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const institutionId = appUser?.institutionId ?? null
  const mbbsYear = appUser?.mbbsYear ?? null

  // --- department (a per-activity choice, not a fixed profile field) ----
  // A student is bound by year only: their departments are every
  // department enabled for their college in that year (derived live —
  // lib/enabledDepartments.ts). Which one a given activity belongs to is
  // picked here, driving the log/tree fetch below, the faculty picker, and
  // what gets stamped onto the Submission.
  const { departments: myDepartments, allDepartments, loading: departmentsLoading } = useStudentDepartments(institutionId, mbbsYear)

  const [departmentId, setDepartmentId] = useState('')
  // Auto-pick the student's only department — no added friction for the
  // common single-department case, same "don't ask when there's only one
  // choice" convention institutionLocked already uses in UserFormModal.
  // A resumed draft's own hydration effect (below) overrides this
  // unconditionally once it loads, so this never fights a real resume.
  useEffect(() => {
    if (departmentId || myDepartments.length !== 1) return
    setDepartmentId(myDepartments[0].id)
  }, [departmentId, myDepartments])

  function selectDepartment(id: string) {
    setDepartmentId(id)
    setTemplateId('')
    setPath([])
    setFacultyId('')
  }

  // Resolved against every department of the college, not just enabled
  // ones, so resuming an older draft whose department has since been
  // switched off still loads its own skill tree instead of hanging.
  const department = useMemo(() => allDepartments.find((d) => d.id === departmentId) ?? null, [allDepartments, departmentId])

  const [globalTemplates, setGlobalTemplates] = useState<LogTemplate[] | null>(null)
  const [ownTemplates, setOwnTemplates] = useState<LogTemplate[] | null>(null)
  useEffect(() => {
    if (!department || !mbbsYear) return
    return watchGlobalTemplates({ department: department.name, mbbsYear }, (all) =>
      setGlobalTemplates(all.filter((t) => t.logType === 'SSL')),
    )
  }, [department, mbbsYear])
  useEffect(() => {
    if (!institutionId || !department || !mbbsYear) return
    return watchInstitutionTemplates(institutionId, { department: department.name, mbbsYear }, (all) =>
      setOwnTemplates(all.filter((t) => t.logType === 'SSL')),
    )
  }, [institutionId, department, mbbsYear])
  const templates = useMemo(() => [...(globalTemplates ?? []), ...(ownTemplates ?? [])], [globalTemplates, ownTemplates])
  const templatesLoading = globalTemplates === null || ownTemplates === null

  const [nodesByTemplate, setNodesByTemplate] = useState<Record<string, TreeNode[]>>({})
  const templateIds = templates.map((t) => t.id).join(',')
  useEffect(() => {
    if (templates.length === 0) {
      setNodesByTemplate({})
      return
    }
    const unsubs = templates.map((t) => watchTreeNodes(t.id, (n) => setNodesByTemplate((prev) => ({ ...prev, [t.id]: n }))))
    return () => unsubs.forEach((u) => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateIds])

  const [overrides, setOverrides] = useState<InstitutionCompetencyOverride[]>([])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionCompetencyOverrides(institutionId, setOverrides)
  }, [institutionId])
  function isEnabled(nodeId: string): boolean {
    const o = overrides.find((x) => x.nodeId === nodeId)
    return o ? o.enabled : true
  }

  // --- cascading selection: log → subfield → subfield → ... -------------
  const [templateId, setTemplateId] = useState('')
  const [path, setPath] = useState<TreeNode[]>([])
  const template = templates.find((t) => t.id === templateId) ?? null
  const nodes = useMemo(
    () => (templateId ? (nodesByTemplate[templateId] ?? []).filter((n) => isEnabled(n.id)) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [templateId, nodesByTemplate, overrides],
  )

  const childCount = useMemo(() => {
    const m = new Map<string | null, number>()
    nodes.forEach((n) => m.set(n.parentId, (m.get(n.parentId) ?? 0) + 1))
    return m
  }, [nodes])
  function childrenOf(parentId: string | null): TreeNode[] {
    return nodes.filter((n) => n.parentId === parentId).sort((a, b) => a.order - b.order)
  }
  function isLeafNode(node: TreeNode): boolean {
    return (childCount.get(node.id) ?? 0) === 0
  }

  // Each entry is one dropdown: its options are the children of whatever
  // was chosen at the level above (or the template root for the first
  // one). A new level only appears once the previous one resolves to a
  // node that itself has children — stops the moment a leaf is picked.
  const dropdownLevels = useMemo(() => {
    const levels: { parentId: string | null; options: TreeNode[] }[] = []
    let parentId: string | null = null
    for (let i = 0; i < 25; i++) {
      const options = childrenOf(parentId)
      if (options.length === 0) break
      levels.push({ parentId, options })
      const selected = path[i]
      if (!selected || isLeafNode(selected)) break
      parentId = selected.id
    }
    return levels
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, path])

  const leafNode = path.length > 0 && isLeafNode(path[path.length - 1]) ? path[path.length - 1] : null

  function selectTemplate(id: string) {
    setTemplateId(id)
    setPath([])
  }
  function selectAtLevel(level: number, nodeId: string) {
    const parentId = level === 0 ? null : (path[level - 1]?.id ?? null)
    const node = childrenOf(parentId).find((n) => n.id === nodeId)
    if (!node) return
    setPath([...path.slice(0, level), node])
  }

  // --- faculty ------------------------------------------------------------
  const [faculty, setFaculty] = useState<AppUser[]>([])
  useEffect(() => {
    if (!institutionId || !departmentId) return
    return watchFacultyForDepartment(institutionId, departmentId, setFaculty)
  }, [institutionId, departmentId])
  const [facultyId, setFacultyId] = useState('')

  // --- effective checklist schema for the resolved leaf --------------------
  // The student never fills this — it's the DOPS checklist the faculty will
  // complete themselves while reviewing this activity (see
  // ReviewSubmissionPage). It's only resolved/watched here so (a) its id can
  // be stamped onto the submission for the faculty to open later, and (b)
  // the student gets a heads-up if no checklist is configured yet, rather
  // than submitting into a review that can't actually happen.
  const [formOverride, setFormOverride] = useState<{ formSchemaId: string } | null | undefined>(undefined)
  useEffect(() => {
    if (!institutionId || !leafNode) {
      setFormOverride(undefined)
      return
    }
    return watchInstitutionCompetencyFormOverride(institutionId, leafNode.id, setFormOverride)
  }, [institutionId, leafNode?.id])
  const effectiveSchemaId = leafNode ? (formOverride?.formSchemaId ?? leafNode.formSchemaId ?? null) : null
  const [schema, setSchema] = useState<FormSchema | null | undefined>(undefined)
  useEffect(() => {
    if (!effectiveSchemaId) {
      setSchema(effectiveSchemaId === null ? null : undefined)
      return
    }
    return watchFormSchema(effectiveSchemaId, setSchema)
  }, [effectiveSchemaId])

  // --- activity details -------------------------------------------------
  const [activityDate, setActivityDate] = useState(todayIso())
  const [attemptType, setAttemptType] = useState<AttemptType | ''>('')

  // --- description ----------------------------------------------------------
  const [description, setDescription] = useState('')
  const [images, setImages] = useState<DraftImage[]>([])
  // What's currently saved on the doc — diffed on save so images the
  // student removed (or a sketch they redrew) are deleted from Storage.
  const savedImagesRef = useRef<SubmissionImage[]>([])
  const imagesRef = useRef(images)
  imagesRef.current = images
  // Free the local previews of never-saved images when leaving the page.
  useEffect(() => () => imagesRef.current.forEach(revokeDraft), [])

  // --- resume an existing draft / revision-requested submission -----------
  const submissionId = searchParams.get('submissionId')
  const [existing, setExisting] = useState<Submission | null | undefined>(undefined)
  useEffect(() => {
    if (!submissionId) {
      setExisting(undefined)
      return
    }
    return watchSubmission(submissionId, setExisting)
  }, [submissionId])

  const [hydrated, setHydrated] = useState(!submissionId)
  // Department has to be restored *before* the rest can hydrate — the
  // template/tree fetch below only runs once `department` resolves, which
  // depends on this. Split into its own effect (no wait for nodesByTemplate)
  // so it fires the moment the existing submission loads, rather than being
  // stuck behind the very fetch it unblocks.
  useEffect(() => {
    if (!submissionId || hydrated || !existing) return
    setDepartmentId(existing.departmentId)
  }, [submissionId, hydrated, existing])
  useEffect(() => {
    if (!submissionId || hydrated || !existing) return
    const existingNodes = nodesByTemplate[existing.templateId]
    if (!existingNodes) return // wait for this template's tree to load
    setTemplateId(existing.templateId)
    setPath(buildPathToNode(existingNodes, existing.nodeId))
    setFacultyId(existing.facultyId)
    setActivityDate(existing.activityDate || todayIso())
    setAttemptType(existing.attemptType ?? '')
    setDescription(existing.description ?? '')
    savedImagesRef.current = existing.images ?? []
    setImages(toDraftImages(existing.images ?? []))
    setHydrated(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissionId, existing, nodesByTemplate])

  const [savedId, setSavedId] = useState<string | null>(submissionId)
  const [saving, setSaving] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [saveError, setSaveError] = useState('')

  async function saveDraft(): Promise<string | null> {
    if (!appUser || !template || !leafNode || !institutionId || !departmentId || !mbbsYear || !effectiveSchemaId) return null
    setSaving(true)
    setSaveError('')
    const id = savedId ?? newSubmissionId()
    let uploaded: SubmissionImage[] = []
    try {
      // 1) photos/sketch to Storage (only the ones not uploaded yet)
      uploaded = await uploadDraftImages(appUser.uid, id, images)
      const patch = {
        templateId: template.id,
        nodeId: leafNode.id,
        nodeTitle: leafNode.title,
        formSchemaId: effectiveSchemaId,
        facultyId,
        activityDate,
        attemptType,
        description: description ? sanitizeRichText(description) : null,
        images: uploaded,
      }
      // 2) the activity doc, pointing at the uploaded files
      if (savedId) {
        await updateDraftSubmission(savedId, patch)
      } else {
        // answers stays empty at creation — it's filled in by the faculty
        // during review, never by the student.
        await createDraftSubmission(
          {
            studentId: appUser.uid,
            institutionId,
            departmentId,
            mbbsYear,
            logType: 'SSL',
            answers: {},
            ...patch,
          },
          id,
        )
      }
      // 3) only now that the doc no longer references them, delete files
      // the student removed or replaced
      const keep = new Set(uploaded.map((u) => u.path))
      void deleteStoredImages(savedImagesRef.current.filter((old) => old.path && !keep.has(old.path)))
      savedImagesRef.current = uploaded
      images.forEach(revokeDraft)
      setImages(toDraftImages(uploaded))
      if (!savedId) {
        setSavedId(id)
        setSearchParams({ submissionId: id }, { replace: true })
      }
      return id
    } catch {
      // Files uploaded in this attempt that the doc never got to reference.
      const before = new Set(savedImagesRef.current.map((x) => x.path))
      void deleteStoredImages(uploaded.filter((u) => !before.has(u.path)))
      setSaveError('Couldn’t save — check your connection and try again. Your text and images are still here.')
      return null
    } finally {
      setSaving(false)
    }
  }

  async function handleSubmit() {
    if (!facultyId || !leafNode || !activityDate || !attemptType) return
    // Captured before saveDraft()/submitSubmission() run — this is the
    // status the doc was in when the student opened "Send for review",
    // i.e. whether they're resubmitting after a revision request.
    const wasRevisionRequested = existing?.status === 'revisionRequested'
    setSubmitting(true)
    try {
      const id = await saveDraft()
      if (id) {
        await submitSubmission(id, wasRevisionRequested)
        navigate('/student/my-activity')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const locked = !!existing && existing.status !== 'draft' && existing.status !== 'revisionRequested'
  const noProfile = !appUser?.institutionId || !appUser?.mbbsYear
  const loadingResume = !!submissionId && !hydrated
  const noteLen = useMemo(() => plainTextLength(description), [description])

  const submitHint = !leafNode
    ? 'Choose a specific skill to continue.'
    : !facultyId
      ? 'Choose a faculty member to continue.'
      : !activityDate
        ? 'Pick the date you performed this activity.'
        : !attemptType
          ? 'Choose an attempt type to continue.'
          : schema === undefined
            ? 'Checking for a review checklist…'
            : !effectiveSchemaId
              ? 'No review checklist is configured for this skill yet.'
              : 'Ready to send.'

  if (noProfile) {
    return (
      <StudentShell eyebrow="Log an activity" title="New Activity">
        <Card elevated className="max-w-lg">
          <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            Your profile is missing an institution or MBBS year — ask your institution admin to complete it before you
            can log activities.
          </p>
        </Card>
      </StudentShell>
    )
  }

  if (locked) {
    return (
      <StudentShell eyebrow={department?.name} title="New Activity">
        <Card elevated className="max-w-lg">
          <p className="text-[13.5px] mb-3" style={{ color: 'var(--color-char-soft)' }}>
            This activity has already been submitted — you can no longer edit it here.
          </p>
          <PrimaryButton onClick={() => navigate('/student/my-activity')}>View in My Activity</PrimaryButton>
        </Card>
      </StudentShell>
    )
  }

  return (
    <StudentShell eyebrow={department ? department.name : 'Log an activity'} title="New Activity">
      <div className="max-w-[860px] w-full mx-auto">
        {loadingResume ? (
          <div className="space-y-4">
            <Skeleton className="h-24 rounded-[10px]" />
            <Skeleton className="h-24 rounded-[10px]" />
            <Skeleton className="h-64 rounded-[10px]" />
          </div>
        ) : (
          <>
            <FRow n="01" index={0} active={!departmentId} kicker="Choose department" title="Which department is this for?">
              {departmentsLoading ? (
                <Skeleton className="h-11 rounded-[8px]" />
              ) : myDepartments.length === 0 ? (
                <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
                  No departments are enabled for Year {mbbsYear} at your college yet — ask your institution admin.
                </p>
              ) : (
                <select
                  className={inputClass}
                  style={{ borderColor: 'var(--color-line)', color: departmentId ? 'var(--color-char)' : 'var(--color-char-soft)' }}
                  value={departmentId}
                  onChange={(e) => selectDepartment(e.target.value)}
                >
                  <option value="" disabled>
                    Choose a department…
                  </option>
                  {myDepartments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              )}
            </FRow>

            <FRow n="02" index={1} active={!!departmentId && !templateId} kicker="Select log" title={`${department?.name ?? ''} SSL logs`} locked={!departmentId}>
              {templatesLoading ? (
                <Skeleton className="h-11 rounded-[8px]" />
              ) : templates.length === 0 ? (
                <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
                  No SSL logs are available for your department and year yet.
                </p>
              ) : (
                <select
                  className={inputClass}
                  style={{ borderColor: 'var(--color-line)', color: templateId ? 'var(--color-char)' : 'var(--color-char-soft)' }}
                  value={templateId}
                  onChange={(e) => selectTemplate(e.target.value)}
                >
                  <option value="" disabled>
                    Choose a log…
                  </option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.title}
                    </option>
                  ))}
                </select>
              )}
            </FRow>

            <FRow
              n="03"
              index={2}
              active={!!templateId && !leafNode}
              kicker="Narrow to a skill"
              title={template ? template.title : 'Choose a log to see its categories'}
              hint="Each choice reveals the next level, until a specific skill is reached."
              locked={!templateId}
            >
              {dropdownLevels.length > 0 ? (
                <div className="rounded-[8px] border overflow-hidden" style={{ borderColor: 'var(--color-line)' }}>
                  {dropdownLevels.map((level, i) => (
                    <div
                      key={level.parentId ?? 'root'}
                      className="flex items-center gap-3.5 px-3.5 py-2.5"
                      style={{ borderBottom: i === dropdownLevels.length - 1 ? undefined : '1px solid var(--color-line)' }}
                    >
                      <span
                        className="w-[104px] shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.08em]"
                        style={{ color: 'var(--color-char-soft)' }}
                      >
                        {i === 0 ? 'Category' : `Level ${i + 1}`}
                      </span>
                      <select
                        className={`${inputClass} flex-1`}
                        style={{ borderColor: 'var(--color-line)', color: path[i] ? 'var(--color-char)' : 'var(--color-char-soft)' }}
                        value={path[i]?.id ?? ''}
                        onChange={(e) => selectAtLevel(i, e.target.value)}
                      >
                        <option value="" disabled>
                          Choose…
                        </option>
                        {level.options.map((n) => (
                          <option key={n.id} value={n.id}>
                            {n.title}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              ) : (
                <select className={inputClass} disabled style={{ borderColor: 'var(--color-line)', color: 'var(--color-char-soft)' }}>
                  <option>Choose a log above first…</option>
                </select>
              )}
              <TrailChips path={path} />
            </FRow>

            <FRow
              n="04"
              index={3}
              active={!!leafNode && (!facultyId || !activityDate || !attemptType)}
              kicker="Send to faculty"
              title={`Reviewer in ${department?.name ?? 'your department'}`}
              locked={!leafNode}
            >
              {faculty.length === 0 ? (
                <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
                  No faculty are set up in your department yet — ask your institution admin.
                </p>
              ) : (
                <select
                  className={inputClass}
                  style={{ borderColor: 'var(--color-line)', color: facultyId ? 'var(--color-char)' : 'var(--color-char-soft)' }}
                  value={facultyId}
                  onChange={(e) => setFacultyId(e.target.value)}
                >
                  <option value="" disabled>
                    Choose a faculty member…
                  </option>
                  {faculty.map((f) => (
                    <option key={f.uid} value={f.uid}>
                      {f.name}
                    </option>
                  ))}
                </select>
              )}

              <div className="grid sm:grid-cols-2 gap-3.5 mt-3.5">
                <div>
                  <span className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] mb-1.5" style={{ color: 'var(--color-char-soft)' }}>
                    Date of activity
                  </span>
                  <input
                    type="date"
                    className={inputClass}
                    style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
                    value={activityDate}
                    max={todayIso()}
                    onChange={(e) => setActivityDate(e.target.value)}
                  />
                </div>
                <div>
                  <span className="block text-[10.5px] font-semibold uppercase tracking-[0.08em] mb-1.5" style={{ color: 'var(--color-char-soft)' }}>
                    Attempt type
                  </span>
                  <select
                    className={inputClass}
                    style={{ borderColor: 'var(--color-line)', color: attemptType ? 'var(--color-char)' : 'var(--color-char-soft)' }}
                    value={attemptType}
                    onChange={(e) => setAttemptType(e.target.value as AttemptType)}
                  >
                    <option value="" disabled>
                      Choose…
                    </option>
                    {ATTEMPT_TYPES.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </FRow>

            <FRow
              n="05"
              index={4}
              active={!!leafNode && !!facultyId && !!activityDate && !!attemptType}
              kicker="Notes"
              title="Additional description"
            >
              <RichTextEditor
                value={description}
                onChange={setDescription}
                images={images}
                onImagesChange={setImages}
                placeholder="Describe what you did, what you observed, and anything your reviewer should know…"
              />
              <div className="flex items-center justify-between mt-2 text-[12px]" style={{ color: 'var(--color-char-soft)' }}>
                <span>Formatting and links are preserved in the faculty's review view.</span>
                <span className="tabular-nums shrink-0">{noteLen} characters</span>
              </div>
            </FRow>

            <div
              className="fade-up flex items-center gap-3 rounded-[16px] border p-6 md:p-7 md:w-[calc(100%+220px)] md:-ml-[110px] flex-wrap"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)',
                borderColor: BORDER,
                animationDelay: '280ms',
              }}
            >
              <div className="flex-1 text-[12.5px] min-w-[180px]" style={{ color: saveError ? 'var(--color-clay)' : 'var(--color-char-soft)' }}>
                {saveError || submitHint}
              </div>
              <GhostButton onClick={saveDraft} disabled={!leafNode || saving || submitting}>
                {saving ? (images.some((i) => i.blob) ? 'Uploading images…' : 'Saving…') : 'Save draft'}
              </GhostButton>
              <PrimaryButton
                onClick={handleSubmit}
                disabled={!facultyId || !activityDate || !attemptType || !effectiveSchemaId || submitting || saving}
              >
                {submitting ? 'Submitting…' : 'Send for review'}
              </PrimaryButton>
            </div>
          </>
        )}
      </div>
    </StudentShell>
  )
}
