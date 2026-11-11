import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { PrimaryAdminShell } from './shell/PrimaryAdminShell'
import { GhostButton, PrimaryButton, Skeleton } from './shell/ui'
import { Icon } from './shell/Icon'
import { DopsChecklistPreview, isDopsSchema } from './DopsChecklistPreview'
import {
  defaultSectionName,
  parseSections,
  serializeSections,
  type EditorQuestion,
  type EditorSection,
} from '../../components/formEngine/checklistSections'
import {
  watchTemplate,
  watchTreeNode,
  watchGlobalTemplates,
  getOrCreateGlobalSslTemplate,
  createTreeNode,
  updateTreeNode,
  deleteTreeNode,
  countTemplateFields,
  watchInstitutionCompetencyFormOverride,
  setInstitutionCompetencyFormOverride,
  deleteInstitutionCompetencyFormOverride,
} from '../../lib/firestore/logTemplates'
import { watchFormSchema, getFormSchema, createFormSchema, updateFormSchema, deleteFormSchema } from '../../lib/firestore/formSchemas'
import { watchAllDepartments } from '../../lib/firestore/departments'
import { watchInstitution } from '../../lib/firestore/institutions'
import { useAuth } from '../../auth/AuthContext'
import type {
  CompetencyLevel,
  Department,
  FormField,
  FormFieldType,
  Institution,
  InstitutionCompetencyFormOverride,
  LogTemplate,
  TreeNode,
} from '../../types'

const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  text: 'Short text',
  textarea: 'Long text',
  number: 'Number',
  date: 'Date',
  dropdown: 'Dropdown',
  checkbox: 'Checkbox group',
  rating: 'Rating scale',
}

const LEVELS: { key: CompetencyLevel; label: string }[] = [
  { key: 'O', label: 'Observed' },
  { key: 'A', label: 'Assisted' },
  { key: 'P', label: 'Performed under supervision' },
  { key: 'I', label: 'Independently performed' },
]
const DOMAINS = ['Cognitive', 'Psychomotor', 'Affective', 'Communication']

// Border color used throughout this page instead of a white fill — same
// "merges with the page, defined by its border" treatment used for the
// Users table, rather than the raised-white-card look used elsewhere.
const BORDER = 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)'
const SECTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

// The "Step 0N — Title" kicker pattern — adapted from a design reference
// the user liked (attaching references/Competencies.dc.html). Genuinely
// informative here, not decorative: the page really is built section by
// section, in this order, every time.
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

// Mirrors the tone system the preview uses for Done/Not done/N/A, so an
// option's color here foreshadows how it'll actually render to faculty.
function dotColorForOption(opt: string): string {
  const norm = opt.trim().toLowerCase()
  if (norm === 'done') return 'var(--color-teal)'
  if (norm === 'not done' || norm === 'notdone') return 'var(--color-clay)'
  if (norm === 'n/a' || norm === 'na') return 'var(--color-char-soft)'
  return 'var(--color-gold)'
}

// A vertical, ledger-style list of choices — replaces a wrapping row of
// auto-sized pill chips, which read as cramped and undifferentiated. Each
// option gets its own line, a tone dot, and a flat underline input; the
// remove control only appears on hover to keep the list quiet at rest.
function OptionsEditor({ options, onChange }: { options: string[]; onChange: (options: string[]) => void }) {
  return (
    <div className="rounded-[8px] border overflow-hidden" style={{ borderColor: 'var(--color-line)' }}>
      {options.map((opt, i) => (
        <div
          key={i}
          className="group flex items-center gap-2.5 px-3 py-2"
          style={{ borderBottom: i < options.length - 1 ? '1px solid var(--color-line)' : undefined }}
        >
          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: dotColorForOption(opt) }} />
          <input
            value={opt}
            onChange={(e) => {
              const next = [...options]
              next[i] = e.target.value
              onChange(next)
            }}
            placeholder="Option label"
            className="flex-1 min-w-0 text-[13px] outline-none bg-transparent border-b pb-0.5 transition-colors duration-150 focus:border-[var(--color-gold)]"
            style={{ color: 'var(--color-char)', borderColor: 'transparent' }}
          />
          <button
            onClick={() => onChange(options.filter((_, idx) => idx !== i))}
            className="h-5 w-5 shrink-0 flex items-center justify-center rounded-[3px] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-black/[0.06]"
            style={{ color: 'var(--color-clay)' }}
            aria-label="Remove option"
          >
            <Icon name="close" className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...options, ''])}
        className="w-full flex items-center gap-1.5 px-3 py-2 text-[12px] font-medium transition-colors duration-150 hover:bg-black/[0.03]"
        style={{ color: 'var(--color-gold)' }}
      >
        <Icon name="plus" className="h-3 w-3" />
        Add option
      </button>
    </div>
  )
}

// idPrefix keeps a newly-added rating field grouped correctly as a rating
// after the next reload — grouping is inferred from the id prefix (see
// the load effect below and DopsChecklistPreview's parseDops), not
// remembered anywhere else.
function newField(idPrefix = ''): FormField {
  return { id: `${idPrefix}${crypto.randomUUID()}`, type: 'text', label: '', required: false, options: null, maxRating: null }
}

// The three fields every DOPS checklist ends with — fixed identity (same
// ids DopsChecklistPreview already recognizes), toggled on/off rather than
// manually built field-by-field like a custom field would be.
const KNOWN_CLOSING_FIELDS: { id: string; label: string; hint: string; field: FormField }[] = [
  {
    id: 'feedback',
    label: 'Faculty Feedback',
    hint: 'Free-text comments on performance, safety, and next steps.',
    field: { id: 'feedback', type: 'textarea', label: 'Faculty Feedback', required: false, options: null, maxRating: null },
  },
  {
    id: 'student-ack',
    label: 'Student Acknowledgement',
    hint: 'Typed name captured alongside the assessor signature.',
    field: { id: 'student-ack', type: 'text', label: 'Student Acknowledgement (typed name)', required: false, options: null, maxRating: null },
  },
  {
    id: 'assessor-sign',
    label: 'Assessor Signature',
    hint: "The evaluating faculty member's typed name.",
    field: { id: 'assessor-sign', type: 'text', label: 'Assessor Signature (typed name)', required: false, options: null, maxRating: null },
  },
]

