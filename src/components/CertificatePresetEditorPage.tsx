import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { GhostButton, PrimaryButton, Skeleton } from '../roles/primary-admin/shell/ui'
import { Icon } from '../roles/primary-admin/shell/Icon'
import { watchDepartment } from '../lib/firestore/departments'
import { watchInstitutions } from '../lib/firestore/institutions'
import { watchGlobalTemplates, watchInstitutionTemplates, watchTreeNodes, watchInstitutionCompetencyOverrides } from '../lib/firestore/logTemplates'
import {
  watchAllCertificateSkillPresets,
  getOrCreateCertificateSkillPreset,
  updateCertificateSkillPreset,
  deleteCertificateSkillPreset,
} from '../lib/firestore/certificates'
import type { CertificateSkillPreset, Department, Institution, LogTemplate, TreeNode } from '../types'

const BORDER = 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)'
const ROW_LINE = 'color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)'
type ShellProps = { eyebrow?: string; title: string; actions?: ReactNode; children: ReactNode }

function hasSkills(p: CertificateSkillPreset | undefined): p is CertificateSkillPreset {
  return !!p && p.requiredSkills.length > 0
}

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

function Checkbox({ on, partial }: { on: boolean; partial?: boolean }) {
  return (
    <span
      className="h-[18px] w-[18px] shrink-0 border-[1.6px] flex items-center justify-center transition-colors"
      style={{ borderColor: on || partial ? 'var(--color-gold)' : 'var(--color-char-soft)', backgroundColor: on ? 'var(--color-gold)' : 'transparent' }}
    >
      {on ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--color-paper-raised)" strokeWidth="3" strokeLinecap="square">
          <path d="m5 12 5 5 9-10" />
        </svg>
      ) : partial ? (
        <span className="h-[2px] w-2" style={{ backgroundColor: 'var(--color-gold)' }} />
      ) : null}
    </span>
  )
}

// Full-page skill-preset editor (replaces the old overlay, which was too
// cramped). `?college=<id>` opens a college-specific preset directly.
// - Global preset: lists the global SSL logs for this department + year.
// - College preset: lists ONLY that college's own SSL logs for it, minus the
//   skills the college switched off (institutionCompetencyOverrides).
// A college's own department only ever has that college's preset.
// Shared by Primary Admin and Skill Lab Director — same Shell-parametrized
// pattern as CertificateRequestReviewPage. `backTo` is the presets list.
export function CertificatePresetEditorPage({ Shell, backTo }: { Shell: ComponentType<ShellProps>; backTo: string }) {
  const { departmentId = '' } = useParams<{ departmentId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const { appUser } = useAuth()

  const [department, setDepartment] = useState<Department | null | undefined>(undefined)
  useEffect(() => watchDepartment(departmentId, setDepartment), [departmentId])
  const [institutions, setInstitutions] = useState<Institution[]>([])
  useEffect(() => watchInstitutions(setInstitutions), [])
  const [presets, setPresets] = useState<CertificateSkillPreset[] | null>(null)
  useEffect(() => watchAllCertificateSkillPresets(setPresets), [])

  const isCatalog = department?.institutionId === ''
  const collegeParam = searchParams.get('college') ?? ''
  // Which preset this page edits: '' = global; a college id otherwise.
  const targetInstitutionId = !department ? '' : isCatalog ? collegeParam : department.institutionId
  function chooseTarget(collegeId: string) {
    setSearchParams(collegeId ? { college: collegeId } : {}, { replace: true })
  }

  const findPreset = (instId: string) =>
    (presets ?? []).find((p) => department && p.institutionId === instId && p.department === department.name && p.mbbsYear === department.mbbsYear)
  const targetPreset = findPreset(targetInstitutionId)
  const globalPreset = findPreset('')
  const isCollegeView = targetInstitutionId !== ''
  const collegeName = (id: string) => institutions.find((i) => i.id === id)?.name ?? 'College'

  // --- Skills ---------------------------------------------------------------
  // Same logs a student of that college sees on Activities: the global SSL
  // logs for this department + year, plus (college view) the college's own.
  const [globalTemplates, setGlobalTemplates] = useState<LogTemplate[] | null>(null)
  const [collegeTemplates, setCollegeTemplates] = useState<LogTemplate[] | null>(null)
  useEffect(() => {
    if (!department) return
    setGlobalTemplates(null)
    return watchGlobalTemplates({ department: department.name, mbbsYear: department.mbbsYear }, (all) =>
      setGlobalTemplates(all.filter((t) => t.logType === 'SSL')),
    )
  }, [department])
  useEffect(() => {
    if (!department || !isCollegeView) {
      setCollegeTemplates([])
      return
    }
    setCollegeTemplates(null)
    return watchInstitutionTemplates(targetInstitutionId, { department: department.name, mbbsYear: department.mbbsYear }, (all) =>
      setCollegeTemplates(all.filter((t) => t.logType === 'SSL')),
    )
  }, [department, isCollegeView, targetInstitutionId])
  const templates = useMemo(
    () =>
      globalTemplates === null || collegeTemplates === null
        ? null
        : [...globalTemplates.map((t) => ({ t, college: false })), ...collegeTemplates.map((t) => ({ t, college: true }))],
    [globalTemplates, collegeTemplates],
  )

  const [switchedOff, setSwitchedOff] = useState<Set<string>>(new Set())
  useEffect(() => {
    if (!isCollegeView) {
      setSwitchedOff(new Set())
      return
    }
    return watchInstitutionCompetencyOverrides(targetInstitutionId, (o) => setSwitchedOff(new Set(o.filter((x) => !x.enabled).map((x) => x.nodeId))))
  }, [isCollegeView, targetInstitutionId])

  const [nodesByTemplate, setNodesByTemplate] = useState<Record<string, TreeNode[]>>({})
  const templateKey = (templates ?? []).map(({ t }) => t.id).join(',')
  useEffect(() => {
    const unsubs = (templates ?? []).map(({ t }) => watchTreeNodes(t.id, (n) => setNodesByTemplate((prev) => ({ ...prev, [t.id]: n }))))
    return () => unsubs.forEach((u) => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateKey])

  // One group per log; a leaf counts only if it and every ancestor is on.
  const { groups, hiddenCount } = useMemo(() => {
    let hidden = 0
    const out = (templates ?? []).map(({ t: template, college }) => {
      const nodes = nodesByTemplate[template.id] ?? []
      const byId = new Map(nodes.map((n) => [n.id, n]))
      const parentIds = new Set(nodes.map((n) => n.parentId).filter((id): id is string => id !== null))
      const isOn = (n: TreeNode): boolean => !switchedOff.has(n.id) && (!n.parentId || !byId.has(n.parentId) || isOn(byId.get(n.parentId)!))
      const leaves = nodes
        .filter((n) => !parentIds.has(n.id))
        .filter((n) => {
          const on = isOn(n)
          if (!on) hidden++
          return on
        })
        .map((n) => ({ node: n, templateId: template.id, templateTitle: template.title, section: n.parentId ? byId.get(n.parentId)?.title ?? '' : '' }))
        .sort((a, b) => a.section.localeCompare(b.section) || a.node.order - b.node.order)
      return { template, college, leaves }
    })
    return { groups: out.filter((g) => g.leaves.length > 0), hiddenCount: hidden }
  }, [templates, nodesByTemplate, switchedOff])
  const leaves = useMemo(() => groups.flatMap((g) => g.leaves), [groups])
  const leafById = useMemo(() => new Map(leaves.map((l) => [l.node.id, l])), [leaves])

  // --- Draft selection (re-seeded when the target preset changes) -----------
  const [draft, setDraft] = useState<string[] | null>(null)
  useEffect(() => setDraft(null), [targetInstitutionId])
  const startsFromGlobal = isCollegeView && !hasSkills(targetPreset) && hasSkills(globalPreset)
  const seed = (hasSkills(targetPreset) ? targetPreset : startsFromGlobal ? globalPreset : targetPreset)?.requiredSkills.map((s) => s.nodeId) ?? []
  const selected = draft ?? seed
  const selectedLeaves = selected.map((id) => leafById.get(id)).filter((l): l is NonNullable<typeof l> => !!l)
  const dirty = (draft !== null && (draft.length !== seed.length || draft.some((id) => !seed.includes(id)))) || (startsFromGlobal && selectedLeaves.length > 0)

  function toggle(id: string) {
    const cur = draft ?? seed
    setDraft(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
  }
  function setGroup(ids: string[], on: boolean) {
    const cur = draft ?? seed
    setDraft(on ? [...new Set([...cur, ...ids])] : cur.filter((x) => !ids.includes(x)))
  }

  const [query, setQuery] = useState('')
  const [onlySelected, setOnlySelected] = useState(false)
  const q = query.trim().toLowerCase()
  const shownGroups = groups
    .map((g) => ({
      ...g,
      leaves: g.leaves.filter((l) => (!q || l.node.title.toLowerCase().includes(q) || l.section.toLowerCase().includes(q)) && (!onlySelected || selected.includes(l.node.id))),
    }))
    .filter((g) => g.leaves.length > 0)

  // --- Save / revert --------------------------------------------------------
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState('')
  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(id)
  }, [toast])

  async function save() {
    if (!appUser || !department) return
    setSaving(true)
    try {
      const requiredSkills = selectedLeaves.map((l) => ({ nodeId: l.node.id, nodeTitle: l.node.title, templateId: l.templateId, templateTitle: l.templateTitle }))
      const id = targetPreset?.id ?? (await getOrCreateCertificateSkillPreset(targetInstitutionId, department.name, department.mbbsYear, appUser.uid))
      await updateCertificateSkillPreset(id, requiredSkills)
      setDraft(null)
      setToast(`Preset saved${isCollegeView ? ` for ${collegeName(targetInstitutionId)}` : ''} · ${requiredSkills.length} skill${requiredSkills.length === 1 ? '' : 's'}`)
    } finally {
      setSaving(false)
    }
  }
  async function useGlobalInstead() {
    if (!targetPreset) return
    setSaving(true)
    try {
      await deleteCertificateSkillPreset(targetPreset.id)
      setDraft(null)
      setToast(`${collegeName(targetInstitutionId)} now uses the global preset`)
    } finally {
      setSaving(false)
    }
  }

  const loading = department === undefined || presets === null
  const scopeLabel = !isCollegeView ? 'Global preset — every college without its own' : `${collegeName(targetInstitutionId)} only`

  return (
    <Shell
      eyebrow="Certificates · Skill presets"
      title={department ? `${department.name} preset` : 'Skill preset'}
      actions={
        department ? (
          <div className="flex items-center gap-2">
            <GhostButton onClick={() => navigate(backTo)}>Back</GhostButton>
            <PrimaryButton onClick={save} disabled={saving || leaves.length === 0 || !dirty}>
              {saving ? 'Saving…' : 'Save preset'}
            </PrimaryButton>
          </div>
        ) : undefined
      }
    >
      <div className="max-w-[1180px] mx-auto">
        <button
          onClick={() => navigate(backTo)}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium mb-5 hover:opacity-70 transition-opacity"
          style={{ color: 'var(--color-char-soft)' }}
        >
          <Icon name="chevron" className="h-3 w-3 rotate-180" />
          All skill presets
        </button>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-64" />
          </div>
        ) : !department ? (
          <div className="rounded-[10px] border p-5" style={{ borderColor: BORDER, backgroundColor: 'var(--color-paper)' }}>
            <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
              This department doesn't exist any more.
            </p>
          </div>
        ) : (
          <>
            {/* Page header */}
            <div className="flex justify-between items-end gap-6 flex-wrap pb-6 mb-8 border-b" style={{ borderColor: BORDER }}>
              <div className="min-w-0">
                <div className="font-mono text-[11px] tracking-[0.16em] uppercase" style={{ color: 'var(--color-gold)' }}>
                  Skill preset · Year {department.mbbsYear}
                  {!isCatalog ? ` · ${collegeName(department.institutionId)}` : ''}
                </div>
                <h2 className="font-display text-[34px] sm:text-[40px] leading-[1.05] mt-1.5 break-words" style={{ color: 'var(--color-char)' }}>
                  {department.name}
                </h2>
                <p className="text-[13.5px] mt-2 max-w-[620px] leading-relaxed" style={{ color: 'var(--color-char-soft)' }}>
                  Pick the skills a student must have approved by faculty — at least one approved activity each — before they can
                  request this department’s certificate.
                </p>
              </div>
              <span
                className="font-mono text-[10.5px] tracking-[0.08em] uppercase px-2.5 py-1 rounded-[4px]"
                style={
                  isCollegeView
                    ? { color: 'var(--color-gold)', backgroundColor: 'color-mix(in srgb, var(--color-gold) 14%, transparent)' }
                    : { color: 'var(--color-char-soft)', backgroundColor: 'color-mix(in srgb, var(--color-char-soft) 12%, transparent)' }
                }
              >
                Editing: {scopeLabel}
              </span>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-8 items-start">
              <div className="min-w-0">
                {isCatalog && (
                  <>
                    <StepHeader step="01" title="Whose preset" hint="The global one, or a single college’s own." />
                    <ScopePicker
                      institutions={institutions}
                      presets={presets!}
                      department={department}
                      globalPreset={globalPreset}
                      target={targetInstitutionId}
                      onChoose={chooseTarget}
                    />
                  </>
                )}

                <StepHeader
                  step={isCatalog ? '02' : '01'}
                  title="Required skills"
                  hint={
                    isCollegeView
                      ? `Every SSL log ${collegeName(targetInstitutionId)}’s students see — global and the college’s own.`
                      : 'From the global SSL logs for this department.'
                  }
                />

                {isCollegeView && (
                  <StatusLine
                    tone={hasSkills(targetPreset) ? 'teal' : 'gold'}
                    text={
                      hasSkills(targetPreset)
                        ? `${collegeName(targetInstitutionId)} has its own preset — its students use it instead of the global one.`
                        : startsFromGlobal
                          ? `${collegeName(targetInstitutionId)} has no preset of its own yet — the global preset’s skills are pre-ticked below. Add or remove skills (including the college’s own) and save to give it its own.`
                          : `${collegeName(targetInstitutionId)} has no preset of its own yet — tick skills from any log below and save.`
                    }
                  />
                )}

                <div className="flex flex-wrap items-center gap-3 mb-4">
                  <div className="relative w-full sm:w-[280px]">
                    <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: 'var(--color-char-soft)' }} />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="Search skills or sections"
                      className="w-full pl-8 pr-3 py-2 text-[13.5px] border outline-none bg-transparent transition-colors focus:border-[var(--color-gold)]"
                      style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
                    />
                  </div>
                  <label className="inline-flex items-center gap-2 text-[12.5px] cursor-pointer select-none" style={{ color: 'var(--color-char-soft)' }}>
                    <input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} />
                    Only selected
                  </label>
                  <div className="sm:ml-auto flex gap-3">
                    <button onClick={() => setDraft(leaves.map((l) => l.node.id))} disabled={leaves.length === 0} className="text-[12.5px] font-medium disabled:opacity-40" style={{ color: 'var(--color-gold)' }}>
                      Select all
                    </button>
                    <button onClick={() => setDraft([])} disabled={selected.length === 0} className="text-[12.5px] font-medium disabled:opacity-40" style={{ color: 'var(--color-char-soft)' }}>
                      Clear
                    </button>
                  </div>
                </div>

                {templates === null ? (
                  <div className="space-y-3">
                    <Skeleton className="h-40 rounded-[10px]" />
                  </div>
                ) : templates.length === 0 ? (
                  <EmptyBox>
                    {department.name} has no SSL log yet{isCollegeView ? ' — globally or at this college' : ''}. Add its skills on the Competencies or Log
                    Templates page, then come back to pick which ones count.
                  </EmptyBox>
                ) : shownGroups.length === 0 ? (
                  <EmptyBox>{leaves.length === 0 ? 'No skills are switched on in these logs yet.' : 'No skills match.'}</EmptyBox>
                ) : (
                  <div className="space-y-5">
                    {shownGroups.map((g) => {
                      const ids = g.leaves.map((l) => l.node.id)
                      const onCount = ids.filter((id) => selected.includes(id)).length
                      return (
                        <section key={g.template.id} className="fade-up rounded-[10px] border overflow-hidden" style={{ borderColor: BORDER, backgroundColor: 'var(--color-paper)' }}>
                          <button
                            onClick={() => setGroup(ids, onCount !== ids.length)}
                            className="w-full flex items-center gap-3 px-5 py-3.5 border-b text-left transition-colors hover:bg-black/[0.015]"
                            style={{ borderColor: BORDER }}
                            title={onCount === ids.length ? 'Unselect this log' : 'Select every skill in this log'}
                          >
                            <Checkbox on={onCount === ids.length} partial={onCount > 0 && onCount < ids.length} />
                            <span className="font-display text-[17px] min-w-0 truncate" style={{ color: 'var(--color-char)' }}>
                              {g.template.title || 'Untitled log'}
                            </span>
                            <span
                              className="shrink-0 font-mono text-[9.5px] tracking-[0.08em] uppercase px-1.5 py-0.5 rounded-[4px]"
                              style={
                                g.college
                                  ? { color: 'var(--color-gold)', backgroundColor: 'color-mix(in srgb, var(--color-gold) 14%, transparent)' }
                                  : { color: 'var(--color-char-soft)', backgroundColor: 'color-mix(in srgb, var(--color-char-soft) 12%, transparent)' }
                              }
                            >
                              {g.college ? 'College log' : 'Global log'}
                            </span>
                            <span className="ml-auto font-mono text-[11px] tabular-nums" style={{ color: 'var(--color-char-soft)' }}>
                              {onCount}/{ids.length}
                            </span>
                          </button>
                          <div className="grid grid-cols-1 md:grid-cols-2">
                            {g.leaves.map(({ node, section }, i) => {
                              const on = selected.includes(node.id)
                              return (
                                <button
                                  key={node.id}
                                  onClick={() => toggle(node.id)}
                                  className="text-left flex items-start gap-3 px-5 py-3 transition-colors"
                                  style={{
                                    backgroundColor: on ? 'var(--color-gold-soft)' : 'transparent',
                                    borderTop: i > 0 ? `1px solid ${ROW_LINE}` : undefined,
                                  }}
                                >
                                  <span className="mt-0.5">
                                    <Checkbox on={on} />
                                  </span>
                                  <span className="min-w-0">
                                    <span className="block text-[14px] leading-snug" style={{ color: 'var(--color-char)' }}>
                                      {node.title}
                                    </span>
                                    {section && (
                                      <span className="block font-mono text-[10.5px] mt-0.5 truncate" style={{ color: 'var(--color-char-soft)' }}>
                                        {section}
                                      </span>
                                    )}
                                  </span>
                                </button>
                              )
                            })}
                          </div>
                        </section>
                      )
                    })}
                  </div>
                )}

                {isCollegeView && hiddenCount > 0 && (
                  <p className="mt-3 text-[12px]" style={{ color: 'var(--color-char-soft)' }}>
                    {hiddenCount} skill{hiddenCount === 1 ? ' is' : 's are'} switched off for this college and not listed.
                  </p>
                )}
              </div>

              {/* Sticky summary */}
              <aside className="lg:sticky lg:top-0">
                <div className="rounded-[10px] border p-5" style={{ borderColor: BORDER, backgroundColor: 'var(--color-paper)' }}>
                  <div className="font-mono text-[11px] tracking-[0.16em] uppercase" style={{ color: 'var(--color-gold)' }}>
                    Summary
                  </div>
                  <div className="flex items-baseline gap-2 mt-3">
                    <span className="font-display text-[48px] leading-none tabular-nums" style={{ color: 'var(--color-gold)' }}>
                      {selectedLeaves.length}
                    </span>
                    <span className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
                      of {leaves.length} skills required
                    </span>
                  </div>
                  <div className="text-[12.5px] mt-2" style={{ color: 'var(--color-char)' }}>
                    {scopeLabel}
                  </div>
                  {dirty && (
                    <div className="text-[12px] mt-2 flex items-center gap-1.5" style={{ color: 'var(--color-gold)' }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--color-gold)' }} />
                      Unsaved changes
                    </div>
                  )}

                  <div className="h-px my-4" style={{ backgroundColor: ROW_LINE }} />

                  {selectedLeaves.length === 0 ? (
                    <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--color-char-soft)' }}>
                      Nothing selected yet — tick the skills on the left.
                    </p>
                  ) : (
                    <ul className="max-h-[300px] overflow-y-auto -mx-1 px-1 space-y-1">
                      {selectedLeaves.map((l) => (
                        <li key={l.node.id} className="group flex items-start gap-2 text-[12.5px] leading-snug" style={{ color: 'var(--color-char)' }}>
                          <span className="mt-[3px]" style={{ color: 'var(--color-gold)' }}>
                            ◆
                          </span>
                          <span className="flex-1 min-w-0">{l.node.title}</span>
                          <button
                            onClick={() => toggle(l.node.id)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                            style={{ color: 'var(--color-char-soft)' }}
                            title="Remove"
                          >
                            <Icon name="close" className="h-3 w-3" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}

                  <div className="flex flex-col gap-2 mt-5">
                    <PrimaryButton onClick={save} disabled={saving || leaves.length === 0 || !dirty}>
                      {saving ? 'Saving…' : 'Save preset'}
                    </PrimaryButton>
                    {dirty && <GhostButton onClick={() => setDraft(null)}>Discard changes</GhostButton>}
                    {isCatalog && isCollegeView && hasSkills(targetPreset) && (
                      <button onClick={useGlobalInstead} disabled={saving} className="text-[12.5px] mt-1 disabled:opacity-50" style={{ color: 'var(--color-clay)' }}>
                        Remove college preset — use global instead
                      </button>
                    )}
                  </div>
                </div>
              </aside>
            </div>
          </>
        )}
      </div>

      {toast &&
        createPortal(
          <div
            className="fade-up fixed bottom-7 left-1/2 -translate-x-1/2 z-[60] px-5 py-3 text-[13.5px]"
            style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-frost)', borderLeft: '2px solid var(--color-gold)' }}
          >
            {toast}
          </div>,
          document.body,
        )}
    </Shell>
  )
}

function EmptyBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[10px] border border-dashed px-6 py-10 text-center text-[13.5px] leading-relaxed" style={{ borderColor: BORDER, color: 'var(--color-char-soft)' }}>
      {children}
    </div>
  )
}

function StatusLine({ tone, text }: { tone: 'teal' | 'gold'; text: string }) {
  return (
    <div
      className="mb-4 px-3.5 py-2.5 text-[12.5px] leading-relaxed flex items-center gap-2 rounded-[6px]"
      style={{ backgroundColor: tone === 'teal' ? 'var(--color-teal-soft)' : 'var(--color-gold-soft)', color: 'var(--color-char)' }}
    >
      <Icon name={tone === 'teal' ? 'checkCircle' : 'clock'} className="h-3.5 w-3.5 shrink-0" style={{ color: tone === 'teal' ? 'var(--color-teal)' : 'var(--color-gold)' }} />
      {text}
    </div>
  )
}

// Step 01 for a catalog department: Global card + a searchable list of
// colleges, each showing whether it has its own preset.
function ScopePicker({
  institutions,
  presets,
  department,
  globalPreset,
  target,
  onChoose,
}: {
  institutions: Institution[]
  presets: CertificateSkillPreset[]
  department: Department
  globalPreset: CertificateSkillPreset | undefined
  target: string
  onChoose: (collegeId: string) => void
}) {
  const [mode, setMode] = useState<'global' | 'college'>(target ? 'college' : 'global')
  useEffect(() => setMode(target ? 'college' : 'global'), [target])
  const [search, setSearch] = useState('')

  const own = (id: string) => presets.find((p) => p.institutionId === id && p.department === department.name && p.mbbsYear === department.mbbsYear && hasSkills(p))
  const colleges = institutions
    .filter((c) => !search.trim() || c.name.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => Number(!!own(b.id)) - Number(!!own(a.id)) || a.name.localeCompare(b.name))
  const withOwn = institutions.filter((c) => own(c.id)).length

  return (
    <div className="rounded-[10px] border p-5 mb-9" style={{ borderColor: BORDER, backgroundColor: 'var(--color-paper)' }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ModeCard
          selected={mode === 'global'}
          onClick={() => {
            setMode('global')
            onChoose('')
          }}
          title="Global preset"
          hint={`Used by every college without its own · ${hasSkills(globalPreset) ? `${globalPreset.requiredSkills.length} skills` : 'not set yet'}`}
        />
        <ModeCard
          selected={mode === 'college'}
          onClick={() => {
            setMode('college')
            if (!target) {
              const first = [...institutions].sort((a, b) => Number(!!own(b.id)) - Number(!!own(a.id)) || a.name.localeCompare(b.name))[0]
              if (first) onChoose(first.id)
            }
          }}
          title="College-specific"
          hint={`From a college’s own SSL logs · ${withOwn} college${withOwn === 1 ? '' : 's'} have one`}
        />
      </div>

      {mode === 'college' && (
        <div className="mt-4">
          <div className="relative mb-2.5">
            <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: 'var(--color-char-soft)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search colleges"
              className="w-full pl-8 pr-3 py-2 text-[13.5px] border outline-none bg-transparent transition-colors focus:border-[var(--color-gold)]"
              style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
            />
          </div>
          <div className="max-h-[260px] overflow-y-auto border rounded-[8px]" style={{ borderColor: 'var(--color-line)' }}>
            {colleges.length === 0 ? (
              <p className="p-4 text-[13px] text-center" style={{ color: 'var(--color-char-soft)' }}>
                No colleges match.
              </p>
            ) : (
              colleges.map((c, i) => {
                const p = own(c.id)
                const active = target === c.id
                return (
                  <button
                    key={c.id}
                    onClick={() => onChoose(c.id)}
                    className="w-full text-left flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-black/[0.02]"
                    style={{ borderTop: i > 0 ? `1px solid ${ROW_LINE}` : undefined, backgroundColor: active ? 'var(--color-gold-soft)' : undefined }}
                  >
                    <span
                      className="h-4 w-4 shrink-0 rounded-full border flex items-center justify-center"
                      style={{ borderColor: active ? 'var(--color-gold)' : 'var(--color-line)' }}
                    >
                      {active && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--color-gold)' }} />}
                    </span>
                    <span className="flex-1 min-w-0 text-[13.5px] truncate" style={{ color: 'var(--color-char)' }}>
                      {c.name}
                    </span>
                    {p ? (
                      <span className="shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border" style={{ borderColor: 'color-mix(in srgb, var(--color-teal) 40%, transparent)', color: 'var(--color-teal)' }}>
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--color-teal)' }} />
                        Own preset · {p.requiredSkills.length}
                      </span>
                    ) : (
                      <span className="shrink-0 text-[11px]" style={{ color: 'var(--color-char-soft)' }}>
                        Uses global
                      </span>
                    )}
                  </button>
                )
              })
            )}
          </div>
          {!target && (
            <p className="mt-2 text-[12px]" style={{ color: 'var(--color-gold)' }}>
              Pick a college to edit its preset.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ModeCard({ selected, onClick, title, hint }: { selected: boolean; onClick: () => void; title: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-[8px] border px-4 py-3 transition-colors flex items-start gap-3"
      style={{
        borderColor: selected ? 'var(--color-gold)' : 'var(--color-line)',
        backgroundColor: selected ? 'color-mix(in srgb, var(--color-gold) 8%, transparent)' : 'transparent',
      }}
    >
      <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border flex items-center justify-center" style={{ borderColor: selected ? 'var(--color-gold)' : 'var(--color-line)' }}>
        {selected && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--color-gold)' }} />}
      </span>
      <span className="min-w-0">
        <span className="block text-[13.5px] font-medium" style={{ color: 'var(--color-char)' }}>
          {title}
        </span>
        <span className="block text-[12px] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
          {hint}
        </span>
      </span>
    </button>
  )
}