// A dedicated page (not a modal) for building a single competency's
// checklist — mirrors how a log template gets its own route/page rather
// than a popup. Structured the way the source DOPS checklists are:
// lettered sections, each holding numbered questions with their own
// options and an optional remarks field. Reachable from the Competencies
// page's edit icon.
export function PrimaryAdminCompetencyEditorPage({
  variant = 'primaryAdmin',
  ShellComponent = PrimaryAdminShell,
  forkForInstitution = false,
}: {
  // The Institution Admin panel reuses this whole page — it just injects
  // its own shell, keeps every back-nav inside /institution-admin, and
  // (for the "global" case) forces the fork-for-my-institution flow using
  // the signed-in admin's own institutionId instead of a ?institutionId
  // query param.
  variant?: 'primaryAdmin' | 'institutionAdmin'
  ShellComponent?: typeof PrimaryAdminShell
  forkForInstitution?: boolean
} = {}) {
  const { templateId, nodeId } = useParams<{ templateId: string; nodeId: string }>()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { appUser } = useAuth()

  const isInstAdmin = variant === 'institutionAdmin'
  const competenciesBase = isInstAdmin ? '/institution-admin/competencies' : '/admin/competencies'
  // Set only when editing an institution's *forked* copy of a GLOBAL
  // competency's form (vs. editing a global or an institution-owned one
  // directly). Primary admin gets this from a ?institutionId param;
  // Institution Admin's "global" route sets forkForInstitution and it
  // resolves to their own institution.
  const institutionId = isInstAdmin
    ? forkForInstitution
      ? (appUser?.institutionId ?? null)
      : null
    : searchParams.get('institutionId')

  const [formOverride, setFormOverride] = useState<InstitutionCompetencyFormOverride | null | undefined>(undefined)
  useEffect(() => {
    if (!institutionId || !nodeId) {
      setFormOverride(undefined)
      return
    }
    return watchInstitutionCompetencyFormOverride(institutionId, nodeId, setFormOverride)
  }, [institutionId, nodeId])

  const [template, setTemplate] = useState<LogTemplate | null | undefined>(undefined)
  const [node, setNode] = useState<TreeNode | null | undefined>(undefined)
  const [title, setTitle] = useState('')
  const [code, setCode] = useState('')
  const [setting, setSetting] = useState('')
  const [level, setLevel] = useState<CompetencyLevel | null>(null)
  const [domains, setDomains] = useState<string[]>([])
  const [departments, setDepartments] = useState<Department[] | null>(null)
  const [globalSslTemplates, setGlobalSslTemplates] = useState<LogTemplate[] | null>(null)
  const [selectedDepartment, setSelectedDepartment] = useState('')
  const [sections, setSections] = useState<EditorSection[]>([])
  const [ratingFields, setRatingFields] = useState<FormField[]>([])
  const [feedbackFields, setFeedbackFields] = useState<FormField[]>([])
  const [loaded, setLoaded] = useState(false)
  const nextN = useRef(1)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewExpanded, setPreviewExpanded] = useState(false)
  const [lastAddedFieldId, setLastAddedFieldId] = useState<string | null>(null)
  // Explicit per-section choice, not derived from the questions' own
  // hasRemark values — deriving it caused a real bug: after bulk-turning
  // remarks "all" on, every question's hasRemark was true, so "per
  // question" kept re-deriving back to "all" and its segment looked
  // unclickable. Missing entries default to 'per' (each question decides
  // for itself, the normal starting mode).
  const [sectionRemarksMode, setSectionRemarksModeState] = useState<Record<string, 'all' | 'per' | 'none'>>({})

  useEffect(() => {
    if (!templateId) return
    return watchTemplate(templateId, setTemplate)
  }, [templateId])

  useEffect(() => {
    if (!templateId || !nodeId) return
    return watchTreeNode(templateId, nodeId, setNode)
  }, [templateId, nodeId])

  useEffect(() => {
    if (node) setTitle(node.title)
  }, [node?.id])

  // Whose portal this competency belongs to — either the institution
  // forking this global node's form (query param) or, for a node that
  // natively belongs to an institution-owned SSL template (no fork
  // involved at all), that template's own institutionId. Everything about
  // *whose page this is* (eyebrow, back-nav, institution fetch) keys off
  // this; the fork/clone machinery below keeps keying strictly off the raw
  // `institutionId` param, since native nodes never go through it.
  const ownerInstitutionId = institutionId ?? (template?.scope === 'institution' ? template.institutionId : null)

  const [institution, setInstitution] = useState<Institution | null | undefined>(undefined)
  useEffect(() => {
    if (!ownerInstitutionId) return
    return watchInstitution(ownerInstitutionId, setInstitution)
  }, [ownerInstitutionId])

  // watchAllDepartments() is an unfiltered list query — Firestore rules
  // only let the primary admin run it (see CLAUDE.md). Institution Admin
  // never needs it anyway: the department-reassignment dropdown below is
  // already hidden whenever institutionId is set or the node is natively
  // institution-owned, i.e. always, for this variant. Firing it
  // unconditionally used to throw an uncaught permission-denied on every
  // mount of this page for an institution admin, which could disrupt the
  // rest of the page's listeners on the same connection and leave it stuck
  // on "Loading…" — that's why Edit/Customize/Add checklist looked like
  // they weren't opening.
  useEffect(() => {
    if (isInstAdmin) return
    return watchAllDepartments(setDepartments)
  }, [isInstAdmin])
  useEffect(() => watchGlobalTemplates({}, (all) => setGlobalSslTemplates(all.filter((t) => t.logType === 'SSL'))), [])

  useEffect(() => {
    if (template) setSelectedDepartment(template.department)
  }, [template?.id])

  // Every department name in the catalog, deduplicated (the catalog can
  // hold the same name at several MBBS years).
  const departmentOptions = useMemo(() => {
    const names = new Set((departments ?? []).map((d) => d.name))
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [departments])

  useEffect(() => {
    if (node === null) {
      setLoaded(true)
      return
    }
    if (node === undefined) return
    if (!templateId || !nodeId) return

    if (!institutionId) {
      // Global mode — unchanged from before this feature existed.
      if (!node.formSchemaId) {
        // A procedure created straight from the Log Templates tree editor
        // (not through this page) has no checklist attached yet. Rather
        // than hang here forever, provision an empty one and attach it —
        // the editor below then has something real to build on.
        let cancelled = false
        createFormSchema({
          title: node.title,
          fields: [],
          code: null,
          setting: null,
          level: null,
          domains: null,
          createdBy: appUser?.uid ?? '',
        }).then(async (schemaId) => {
          if (cancelled) return
          await updateTreeNode(templateId, nodeId, { formSchemaId: schemaId })
        })
        return () => {
          cancelled = true
        }
      }

      return watchFormSchema(node.formSchemaId, (schema) => {
        const parsed = parseSections(schema?.fields ?? [])
        setSections(parsed.sections)
        setRatingFields(parsed.otherFields.filter((f) => f.id.startsWith('rating-')))
        setFeedbackFields(parsed.otherFields.filter((f) => !f.id.startsWith('rating-')))
        nextN.current = parsed.nextN
        setCode(schema?.code ?? '')
        setSetting(schema?.setting ?? '')
        setLevel(schema?.level ?? null)
        setDomains(schema?.domains ?? [])
        setLoaded(true)
      })
    }

    // Institution-override mode — wait for the override lookup to resolve
    // before deciding whether to clone or load the existing fork.
    if (formOverride === undefined) return

    if (formOverride === null) {
      // No fork yet for this institution — clone the global form's current
      // fields into a brand-new FormSchema this institution owns, then
      // point an override doc at it. The global node/schema are never
      // written to here.
      if (!node.formSchemaId) return
      let cancelled = false
      ;(async () => {
        const globalSchema = await getFormSchema(node.formSchemaId!)
        const newSchemaId = await createFormSchema({
          title: node.title,
          fields: globalSchema?.fields ?? [],
          code: globalSchema?.code ?? null,
          setting: globalSchema?.setting ?? null,
          level: globalSchema?.level ?? null,
          domains: globalSchema?.domains ?? null,
          createdBy: appUser?.uid ?? '',
        })
        if (cancelled) return
        await setInstitutionCompetencyFormOverride(institutionId, nodeId, newSchemaId)
      })()
      return () => {
        cancelled = true
      }
    }

    return watchFormSchema(formOverride.formSchemaId, (schema) => {
      const parsed = parseSections(schema?.fields ?? [])
      setSections(parsed.sections)
      setRatingFields(parsed.otherFields.filter((f) => f.id.startsWith('rating-')))
      setFeedbackFields(parsed.otherFields.filter((f) => !f.id.startsWith('rating-')))
      nextN.current = parsed.nextN
      setCode(schema?.code ?? '')
      setSetting(schema?.setting ?? '')
      setLevel(schema?.level ?? null)
      setDomains(schema?.domains ?? [])
      setLoaded(true)
    })
  }, [node?.formSchemaId, node?.id, templateId, nodeId, institutionId, formOverride])

  const loading = template === undefined || node === undefined || !loaded
  const notFound = template === null || node === null || !templateId || !nodeId

  const otherFields = useMemo(() => [...ratingFields, ...feedbackFields], [ratingFields, feedbackFields])
  const previewFields = useMemo(() => serializeSections(sections, otherFields), [sections, otherFields])
  const isDops = isDopsSchema(previewFields)

  function addSection() {
    setSections((prev) => [...prev, { id: crypto.randomUUID(), name: defaultSectionName(prev.length), questions: [] }])
  }
  function removeSection(sectionId: string) {
    setSections((prev) => prev.filter((s) => s.id !== sectionId))
  }
  function renameSection(sectionId: string, name: string) {
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, name } : s)))
  }
  function addQuestion(sectionId: string) {
    const n = nextN.current++
    const question: EditorQuestion = {
      id: crypto.randomUUID(),
      n,
      text: '',
      type: 'dropdown',
      options: ['Done', 'Not done', 'N/A'],
      maxRating: null,
      hasRemark: (sectionRemarksMode[sectionId] ?? 'per') !== 'none',
    }
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, questions: [...s.questions, question] } : s)))
    setLastAddedFieldId(question.id)
  }
  function updateQuestion(sectionId: string, questionId: string, patch: Partial<EditorQuestion>) {
    setSections((prev) =>
      prev.map((s) =>
        s.id === sectionId ? { ...s, questions: s.questions.map((q) => (q.id === questionId ? { ...q, ...patch } : q)) } : s,
      ),
    )
  }
  function removeQuestion(sectionId: string, questionId: string) {
    setSections((prev) =>
      prev.map((s) => (s.id === sectionId ? { ...s, questions: s.questions.filter((q) => q.id !== questionId) } : s)),
    )
  }
  function moveQuestion(sectionId: string, index: number, dir: -1 | 1) {
    setSections((prev) =>
      prev.map((s) => {
        if (s.id !== sectionId) return s
        const qs = [...s.questions]
        const target = index + dir
        if (target < 0 || target >= qs.length) return s
        ;[qs[index], qs[target]] = [qs[target], qs[index]]
        return { ...s, questions: qs }
      }),
    )
  }

  // "all"/"none" additionally force every question's hasRemark in one
  // sweep; "per" just switches the mode and hands control back to each
  // question's own toggle without touching their current values.
  function setSectionRemarksMode(sectionId: string, mode: 'all' | 'per' | 'none') {
    setSectionRemarksModeState((prev) => ({ ...prev, [sectionId]: mode }))
    if (mode === 'all' || mode === 'none') {
      const forced = mode === 'all'
      setSections((prev) =>
        prev.map((s) => (s.id === sectionId ? { ...s, questions: s.questions.map((q) => ({ ...q, hasRemark: forced })) } : s)),
      )
    }
  }

  function fieldOps(setFields: (fn: (prev: FormField[]) => FormField[]) => void, idPrefix = '') {
    return {
      update: (id: string, patch: Partial<FormField>) => setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f))),
      remove: (id: string) => setFields((prev) => prev.filter((f) => f.id !== id)),
      add: () => {
        const field = newField(idPrefix)
        setFields((prev) => [...prev, field])
        setLastAddedFieldId(field.id)
      },
      move: (index: number, dir: -1 | 1) =>
        setFields((prev) => {
          const next = [...prev]
          const target = index + dir
          if (target < 0 || target >= next.length) return prev
          ;[next[index], next[target]] = [next[target], next[index]]
          return next
        }),
    }
  }
  const ratingOps = fieldOps(setRatingFields, 'rating-')
  const feedbackOps = fieldOps(setFeedbackFields)

  const customFeedbackFields = feedbackFields.filter((f) => !KNOWN_CLOSING_FIELDS.some((k) => k.id === f.id))

  function toggleKnownField(known: (typeof KNOWN_CLOSING_FIELDS)[number], on: boolean) {
    setFeedbackFields((prev) => (on ? [...prev, known.field] : prev.filter((f) => f.id !== known.id)))
  }

  async function handleSave() {
    if (!templateId || !nodeId || !node || !template) return

    if (institutionId) {
      // Institution-override mode: only the forked FormSchema changes.
      // No department move, no title rename, no touching the global node.
      if (!formOverride) return
      setSaving(true)
      await updateFormSchema(formOverride.formSchemaId, {
        fields: serializeSections(sections, otherFields),
        code: code.trim() || null,
        setting: setting.trim() || null,
        level,
        domains: domains.length ? domains : null,
      })
      setSaving(false)
      return
    }

    setSaving(true)

    let targetTemplateId = templateId
    let targetNodeId = nodeId
    // Guarded on scope === 'global': an institution-owned competency must
    // never be routed through getOrCreateGlobalSslTemplate below — that
    // would silently promote it into a global template. The Department
    // field is already hidden for scope === 'institution', so this is
    // belt-and-suspenders in case selectedDepartment ever diverges.
    const departmentChanged = template.scope === 'global' && !!selectedDepartment && selectedDepartment !== template.department

    if (departmentChanged) {
      // Move this competency to the selected department's SSL log
      // template — reusing the same formSchemaId, so its checklist isn't
      // touched, just re-parented to a different template/department.
      const destTemplateId = await getOrCreateGlobalSslTemplate(selectedDepartment, template.mbbsYear, appUser?.uid ?? '')
      const order = await countTemplateFields({ id: destTemplateId, logType: 'SSL' } as LogTemplate)
      targetNodeId = await createTreeNode(destTemplateId, {
        parentId: null,
        title,
        order,
        type: node.type,
        required: node.required,
        formSchemaId: node.formSchemaId,
      })
      await deleteTreeNode(templateId, nodeId)
      targetTemplateId = destTemplateId
    }

    const tasks: Promise<unknown>[] = []
    if (!departmentChanged && title !== node.title) tasks.push(updateTreeNode(targetTemplateId, targetNodeId, { title }))
    if (node.formSchemaId)
      tasks.push(
        updateFormSchema(node.formSchemaId, {
          fields: serializeSections(sections, otherFields),
          code: code.trim() || null,
          setting: setting.trim() || null,
          level,
          domains: domains.length ? domains : null,
        }),
      )
    await Promise.all(tasks)
    setSaving(false)

    // Department change is only possible for a global competency (primary
    // admin authoring) — the field is read-only in every institution-admin
    // mode — so this re-nav to the moved node never fires for them and
    // doesn't need an /institution-admin equivalent path.
    if (departmentChanged && !isInstAdmin) navigate(`/admin/competencies/${targetTemplateId}/${targetNodeId}`, { replace: true })
  }

  async function handleDelete() {
    if (!templateId || !nodeId || !node) return
    setSaving(true)
    if (node.formSchemaId) await deleteFormSchema(node.formSchemaId)
    await deleteTreeNode(templateId, nodeId)
    navigate(competenciesBase)
  }

  async function handleRemoveOverride() {
    if (!institutionId || !nodeId || !formOverride) return
    setSaving(true)
    await deleteFormSchema(formOverride.formSchemaId)
    await deleteInstitutionCompetencyFormOverride(institutionId, nodeId)
    navigate(isInstAdmin ? competenciesBase : `/admin/institutions/${institutionId}`)
  }

  return (
    <ShellComponent
      eyebrow={
        ownerInstitutionId
          ? institution
            ? `${institution.name} · Competencies`
            : 'Institution competency'
          : template
            ? `Competencies · ${template.department}`
            : 'Competencies'
      }
      title={loading ? 'Loading…' : notFound ? 'Not found' : title || 'Untitled competency'}
      actions={
        !loading && !notFound ? (
          <div className="flex items-center gap-2">
            <GhostButton onClick={() => setPreviewOpen(true)}>
              <Icon name="eye" className="h-3.5 w-3.5" />
              Preview
            </GhostButton>
            <PrimaryButton onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : 'Save changes'}
            </PrimaryButton>
          </div>
        ) : undefined
      }
    >
      <div className="max-w-3xl mx-auto">
        <button
          onClick={() =>
            navigate(
              isInstAdmin
                ? competenciesBase
                : ownerInstitutionId
                  ? `/admin/institutions/${ownerInstitutionId}`
                  : '/admin/competencies',
            )
          }
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium mb-5 hover:opacity-70 transition-opacity"
          style={{ color: 'var(--color-char-soft)' }}
        >
          <Icon name="chevron" className="h-3 w-3 rotate-180" />
          {!isInstAdmin && ownerInstitutionId ? 'Back to institution' : 'All competencies'}
        </button>

        {institutionId && !loading && !notFound && (
          <div
            className="chamfer-sm mb-5 px-4 py-3 text-[12.5px] leading-relaxed"
            style={{ backgroundColor: 'color-mix(in srgb, var(--color-gold) 10%, var(--color-paper))', color: 'var(--color-char)' }}
          >
            Editing <strong className="font-medium">{institution?.name ?? 'this institution'}</strong>'s version of this
            competency — changes here don't affect the global competency or any other institution.
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-14" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        ) : notFound ? (
          <div className="rounded-[10px] border p-5" style={{ backgroundColor: 'var(--color-paper)', borderColor: BORDER }}>
            <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
              This competency doesn't exist or you don't have access to it.
            </p>
          </div>
        ) : (
          <>
            <StepHeader
              step="01"
              title="Identity"
              hint="What this competency is, and at what level it's expected to be performed."
            />
            <div className="rounded-[10px] border p-5 mb-9" style={{ backgroundColor: 'var(--color-paper)', borderColor: BORDER }}>
              <label
                className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]"
                style={{ color: 'var(--color-char-soft)' }}
              >
                Competency / procedure name
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                readOnly={!!institutionId}
                className="w-full font-display text-[22px] outline-none bg-transparent pb-4 mb-4 border-b disabled:opacity-60"
                style={{ color: 'var(--color-char)', borderColor: BORDER, cursor: institutionId ? 'default' : 'text' }}
                placeholder="e.g. Basic Suturing"
              />

              {!institutionId && template?.scope !== 'institution' && (
                <div className="mb-5">
                  <label
                    className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]"
                    style={{ color: 'var(--color-char-soft)' }}
                  >
                    Department
                  </label>
                  <select
                    value={selectedDepartment}
                    onChange={(e) => setSelectedDepartment(e.target.value)}
                    className="px-2.5 py-1.5 text-[13.5px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]"
                    style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
                  >
                    {selectedDepartment && !departmentOptions.includes(selectedDepartment) && (
                      <option value={selectedDepartment}>{selectedDepartment}</option>
                    )}
                    {departmentOptions.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  {selectedDepartment && selectedDepartment !== template?.department && (
                    <p className="mt-2 text-[12px] leading-relaxed" style={{ color: 'var(--color-gold)' }}>
                      {globalSslTemplates?.some((t) => t.department === selectedDepartment && t.mbbsYear === template?.mbbsYear)
                        ? `On save, this moves into the existing "${selectedDepartment}" log template.`
                        : `On save, a new "${selectedDepartment} — Competency Checklists" log template will be created for it.`}
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">
                <div>
                  <label
                    className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]"
                    style={{ color: 'var(--color-char-soft)' }}
                  >
                    Competency reference
                  </label>
                  <input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-[13.5px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]"
                    style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
                    placeholder="GMER 2019, Table 11"
                  />
                </div>
                <div>
                  <label
                    className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]"
                    style={{ color: 'var(--color-char-soft)' }}
                  >
                    Setting
                  </label>
                  <input
                    value={setting}
                    onChange={(e) => setSetting(e.target.value)}
                    className="w-full px-2.5 py-1.5 text-[13.5px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]"
                    style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
                    placeholder="Skills lab, ward, outpatient station…"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                <div>
                  <label
                    className="font-display block mb-2 text-[11.5px] font-medium uppercase tracking-[0.08em]"
                    style={{ color: 'var(--color-char-soft)' }}
                  >
                    Level of expected performance
                  </label>
                  <div className="flex flex-col gap-1.5">
                    {LEVELS.map((l) => {
                      const active = level === l.key
                      return (
                        <button
                          key={l.key}
                          onClick={() => setLevel(active ? null : l.key)}
                          className="flex items-center gap-2.5 text-left px-2.5 py-2 border rounded-[6px] transition-colors duration-150"
                          style={{
                            borderColor: active ? 'var(--color-gold-line)' : 'var(--color-line)',
                            backgroundColor: active ? 'var(--color-gold-soft)' : 'transparent',
                          }}
                        >
                          <span
                            className="shrink-0 h-6 w-6 rounded-full flex items-center justify-center font-display text-[12px]"
                            style={{
                              backgroundColor: active ? 'var(--color-gold)' : 'transparent',
                              border: `1px solid ${active ? 'var(--color-gold)' : 'var(--color-line)'}`,
                              color: active ? 'var(--color-frost)' : 'var(--color-char-soft)',
                            }}
                          >
                            {l.key}
                          </span>
                          <span className="text-[13px]" style={{ color: 'var(--color-char)' }}>
                            {l.label}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div>
                  <label
                    className="font-display block mb-2 text-[11.5px] font-medium uppercase tracking-[0.08em]"
                    style={{ color: 'var(--color-char-soft)' }}
                  >
                    Domains assessed
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {DOMAINS.map((d) => {
                      const active = domains.includes(d)
                      return (
                        <button
                          key={d}
                          onClick={() => setDomains((prev) => (active ? prev.filter((x) => x !== d) : [...prev, d]))}
                          className="px-3 py-1.5 text-[12.5px] font-medium border rounded-full transition-colors duration-150"
                          style={{
                            borderColor: active ? 'var(--color-ink)' : 'var(--color-line)',
                            backgroundColor: active ? 'var(--color-ink)' : 'transparent',
                            color: active ? 'var(--color-frost)' : 'var(--color-char-soft)',
                          }}
                        >
                          {d}
                        </button>
                      )
                    })}
                  </div>
                  <p className="mt-3 text-[12px] leading-relaxed" style={{ color: 'var(--color-char-soft)' }}>
                    Informational only for now — doesn't yet drive suggested rating dimensions.
                  </p>
                </div>
              </div>
            </div>

            <StepHeader
              step="02"
              title="Observable steps"
              hint={`${sections.reduce((n, s) => n + s.questions.length, 0)} question${sections.reduce((n, s) => n + s.questions.length, 0) === 1 ? '' : 's'} across ${sections.length} section${sections.length === 1 ? '' : 's'}`}
            />

            <div className="space-y-4">
              {sections.map((section, si) => (
                <SectionBox
                  key={section.id}
                  section={section}
                  letter={SECTION_LETTERS[si] ?? String(si + 1)}
                  lastAddedQuestionId={lastAddedFieldId}
                  onRename={(name) => renameSection(section.id, name)}
                  onRemove={() => removeSection(section.id)}
                  onAddQuestion={() => addQuestion(section.id)}
                  onQuestionChange={(qid, patch) => updateQuestion(section.id, qid, patch)}
                  onQuestionRemove={(qid) => removeQuestion(section.id, qid)}
                  onQuestionMove={(qi, dir) => moveQuestion(section.id, qi, dir)}
                  remarksMode={sectionRemarksMode[section.id] ?? 'per'}
                  onSetRemarksMode={(mode) => setSectionRemarksMode(section.id, mode)}
                />
              ))}
            </div>

            <button
              onClick={addSection}
              className="mt-4 w-full rounded-[10px] border border-dashed py-3 text-[13px] font-medium transition-colors duration-150 hover:bg-black/[0.02]"
              style={{ borderColor: BORDER, color: 'var(--color-char-soft)' }}
            >
              + Add section
            </button>

            <div className="mt-9">
              <StepHeader
                step="03"
                title="Global Rating"
                hint={`${ratingFields.length} rating dimension${ratingFields.length === 1 ? '' : 's'}`}
              />
            </div>

            <div className="space-y-3">
              {ratingFields.map((field, i) => (
                <FieldCard
                  key={field.id}
                  field={field}
                  index={i}
                  total={ratingFields.length}
                  autoFocus={field.id === lastAddedFieldId}
                  onChange={(patch) => ratingOps.update(field.id, patch)}
                  onRemove={() => ratingOps.remove(field.id)}
                  onMove={(dir) => ratingOps.move(i, dir)}
                />
              ))}
            </div>

            <button
              onClick={ratingOps.add}
              className="mt-3 w-full rounded-[10px] border border-dashed py-3 text-[13px] font-medium transition-colors duration-150 hover:bg-black/[0.02]"
              style={{ borderColor: BORDER, color: 'var(--color-char-soft)' }}
            >
              + Add rating dimension
            </button>

            <div className="mt-9">
              <StepHeader step="04" title="Feedback & Sign-off" hint="Faculty feedback is on by default; toggle the rest as needed." />
            </div>

            <div
              className="rounded-[10px] border divide-y divide-[var(--color-line)]"
              style={{ borderColor: BORDER, backgroundColor: 'var(--color-paper)' }}
            >
              {KNOWN_CLOSING_FIELDS.map((known) => (
                <FieldToggleRow
                  key={known.id}
                  label={known.label}
                  hint={known.hint}
                  checked={feedbackFields.some((f) => f.id === known.id)}
                  onChange={(on) => toggleKnownField(known, on)}
                />
              ))}
            </div>

            {customFeedbackFields.length > 0 && (
              <div className="space-y-3 mt-3">
                {customFeedbackFields.map((field) => {
                  const i = feedbackFields.findIndex((f) => f.id === field.id)
                  return (
                    <FieldCard
                      key={field.id}
                      field={field}
                      index={i}
                      total={feedbackFields.length}
                      autoFocus={field.id === lastAddedFieldId}
                      onChange={(patch) => feedbackOps.update(field.id, patch)}
                      onRemove={() => feedbackOps.remove(field.id)}
                      onMove={(dir) => feedbackOps.move(i, dir)}
                    />
                  )
                })}
              </div>
            )}

            <button
              onClick={feedbackOps.add}
              className="mt-3 w-full rounded-[10px] border border-dashed py-3 text-[13px] font-medium transition-colors duration-150 hover:bg-black/[0.02]"
              style={{ borderColor: BORDER, color: 'var(--color-char-soft)' }}
            >
              + Add another field
            </button>

            <div className="mt-8 pt-5 border-t" style={{ borderColor: BORDER }}>
              {institutionId ? (
                confirmDelete ? (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[12.5px]" style={{ color: 'var(--color-clay)' }}>
                      Reset <span className="font-medium">"{node!.title}"</span> back to the global version for{' '}
                      {institution?.name ?? 'this institution'}? Their edits to this checklist will be lost.
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      <GhostButton tone="danger" onClick={handleRemoveOverride}>
                        {saving ? 'Removing…' : 'Remove'}
                      </GhostButton>
                      <GhostButton onClick={() => setConfirmDelete(false)}>Cancel</GhostButton>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmDelete(true)}
                    className="text-[12.5px] font-medium"
                    style={{ color: 'var(--color-clay)' }}
                  >
                    Remove institution-specific version
                  </button>
                )
              ) : confirmDelete ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[12.5px]" style={{ color: 'var(--color-clay)' }}>
                    Remove <span className="font-medium">"{node!.title}"</span> and its checklist? This can't be undone.
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <GhostButton tone="danger" onClick={handleDelete}>
                      {saving ? 'Removing…' : 'Remove'}
                    </GhostButton>
                    <GhostButton onClick={() => setConfirmDelete(false)}>Cancel</GhostButton>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="text-[12.5px] font-medium"
                  style={{ color: 'var(--color-clay)' }}
                >
                  Remove this competency
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {previewOpen && (
        <div
          className={`fixed inset-0 z-50 flex items-start justify-center overflow-y-auto ${previewExpanded ? '' : 'p-4 py-10'}`}
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 55%, transparent)' }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !previewExpanded) setPreviewOpen(false)
          }}
        >
          <div
            className={`w-full fade-up ${previewExpanded ? '' : `${isDops ? 'max-w-[1180px]' : 'max-w-[960px]'} rounded-[10px] overflow-hidden`}`}
            style={{ maxHeight: previewExpanded ? '100vh' : '90vh', minHeight: previewExpanded ? '100vh' : undefined }}
          >
            <div
              className="flex items-center justify-between gap-3 px-5 py-3 shrink-0"
              style={{ backgroundColor: 'var(--color-paper)', borderBottom: '1px solid var(--color-gold-line)' }}
            >
              <span
                className="text-[10.5px] font-semibold uppercase tracking-[0.1em] truncate"
                style={{ color: 'var(--color-char-soft)', fontFamily: 'var(--font-mono)' }}
              >
                {isDops ? (
                  <>
                    Live preview <span style={{ color: 'var(--color-gold)' }}>·</span> exactly what faculty will see and fill in
                  </>
                ) : (
                  'Preview · what faculty will fill in'
                )}
              </span>
              <div className="flex items-center gap-3 shrink-0">
                {isDops && (
                  <button
                    onClick={() => setPreviewExpanded((v) => !v)}
                    title={previewExpanded ? 'Exit full screen' : 'Full screen'}
                    className="flex items-center justify-center transition-colors"
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 999,
                      border: '1px solid var(--color-line)',
                      backgroundColor: 'var(--color-paper-raised)',
                      color: 'var(--color-char-soft)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--color-gold-line)'
                      e.currentTarget.style.color = 'var(--color-gold)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--color-line)'
                      e.currentTarget.style.color = 'var(--color-char-soft)'
                    }}
                  >
                    <Icon name={previewExpanded ? 'compress' : 'expand'} style={{ width: 15, height: 15 }} />
                  </button>
                )}
                <button
                  onClick={() => setPreviewOpen(false)}
                  title="Close (Esc)"
                  className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] transition-colors"
                  style={{
                    color: 'var(--color-char-soft)',
                    fontFamily: 'var(--font-mono)',
                    border: '1px solid var(--color-line)',
                    borderRadius: 999,
                    padding: '6px 14px 6px 12px',
                    backgroundColor: 'var(--color-paper-raised)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-gold-line)'
                    e.currentTarget.style.color = 'var(--color-gold)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--color-line)'
                    e.currentTarget.style.color = 'var(--color-char-soft)'
                  }}
                >
                  <Icon name="close" style={{ width: 11, height: 11 }} />
                  Esc
                </button>
              </div>
            </div>
            <div
              style={{
                maxHeight: previewExpanded ? 'calc(100vh - 54px)' : 'calc(90vh - 54px)',
                overflowY: 'auto',
                backgroundColor: isDops ? undefined : 'var(--color-paper-raised)',
              }}
            >
              {isDops ? (
                <DopsChecklistPreview
                  title={title || 'Untitled competency'}
                  department={template?.department}
                  code={code}
                  setting={setting}
                  level={level}
                  domains={domains}
                  fields={previewFields}
                />
              ) : (
                <div className="p-6 space-y-4">
                  {previewFields.length === 0 ? (
                    <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
                      No fields yet.
                    </p>
                  ) : (
                    previewFields.map((f) => <SimplePreviewField key={f.id} field={f} />)
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </ShellComponent>
  )
}

function SectionBox({
  section,
  letter,
  lastAddedQuestionId,
  onRename,
  onRemove,
  onAddQuestion,
  onQuestionChange,
  onQuestionRemove,
  onQuestionMove,
  remarksMode,
  onSetRemarksMode,
}: {
  section: EditorSection
  letter: string
  lastAddedQuestionId: string | null
  onRename: (name: string) => void
  onRemove: () => void
  onAddQuestion: () => void
  onQuestionChange: (questionId: string, patch: Partial<EditorQuestion>) => void
  onQuestionRemove: (questionId: string) => void
  onQuestionMove: (index: number, dir: -1 | 1) => void
  remarksMode: 'all' | 'per' | 'none'
  onSetRemarksMode: (mode: 'all' | 'per' | 'none') => void
}) {
  return (
    <div className="fade-up rounded-[10px] border overflow-hidden" style={{ backgroundColor: 'var(--color-paper)', borderColor: BORDER }}>
      <div className="flex items-center gap-3 px-5 py-3 border-b" style={{ borderColor: BORDER }}>
        <span
          className="shrink-0 h-7 w-7 flex items-center justify-center rounded-full font-display text-[13px]"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-gold) 18%, var(--color-paper) 82%)', color: 'var(--color-gold)' }}
        >
          {letter}
        </span>
        <input
          value={section.name}
          onChange={(e) => onRename(e.target.value)}
          placeholder="Section name"
          className="flex-1 min-w-0 font-display text-[16px] outline-none bg-transparent"
          style={{ color: 'var(--color-char)' }}
        />
        <span className="text-[11px] shrink-0" style={{ color: 'var(--color-char-soft)' }}>
          {section.questions.length} question{section.questions.length === 1 ? '' : 's'}
        </span>
        {section.questions.length > 0 && (
          <div className="flex items-center gap-1.5 shrink-0">
            <span
              className="text-[10px] font-semibold uppercase tracking-[0.06em] shrink-0"
              style={{ color: 'var(--color-char-soft)' }}
            >
              Remarks
            </span>
            <RemarksModeToggle mode={remarksMode} onSelect={onSetRemarksMode} />
          </div>
        )}
        <button
          onClick={onRemove}
          title="Remove section"
          className="shrink-0 h-7 w-7 flex items-center justify-center rounded-[3px] hover:bg-black/[0.06]"
          style={{ color: 'var(--color-clay)' }}
        >
          <Icon name="trash" className="h-3.5 w-3.5" />
        </button>
      </div>

      {section.questions.length > 0 && (
        <div className="divide-y divide-[color-mix(in_srgb,var(--color-char-soft)_28%,var(--color-line)_72%)]">
          {section.questions.map((q, qi) => (
            <QuestionRow
              key={q.id}
              question={q}
              index={qi}
              total={section.questions.length}
              autoFocus={q.id === lastAddedQuestionId}
              remarksLocked={remarksMode === 'none'}
              onChange={(patch) => onQuestionChange(q.id, patch)}
              onRemove={() => onQuestionRemove(q.id)}
              onMove={(dir) => onQuestionMove(qi, dir)}
            />
          ))}
        </div>
      )}

      <div className="px-5 py-3">
        <button onClick={onAddQuestion} className="text-[12.5px] font-medium" style={{ color: 'var(--color-gold)' }}>
          + Add question
        </button>
      </div>
    </div>
  )
}

function QuestionRow({
  question,
  index,
  total,
  autoFocus,
  remarksLocked,
  onChange,
  onRemove,
  onMove,
}: {
  question: EditorQuestion
  index: number
  total: number
  autoFocus?: boolean
  remarksLocked: boolean
  onChange: (patch: Partial<EditorQuestion>) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) {
      containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      textRef.current?.focus()
    }
    // Only on mount of a freshly-added question — not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={containerRef}
      className="px-5 py-3.5 transition-shadow duration-500"
      style={{ boxShadow: autoFocus ? 'inset 0 0 0 2px var(--color-gold-line)' : undefined }}
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col gap-0.5 pt-1 shrink-0">
          <button
            onClick={() => onMove(-1)}
            disabled={index === 0}
            title="Move up"
            className="h-4 w-4 flex items-center justify-center rounded-[3px] hover:bg-black/[0.06] disabled:opacity-20"
            style={{ color: 'var(--color-char-soft)' }}
          >
            <Icon name="chevron" className="h-2.5 w-2.5 -rotate-90" />
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            title="Move down"
            className="h-4 w-4 flex items-center justify-center rounded-[3px] hover:bg-black/[0.06] disabled:opacity-20"
            style={{ color: 'var(--color-char-soft)' }}
          >
            <Icon name="chevron" className="h-2.5 w-2.5 rotate-90" />
          </button>
        </div>

        <span className="font-mono text-[12px] pt-0.5 shrink-0" style={{ color: 'var(--color-char-soft)' }}>
          {index + 1}.
        </span>

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={textRef}
              value={question.text}
              onChange={(e) => onChange({ text: e.target.value })}
              placeholder="Question text"
              className="flex-1 min-w-[140px] text-[13.5px] outline-none bg-transparent border-b pb-1 transition-colors duration-150 focus:border-[var(--color-gold)]"
              style={{ color: 'var(--color-char)', borderColor: 'transparent' }}
            />
            <select
              value={question.type}
              onChange={(e) => {
                const type = e.target.value as FormFieldType
                onChange({
                  type,
                  options: type === 'dropdown' || type === 'checkbox' ? (question.options.length ? question.options : ['']) : question.options,
                  maxRating: type === 'rating' ? (question.maxRating ?? 5) : question.maxRating,
                })
              }}
              className="px-2 py-1 text-[12px] border outline-none shrink-0"
              style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
            >
              {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {(question.type === 'dropdown' || question.type === 'checkbox') && (
            <OptionsEditor options={question.options} onChange={(options) => onChange({ options })} />
          )}

          {question.type === 'rating' && (
            <div className="flex items-center gap-2">
              <label className="text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
                Max rating
              </label>
              <input
                type="number"
                min={2}
                max={10}
                value={question.maxRating ?? 5}
                onChange={(e) => onChange({ maxRating: Number(e.target.value) })}
                className="w-16 px-2 py-1 text-[13px] border outline-none"
                style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              />
            </div>
          )}
        </div>

        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <button
            onClick={() => onChange({ hasRemark: !question.hasRemark })}
            disabled={remarksLocked}
            title={remarksLocked ? 'Remarks are off for this whole section' : 'Add a remarks field under this question'}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10.5px] font-medium border whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
            style={
              question.hasRemark
                ? { borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)' }
                : { borderColor: 'var(--color-line)', color: 'var(--color-char-soft)' }
            }
          >
            {question.hasRemark ? '✓ Remarks' : '+ Remarks'}
          </button>
          <button
            onClick={onRemove}
            title="Remove question"
            className="h-6 w-6 flex items-center justify-center rounded-[3px] hover:bg-black/[0.06]"
            style={{ color: 'var(--color-clay)' }}
          >
            <Icon name="trash" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

// A row for one of the three known closing fields (Feedback, Student
// Acknowledgement, Assessor Signature) — a labeled on/off switch instead of
// building the field from scratch via the generic editor every time.
function FieldToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3">
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px]" style={{ color: 'var(--color-char)' }}>
          {label}
        </div>
        <div className="text-[12px] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
          {hint}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        aria-label={label}
        aria-pressed={checked}
        className="relative shrink-0 h-6 w-10 p-0 rounded-full border-0 transition-colors duration-150"
        style={{ backgroundColor: checked ? 'var(--color-gold)' : 'var(--color-line)' }}
      >
        <span
          className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full shadow-sm transition-transform duration-150"
          style={{ backgroundColor: '#fff', transform: checked ? 'translateX(16px)' : 'translateX(0px)' }}
        />
      </button>
    </div>
  )
}

const REMARKS_MODE_OPTIONS: { key: 'all' | 'per' | 'none'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'per', label: 'Per Q' },
  { key: 'none', label: 'None' },
]

// One segmented pill instead of two separate buttons — "All" bulk-turns
// remarks on for every question (still individually editable after),
// "Per question" leaves each question's own toggle in charge, "None"
// locks remarks off across the whole section.
function RemarksModeToggle({
  mode,
  onSelect,
}: {
  mode: 'all' | 'per' | 'none'
  onSelect: (mode: 'all' | 'per' | 'none') => void
}) {
  return (
    <div className="inline-flex border rounded-[6px] overflow-hidden shrink-0" style={{ borderColor: 'var(--color-line)' }}>
      {REMARKS_MODE_OPTIONS.map((o, i) => {
        const active = mode === o.key
        return (
          <button
            key={o.key}
            onClick={() => onSelect(o.key)}
            title={
              o.key === 'all'
                ? 'Turn remarks on for every question in this section'
                : o.key === 'none'
                  ? 'Turn remarks off for every question in this section'
                  : 'Each question controls its own remark'
            }
            className="px-2.5 py-1 text-[10.5px] font-medium transition-colors duration-150 whitespace-nowrap"
            style={{
              backgroundColor: active ? (o.key === 'none' ? 'var(--color-clay)' : 'var(--color-ink)') : 'transparent',
              color: active ? 'var(--color-frost)' : 'var(--color-char-soft)',
              borderLeft: i > 0 ? '1px solid var(--color-line)' : undefined,
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function RequiredToggle({ required, onChange }: { required: boolean; onChange: (required: boolean) => void }) {
  return (
    <div className="inline-flex border rounded-[6px] overflow-hidden shrink-0" style={{ borderColor: 'var(--color-line)' }}>
      {(
        [
          [false, 'Optional'],
          [true, 'Required'],
        ] as const
      ).map(([val, label]) => {
        const active = required === val
        return (
          <button
            key={label}
            type="button"
            onClick={() => onChange(val)}
            className="px-3 py-1.5 text-[12px] font-medium transition-colors duration-150"
            style={{
              backgroundColor: active ? 'var(--color-ink)' : 'transparent',
              color: active ? 'var(--color-frost)' : 'var(--color-char-soft)',
              borderLeft: val === true ? '1px solid var(--color-line)' : undefined,
            }}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

function FieldCard({
  field,
  index,
  total,
  autoFocus,
  onChange,
  onRemove,
  onMove,
}: {
  field: FormField
  index: number
  total: number
  autoFocus?: boolean
  onChange: (patch: Partial<FormField>) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) {
      containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      labelRef.current?.focus()
    }
    // Only on mount of a freshly-added field — not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={containerRef}
      className="fade-up rounded-[10px] border p-4 transition-shadow duration-500"
      style={{
        borderColor: autoFocus ? 'var(--color-gold-line)' : BORDER,
        backgroundColor: 'var(--color-paper)',
        boxShadow: autoFocus ? '0 0 0 3px var(--color-gold-soft)' : undefined,
      }}
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col gap-1 pt-1 shrink-0">
          <button
            onClick={() => onMove(-1)}
            disabled={index === 0}
            title="Move up"
            className="h-5 w-5 flex items-center justify-center rounded-[3px] hover:bg-black/[0.06] disabled:opacity-25"
            style={{ color: 'var(--color-char-soft)' }}
          >
            <Icon name="chevron" className="h-3 w-3 -rotate-90" />
          </button>
          <button
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            title="Move down"
            className="h-5 w-5 flex items-center justify-center rounded-[3px] hover:bg-black/[0.06] disabled:opacity-25"
            style={{ color: 'var(--color-char-soft)' }}
          >
            <Icon name="chevron" className="h-3 w-3 rotate-90" />
          </button>
        </div>

        <div className="flex-1 min-w-0 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={labelRef}
              placeholder="Field label"
              value={field.label}
              onChange={(e) => onChange({ label: e.target.value })}
              className="flex-1 min-w-[160px] px-2.5 py-1.5 text-[14px] font-display border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]"
              style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
            />
            <select
              value={field.type}
              onChange={(e) => {
                const type = e.target.value as FormFieldType
                onChange({
                  type,
                  options: type === 'dropdown' || type === 'checkbox' ? (field.options ?? ['']) : null,
                  maxRating: type === 'rating' ? (field.maxRating ?? 5) : null,
                })
              }}
              className="px-2.5 py-1.5 text-[12.5px] border outline-none"
              style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
            >
              {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <RequiredToggle required={field.required} onChange={(required) => onChange({ required })} />
          </div>

          {(field.type === 'dropdown' || field.type === 'checkbox') && (
            <OptionsEditor options={field.options ?? []} onChange={(options) => onChange({ options })} />
          )}

          {field.type === 'rating' && (
            <div className="flex items-center gap-2">
              <label className="text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
                Max rating
              </label>
              <input
                type="number"
                min={2}
                max={10}
                value={field.maxRating ?? 5}
                onChange={(e) => onChange({ maxRating: Number(e.target.value) })}
                className="w-16 px-2 py-1 text-[13px] border outline-none"
                style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              />
            </div>
          )}
        </div>

        <button
          onClick={onRemove}
          title="Remove field"
          className="h-7 w-7 shrink-0 flex items-center justify-center rounded-[3px] hover:bg-black/[0.06]"
          style={{ color: 'var(--color-clay)' }}
        >
          <Icon name="trash" className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

function SimplePreviewField({ field }: { field: FormField }) {
  return (
    <div>
      <label
        className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]"
        style={{ color: 'var(--color-char-soft)' }}
      >
        {field.label || 'Untitled field'}
        {field.required && <span style={{ color: 'var(--color-clay)' }}> *</span>}
      </label>
      {field.type === 'text' && (
        <input disabled placeholder="Faculty types here" className="w-full px-3 py-2 text-[13.5px] border bg-transparent" style={{ borderColor: 'var(--color-line)' }} />
      )}
      {field.type === 'textarea' && (
        <textarea disabled rows={3} className="w-full px-3 py-2 text-[13.5px] border bg-transparent resize-none" style={{ borderColor: 'var(--color-line)' }} />
      )}
      {field.type === 'number' && <input disabled type="number" className="w-full px-3 py-2 text-[13.5px] border bg-transparent" style={{ borderColor: 'var(--color-line)' }} />}
      {field.type === 'date' && <input disabled type="date" className="w-full px-3 py-2 text-[13.5px] border bg-transparent" style={{ borderColor: 'var(--color-line)' }} />}
      {field.type === 'dropdown' && (
        <select disabled className="w-full px-3 py-2 text-[13.5px] border bg-transparent" style={{ borderColor: 'var(--color-line)' }}>
          {(field.options ?? []).map((o, i) => (
            <option key={i}>{o}</option>
          ))}
        </select>
      )}
      {field.type === 'checkbox' && (
        <div className="flex flex-wrap gap-3">
          {(field.options ?? []).map((o, i) => (
            <label key={i} className="flex items-center gap-1.5 text-[13px]">
              <input type="checkbox" disabled /> {o}
            </label>
          ))}
        </div>
      )}
      {field.type === 'rating' && (
        <div className="flex gap-1.5">
          {Array.from({ length: field.maxRating ?? 5 }).map((_, i) => (
            <span
              key={i}
              className="h-7 w-7 flex items-center justify-center rounded-full border text-[12px]"
              style={{ borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)' }}
            >
              {i + 1}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
