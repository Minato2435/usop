import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PrimaryAdminShell } from './shell/PrimaryAdminShell'
import { Card, Field, GhostButton, Modal, PrimaryButton, Skeleton, inputClass } from './shell/ui'
import { Icon } from './shell/Icon'
import { InstitutionPickerModal } from './shell/InstitutionPicker'
import { DopsChecklistPreview, isDopsSchema } from './DopsChecklistPreview'
import {
  watchGlobalTemplates,
  watchTreeNodes,
  getOrCreateGlobalSslTemplate,
  createTreeNode,
  countTemplateFields,
} from '../../lib/firestore/logTemplates'
import { watchFormSchema, createFormSchema } from '../../lib/firestore/formSchemas'
import { watchAllDepartments } from '../../lib/firestore/departments'
import { useAuth } from '../../auth/AuthContext'
import type { CompetencyLevel, Department, FormField, FormSchema, LogTemplate, TreeNode } from '../../types'

type ViewMode = 'grid' | 'list'
type StatusFilter = 'all' | 'with' | 'without'

const LEVELS: CompetencyLevel[] = ['O', 'A', 'P', 'I']
const LEVEL_LABEL: Record<CompetencyLevel, string> = {
  O: 'Observed',
  A: 'Assisted',
  P: 'Performed under supervision',
  I: 'Independently performed',
}

function countSteps(schema: FormSchema | null): number {
  if (!schema) return 0
  return schema.fields.filter((f) => /^step-\d+$/.test(f.id)).length
}

interface Row {
  template: LogTemplate
  node: TreeNode
  schema: FormSchema | null
}

// Browses the competency checklists seeded onto SSL log templates — one
// template per department, each template's tree nodes are the individual
// procedures, each procedure's formSchemaId points at its DOPS-style
// evaluation form. Structurally adapted from a design reference
// (attaching references/Competency Library.dc.html) — a department+level
// sidebar library browser — translated onto our real data model: its
// "assessed/cohort/pass rate/coverage/drafts" metrics don't exist in ours
// (no submission data yet) so those are dropped; "code/setting/level/
// domains/step count" all map directly onto FormSchema fields we already
// have, and "group by theme" becomes "group by department" (our only real
// grouping axis) with a department+level sidebar replacing the reference's.
export function PrimaryAdminCompetenciesPage() {
  const navigate = useNavigate()
  const { appUser } = useAuth()
  const [templates, setTemplates] = useState<LogTemplate[] | null>(null)
  const [nodesByTemplate, setNodesByTemplate] = useState<Record<string, TreeNode[]>>({})
  const [previewNode, setPreviewNode] = useState<{ node: TreeNode; department: string } | null>(null)
  const [departments, setDepartments] = useState<Department[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [newDepartment, setNewDepartment] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [saving, setSaving] = useState(false)

  // "By institution" picker — jumps straight to an institution's own
  // Competencies tab (Institution Management portal), which already shows
  // what's editable/customized vs. just inherited from the global library
  // for that institution.
  const [institutionPickerOpen, setInstitutionPickerOpen] = useState(false)

  // Filters
  const [search, setSearch] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState<'all' | string>('all')
  const [levelFilter, setLevelFilter] = useState<'all' | CompetencyLevel>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [nameSortDesc, setNameSortDesc] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [sidebarOpen, setSidebarOpen] = useState(true)

  useEffect(() => watchGlobalTemplates({}, (all) => setTemplates(all.filter((t) => t.logType === 'SSL'))), [])
  useEffect(() => watchAllDepartments(setDepartments), [])

  const departmentOptions = useMemo(() => {
    const names = new Set((departments ?? []).map((d) => d.name))
    return [...names].sort((a, b) => a.localeCompare(b))
  }, [departments])

  function closeCreate() {
    setCreating(false)
    setNewDepartment('')
    setNewTitle('')
  }

  async function handleCreate() {
    if (!newDepartment || !newTitle.trim()) return
    setSaving(true)
    const targetTemplateId = await getOrCreateGlobalSslTemplate(newDepartment, 1, appUser?.uid ?? '')
    const order = await countTemplateFields({ id: targetTemplateId, logType: 'SSL' } as LogTemplate)
    const schemaId = await createFormSchema({
      title: newTitle.trim(),
      fields: [],
      code: null,
      setting: null,
      level: null,
      domains: null,
      createdBy: appUser?.uid ?? '',
    })
    const nodeId = await createTreeNode(targetTemplateId, {
      parentId: null,
      title: newTitle.trim(),
      order,
      type: 'Checklist',
      required: true,
      formSchemaId: schemaId,
    })
    setSaving(false)
    closeCreate()
    navigate(`/admin/competencies/${targetTemplateId}/${nodeId}`)
  }

  const templateIds = useMemo(() => (templates ?? []).map((t) => t.id).join(','), [templates])

  useEffect(() => {
    if (!templates) return
    const unsubs = templates.map((t) =>
      watchTreeNodes(t.id, (nodes) => setNodesByTemplate((prev) => ({ ...prev, [t.id]: nodes }))),
    )
    return () => unsubs.forEach((u) => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateIds])

  // Bulk-load the evaluation form behind every procedure — this is where
  // level/code/setting/domains/step-count actually live (on FormSchema, not
  // on the tree node itself), needed to show and filter on them here.
  const allNodesFlat = useMemo(() => Object.values(nodesByTemplate).flat(), [nodesByTemplate])
  const schemaIdsKey = useMemo(() => {
    const ids = new Set<string>()
    allNodesFlat.forEach((n) => {
      if (n.formSchemaId) ids.add(n.formSchemaId)
    })
    return [...ids].sort().join(',')
  }, [allNodesFlat])
  const [schemaById, setSchemaById] = useState<Record<string, FormSchema | null>>({})

  useEffect(() => {
    const ids = schemaIdsKey ? schemaIdsKey.split(',') : []
    const unsubs = ids.map((id) => watchFormSchema(id, (schema) => setSchemaById((prev) => ({ ...prev, [id]: schema }))))
    return () => unsubs.forEach((u) => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemaIdsKey])

  const loading = !templates
  const totalProcedures = allNodesFlat.length

  // Department + level sidebar counts are deliberately computed from the
  // full, unfiltered catalog (not the active filters) so the library map
  // itself stays stable while narrowing down — matching the reference's
  // deptList, which counts against the raw dataset rather than recomputing
  // against itself.
  const deptCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    ;(templates ?? []).forEach((t) => {
      counts[t.department] = (counts[t.department] ?? 0) + (nodesByTemplate[t.id]?.length ?? 0)
    })
    return counts
  }, [templates, nodesByTemplate])
  const sidebarDepartments = useMemo(
    () => departmentOptions.filter((d) => (deptCounts[d] ?? 0) > 0),
    [departmentOptions, deptCounts],
  )

  const allRows: Row[] = useMemo(() => {
    const rows: Row[] = []
    ;(templates ?? []).forEach((t) => {
      ;(nodesByTemplate[t.id] ?? []).forEach((n) => {
        rows.push({ template: t, node: n, schema: n.formSchemaId ? (schemaById[n.formSchemaId] ?? null) : null })
      })
    })
    return rows
  }, [templates, nodesByTemplate, schemaById])

  const q = search.trim().toLowerCase()
  const filteredRows = useMemo(
    () =>
      allRows.filter((r) => {
        if (departmentFilter !== 'all' && r.template.department !== departmentFilter) return false
        if (levelFilter !== 'all' && r.schema?.level !== levelFilter) return false
        if (statusFilter === 'with' && !r.node.formSchemaId) return false
        if (statusFilter === 'without' && r.node.formSchemaId) return false
        if (q) {
          const haystack = [r.node.title, r.schema?.code ?? '', r.schema?.setting ?? ''].join(' ').toLowerCase()
          if (!haystack.includes(q)) return false
        }
        return true
      }),
    [allRows, departmentFilter, levelFilter, statusFilter, q],
  )

  const groups = useMemo(() => {
    const byDept = new Map<string, Row[]>()
    filteredRows.forEach((r) => {
      const list = byDept.get(r.template.department) ?? []
      list.push(r)
      byDept.set(r.template.department, list)
    })
    return [...byDept.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([department, rows]) => ({
        department,
        rows: [...rows].sort((a, b) =>
          nameSortDesc ? b.node.title.localeCompare(a.node.title) : a.node.title.localeCompare(b.node.title),
        ),
      }))
  }, [filteredRows, nameSortDesc])

  const summaryDepartments = new Set(filteredRows.map((r) => r.template.department)).size
  const summarySteps = filteredRows.reduce((sum, r) => sum + countSteps(r.schema), 0)
  const summaryWithChecklist = filteredRows.filter((r) => r.node.formSchemaId).length

  const noneAtAll = !loading && templates!.length === 0
  const filtersActive = search.trim() !== '' || departmentFilter !== 'all' || levelFilter !== 'all' || statusFilter !== 'all'
  const noMatches = !loading && !noneAtAll && filteredRows.length === 0

  const pageTitle = departmentFilter === 'all' ? 'Competencies' : `${departmentFilter} competencies`

  return (
    <PrimaryAdminShell
      eyebrow="Academic structure"
      title={pageTitle}
      actions={
        <div className="flex items-center gap-2">
          <GhostButton onClick={() => setInstitutionPickerOpen(true)}>
            <Icon name="institutions" className="h-3.5 w-3.5" />
            By institution
          </GhostButton>
          <PrimaryButton onClick={() => setCreating(true)}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            New competency
          </PrimaryButton>
        </div>
      }
    >
      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-64" />
        </div>
      ) : noneAtAll ? (
        <Card className="chamfer max-w-lg">
          <p className="text-[13.5px] mb-4" style={{ color: 'var(--color-char-soft)' }}>
            No competency checklists exist yet. Create one to start attaching evaluation forms to a department's
            procedures.
          </p>
          <PrimaryButton onClick={() => setCreating(true)}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            Add the first competency
          </PrimaryButton>
        </Card>
      ) : (
        <div className="flex items-start gap-8">
          {/* ---------- Library sidebar: departments + level ----------
              Collapses to width 0 with a fade (rather than unmounting) so
              the closing/opening motion actually animates; when closed,
              Department and Level move up into the toolbar as dropdowns,
              same style as the other top filters. */}
          <div
            className="hidden lg:block shrink-0 sticky top-0 transition-all duration-300 ease-out"
            style={{
              width: sidebarOpen ? 212 : 0,
              opacity: sidebarOpen ? 1 : 0,
              maxHeight: '100vh',
              overflowX: 'hidden',
              overflowY: 'auto',
            }}
          >
            <aside className="w-[212px]">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] mb-2 px-1" style={{ color: 'var(--color-char-soft)' }}>
                Departments
              </div>
              <div className="mb-6">
                <SidebarRow
                  label="All departments"
                  count={totalProcedures}
                  active={departmentFilter === 'all'}
                  onClick={() => setDepartmentFilter('all')}
                />
                {sidebarDepartments.map((d) => (
                  <SidebarRow
                    key={d}
                    label={d}
                    count={deptCounts[d] ?? 0}
                    active={departmentFilter === d}
                    onClick={() => setDepartmentFilter(departmentFilter === d ? 'all' : d)}
                  />
                ))}
              </div>

              <div className="h-px mb-5" style={{ backgroundColor: 'var(--color-line)' }} />

              <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] mb-2 px-1" style={{ color: 'var(--color-char-soft)' }}>
                Level
              </div>
              <div>
                {LEVELS.map((lvl) => (
                  <button
                    key={lvl}
                    onClick={() => setLevelFilter(levelFilter === lvl ? 'all' : lvl)}
                    className="flex items-center gap-2.5 w-full text-left px-2.5 py-1.5 text-[13px] transition-colors"
                    style={{
                      borderLeft: `3px solid ${levelFilter === lvl ? 'var(--color-gold)' : 'transparent'}`,
                      backgroundColor: levelFilter === lvl ? 'color-mix(in srgb, var(--color-gold) 10%, transparent)' : 'transparent',
                      color: levelFilter === lvl ? 'var(--color-char)' : 'var(--color-char-soft)',
                    }}
                  >
                    <span
                      className="h-5 w-5 shrink-0 rounded-full border flex items-center justify-center font-display text-[11px]"
                      style={{
                        borderColor: levelFilter === lvl ? 'var(--color-gold)' : 'var(--color-line)',
                        backgroundColor: levelFilter === lvl ? 'var(--color-gold)' : 'transparent',
                        color: levelFilter === lvl ? 'var(--color-frost)' : 'var(--color-char-soft)',
                      }}
                    >
                      {lvl}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{LEVEL_LABEL[lvl]}</span>
                  </button>
                ))}
              </div>
            </aside>
          </div>

          {/* ---------- Main content ---------- */}
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] mb-6" style={{ color: 'var(--color-char-soft)' }}>
              DOPS checklists across {departmentFilter === 'all' ? 'all departments' : departmentFilter.toLowerCase()}
              {levelFilter !== 'all' ? ` at level: ${LEVEL_LABEL[levelFilter].toLowerCase()}` : ''}. Open one to edit its
              evaluation form.
            </p>

            <div
              className="grid grid-cols-2 sm:grid-cols-4 border rounded-[6px] overflow-hidden mb-6"
              style={{ borderColor: 'var(--color-line)' }}
            >
              <div className="px-5 py-4" style={{ borderRight: '1px solid var(--color-line)' }}>
                <div className="font-display text-[26px] leading-none tabular-nums" style={{ color: 'var(--color-char)' }}>
                  {summaryDepartments}
                </div>
                <div className="mt-2 text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                  Departments
                </div>
              </div>
              <div className="px-5 py-4" style={{ borderRight: '1px solid var(--color-line)' }}>
                <div className="font-display text-[26px] leading-none tabular-nums" style={{ color: 'var(--color-gold)' }}>
                  {filteredRows.length}
                </div>
                <div className="mt-2 text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                  Competencies
                </div>
              </div>
              <div className="px-5 py-4" style={{ borderRight: '1px solid var(--color-line)' }}>
                <div className="font-display text-[26px] leading-none tabular-nums" style={{ color: 'var(--color-char)' }}>
                  {summarySteps}
                </div>
                <div className="mt-2 text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                  Checklist steps
                </div>
              </div>
              <div className="px-5 py-4">
                <div className="font-display text-[26px] leading-none tabular-nums" style={{ color: 'var(--color-char)' }}>
                  {summaryWithChecklist}
                  <span className="text-[14px]" style={{ color: 'var(--color-char-soft)' }}>/{filteredRows.length}</span>
                </div>
                <div className="mt-2 text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                  With checklist
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap mb-3">
              <button
                onClick={() => setSidebarOpen((o) => !o)}
                title={sidebarOpen ? 'Hide departments & level' : 'Show departments & level'}
                className="hidden lg:flex h-8 w-9 shrink-0 items-center justify-center border rounded-[6px] transition-colors"
                style={{ borderColor: 'var(--color-line)', color: 'var(--color-char-soft)' }}
              >
                <Icon
                  name="chevron"
                  className={`h-3.5 w-3.5 transition-transform duration-300 ${sidebarOpen ? 'rotate-180' : ''}`}
                />
              </button>

              <div className="relative flex-1 min-w-[200px]">
                <Icon
                  name="search"
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none"
                  style={{ color: 'var(--color-char-soft)' }}
                />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search skill, reference or setting…"
                  className="w-full pl-8 pr-3 py-2 text-[13.5px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]"
                  style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
                />
              </div>

              {!sidebarOpen && (
                <>
                  <select
                    className={inputClass}
                    style={{ width: 172, borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
                    value={departmentFilter}
                    onChange={(e) => setDepartmentFilter(e.target.value)}
                  >
                    <option value="all">All departments</option>
                    {sidebarDepartments.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <select
                    className={inputClass}
                    style={{ width: 152, borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
                    value={levelFilter}
                    onChange={(e) => setLevelFilter(e.target.value as 'all' | CompetencyLevel)}
                  >
                    <option value="all">All levels</option>
                    {LEVELS.map((lvl) => (
                      <option key={lvl} value={lvl}>
                        {lvl} — {LEVEL_LABEL[lvl]}
                      </option>
                    ))}
                  </select>
                </>
              )}

              <select
                className={inputClass}
                style={{ width: 156, borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              >
                <option value="all">All checklists</option>
                <option value="with">With checklist</option>
                <option value="without">No checklist</option>
              </select>

              <select
                className={inputClass}
                style={{ width: 152, borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
                value={nameSortDesc ? 'desc' : 'asc'}
                onChange={(e) => setNameSortDesc(e.target.value === 'desc')}
              >
                <option value="asc">Name A → Z</option>
                <option value="desc">Name Z → A</option>
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
            </div>

            {filtersActive && (
              <button
                onClick={() => {
                  setSearch('')
                  setDepartmentFilter('all')
                  setLevelFilter('all')
                  setStatusFilter('all')
                }}
                className="text-[11.5px] font-medium hover:opacity-70 transition-opacity mb-5"
                style={{ color: 'var(--color-gold)' }}
              >
                Clear filters
              </button>
            )}

            {noMatches ? (
              <Card className="chamfer">
                <p className="text-[13.5px] mb-3" style={{ color: 'var(--color-char-soft)' }}>
                  No competencies match these filters.
                </p>
                <button
                  onClick={() => {
                    setSearch('')
                    setDepartmentFilter('all')
                    setLevelFilter('all')
                    setStatusFilter('all')
                  }}
                  className="text-[12.5px] font-medium hover:opacity-70 transition-opacity"
                  style={{ color: 'var(--color-gold)' }}
                >
                  Clear filters
                </button>
              </Card>
            ) : (
              <div className="space-y-7">
                {groups.map(({ department, rows }) => (
                  <div key={department}>
                    <div className="flex items-center gap-2 mb-3">
                      <span className="font-display text-[19px]" style={{ color: 'var(--color-char)' }}>
                        {department}
                      </span>
                      <span className="text-[11px]" style={{ color: 'var(--color-char-soft)' }}>
                        {rows.length} competenc{rows.length === 1 ? 'y' : 'ies'}
                      </span>
                    </div>
                    {viewMode === 'grid' ? (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {rows.map(({ template, node, schema }, i) => (
                          <CompetencyCard
                            key={node.id}
                            node={node}
                            schema={schema}
                            index={i}
                            onOpen={() => navigate(`/admin/competencies/${template.id}/${node.id}`)}
                            onPreview={() => setPreviewNode({ node, department: template.department })}
                          />
                        ))}
                      </div>
                    ) : (
                      <div
                        className="border rounded-[10px] overflow-hidden"
                        style={{
                          backgroundColor: 'var(--color-paper)',
                          borderColor: 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)',
                        }}
                      >
                        {rows.map(({ template, node, schema }, i) => (
                          <CompetencyListRow
                            key={node.id}
                            node={node}
                            schema={schema}
                            isLast={i === rows.length - 1}
                            onOpen={() => navigate(`/admin/competencies/${template.id}/${node.id}`)}
                            onPreview={() => setPreviewNode({ node, department: template.department })}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {previewNode && (
        <CompetencyPreviewModal
          node={previewNode.node}
          department={previewNode.department}
          onClose={() => setPreviewNode(null)}
          onEdit={(templateId) => navigate(`/admin/competencies/${templateId}/${previewNode.node.id}`)}
        />
      )}

      {creating && (
        <Modal title="New competency" onClose={closeCreate}>
          <Field label="Department">
            <select
              className={inputClass}
              style={{ borderColor: 'var(--color-line)', color: newDepartment ? 'var(--color-char)' : 'var(--color-char-soft)' }}
              value={newDepartment}
              onChange={(e) => setNewDepartment(e.target.value)}
            >
              <option value="" disabled>
                Select a department…
              </option>
              {departmentOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Skill / competency name">
            <input
              autoFocus
              className={inputClass}
              style={{ borderColor: 'var(--color-line)' }}
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g. Basic Suturing"
            />
          </Field>
          <p className="text-[12px] leading-relaxed mb-2" style={{ color: 'var(--color-char-soft)' }}>
            {newDepartment && templates?.some((t) => t.department === newDepartment)
              ? `Adds to the existing "${newDepartment}" log template.`
              : newDepartment
                ? `Creates a new "${newDepartment} — Competency Checklists" log template for it.`
                : 'Pick which department this competency belongs to.'}
          </p>
          <div className="flex justify-end gap-2 mt-2">
            <PrimaryButton onClick={handleCreate} disabled={!newDepartment || !newTitle.trim() || saving}>
              {saving ? 'Creating…' : 'Create competency'}
            </PrimaryButton>
          </div>
        </Modal>
      )}

      {institutionPickerOpen && (
        <InstitutionPickerModal
          title="Open an institution's competencies"
          description="Pick an institution to see which competencies are customized or institution-owned for them, versus just inherited from the global library."
          onClose={() => setInstitutionPickerOpen(false)}
          onSelect={(inst) => navigate(`/admin/institutions/${inst.id}?tab=competencies`)}
        />
      )}
    </PrimaryAdminShell>
  )
}

function SidebarRow({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 w-full text-left px-2.5 py-1.5 text-[13px] transition-colors"
      style={{
        borderLeft: `3px solid ${active ? 'var(--color-gold)' : 'transparent'}`,
        backgroundColor: active ? 'color-mix(in srgb, var(--color-gold) 10%, transparent)' : 'transparent',
        color: active ? 'var(--color-char)' : 'var(--color-char-soft)',
        fontWeight: active ? 600 : 400,
      }}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-[11.5px] tabular-nums" style={{ color: 'var(--color-char-soft)' }}>
        {count}
      </span>
    </button>
  )
}

function CompetencyMeta({ schema }: { schema: FormSchema | null }) {
  if (!schema) return null
  const steps = countSteps(schema)
  const metaBits = [schema.code, schema.setting, steps > 0 ? `${steps} steps` : null].filter(Boolean)
  return (
    <>
      {metaBits.length > 0 && (
        <div className="mt-1 text-[11.5px] leading-relaxed" style={{ color: 'var(--color-char-soft)' }}>
          {metaBits.join(' · ')}
        </div>
      )}
      {schema.domains && schema.domains.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
          {schema.domains.map((d) => (
            <span key={d} className="text-[10.5px] font-medium uppercase tracking-[0.04em]" style={{ color: 'var(--color-gold)' }}>
              {d}
            </span>
          ))}
        </div>
      )}
    </>
  )
}

function ChecklistBadge({ attached }: { attached: boolean }) {
  return attached ? (
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
  )
}

function CompetencyCard({
  node,
  schema,
  index,
  onOpen,
  onPreview,
}: {
  node: TreeNode
  schema: FormSchema | null
  index: number
  onOpen: () => void
  onPreview: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className="fade-up group text-left rounded-[10px] border p-4 cursor-pointer transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-14px_rgba(11,18,32,0.35)] hover:border-[var(--color-gold-line)]"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)',
        borderColor: 'var(--color-line)',
        animationDelay: `${index * 35}ms`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 flex items-start gap-3">
          <div
            className="shrink-0 h-10 w-10 rounded-full border-[1.5px] flex items-center justify-center font-display text-[16px]"
            style={{ borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)' }}
          >
            {(node.title.trim()[0] ?? '?').toUpperCase()}
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="font-display text-[16.5px] font-semibold leading-snug break-words" style={{ color: 'var(--color-char)' }}>
              {node.title || 'Untitled competency'}
            </div>
            <CompetencyMeta schema={schema} />
          </div>
        </div>
        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onPreview()
            }}
            title="Preview form"
            className="h-6 w-6 flex items-center justify-center rounded-[3px] hover:bg-black/[0.06]"
            style={{ color: 'var(--color-char-soft)' }}
          >
            <Icon name="eye" className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onOpen()
            }}
            title="Edit competency"
            className="h-6 w-6 flex items-center justify-center rounded-[3px] hover:bg-black/[0.06]"
            style={{ color: 'var(--color-char-soft)' }}
          >
            <Icon name="edit" className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-3">
        <ChecklistBadge attached={!!node.formSchemaId} />
      </div>
    </div>
  )
}

// Compact row for list view — same data and actions as CompetencyCard, laid
// out as a single line so many competencies in one department scan quickly.
function CompetencyListRow({
  node,
  schema,
  isLast,
  onOpen,
  onPreview,
}: {
  node: TreeNode
  schema: FormSchema | null
  isLast: boolean
  onOpen: () => void
  onPreview: () => void
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className="group flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-black/[0.02]"
      style={{ borderBottom: isLast ? undefined : '1px solid color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)' }}
    >
      <div className="min-w-0 flex-1">
        <div className="font-display text-[15px] leading-snug truncate" style={{ color: 'var(--color-char)' }}>
          {node.title || 'Untitled competency'}
        </div>
        {schema && (
          <div className="text-[11px] truncate" style={{ color: 'var(--color-char-soft)' }}>
            {[schema.code, schema.setting, countSteps(schema) > 0 ? `${countSteps(schema)} steps` : null]
              .filter(Boolean)
              .join(' · ')}
          </div>
        )}
      </div>

      <ChecklistBadge attached={!!node.formSchemaId} />

      <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation()
            onPreview()
          }}
          title="Preview form"
          className="h-6 w-6 flex items-center justify-center rounded-[3px] hover:bg-black/[0.06]"
          style={{ color: 'var(--color-char-soft)' }}
        >
          <Icon name="eye" className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onOpen()
          }}
          title="Edit competency"
          className="h-6 w-6 flex items-center justify-center rounded-[3px] hover:bg-black/[0.06]"
          style={{ color: 'var(--color-char-soft)' }}
        >
          <Icon name="edit" className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  )
}

// Read-only render of exactly what faculty will see and fill in when
// evaluating a student against this competency. When the checklist matches
// the original DOPS layout (every competency seeded from "USOP PROGRAM "
// does), this renders a faithful recreation of that exact design — same
// navy header, sticky score ring, Done/Not done/N/A pills, segmented
// global ratings — rather than a generic field list.
function CompetencyPreviewModal({
  node,
  department,
  onClose,
  onEdit,
}: {
  node: TreeNode
  department: string
  onClose: () => void
  onEdit: (templateId: string) => void
}) {
  const [fields, setFields] = useState<FormField[] | null>(null)
  const [identity, setIdentity] = useState<{ code: string | null; setting: string | null; level: string | null; domains: string[] | null }>({
    code: null,
    setting: null,
    level: null,
    domains: null,
  })
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!node.formSchemaId) {
      setFields([])
      return
    }
    return watchFormSchema(node.formSchemaId, (schema) => {
      setFields(schema?.fields ?? [])
      setIdentity({
        code: schema?.code ?? null,
        setting: schema?.setting ?? null,
        level: schema?.level ?? null,
        domains: schema?.domains ?? null,
      })
    })
  }, [node.formSchemaId])

  const isDops = fields !== null && isDopsSchema(fields)

  if (isDops) {
    return (
      <div
        className={`fixed inset-0 z-50 flex items-start justify-center overflow-y-auto ${expanded ? '' : 'p-4 py-10'}`}
        style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 55%, transparent)' }}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget && !expanded) onClose()
        }}
      >
        <div
          className={`w-full fade-up ${expanded ? '' : 'max-w-[1180px] rounded-[10px] overflow-hidden'}`}
          style={{ maxHeight: expanded ? '100vh' : '90vh', minHeight: expanded ? '100vh' : undefined }}
        >
          <div
            className="flex items-center justify-between gap-3 px-5 py-3 shrink-0"
            style={{ backgroundColor: 'var(--color-paper)', borderBottom: '1px solid var(--color-gold-line)' }}
          >
            <span
              className="text-[10.5px] font-semibold uppercase tracking-[0.1em] truncate"
              style={{ color: 'var(--color-char-soft)', fontFamily: 'var(--font-mono)' }}
            >
              Live preview <span style={{ color: 'var(--color-gold)' }}>·</span> exactly what faculty will see and fill in
            </span>
            <div className="flex items-center gap-3 shrink-0">
              <button
                onClick={() => onEdit(node.templateId)}
                className="text-[12px] font-medium hover:opacity-75 transition-opacity"
                style={{ color: 'var(--color-gold)' }}
              >
                Edit this competency
              </button>
              <button
                onClick={() => setExpanded((v) => !v)}
                title={expanded ? 'Exit full screen' : 'Full screen'}
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
                <Icon name={expanded ? 'compress' : 'expand'} style={{ width: 15, height: 15 }} />
              </button>
              <button
                onClick={onClose}
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
          <div style={{ maxHeight: expanded ? 'calc(100vh - 54px)' : 'calc(90vh - 54px)', overflowY: 'auto' }}>
            <DopsChecklistPreview
              title={node.title || 'Untitled competency'}
              department={department}
              code={identity.code}
              setting={identity.setting}
              level={identity.level}
              domains={identity.domains}
              fields={fields!}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 py-10"
      style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 55%, transparent)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="chamfer w-full max-w-2xl p-6 fade-up" style={{ backgroundColor: 'var(--color-paper-raised)' }}>
        <div className="flex items-start justify-between gap-3 mb-1">
          <div className="min-w-0">
            <div
              className="text-[10.5px] font-semibold uppercase tracking-[0.1em] mb-1"
              style={{ color: 'var(--color-gold)' }}
            >
              Preview — what faculty will fill in
            </div>
            <h2 className="font-display text-[22px] break-words" style={{ color: 'var(--color-char)' }}>
              {node.title || 'Untitled competency'}
            </h2>
          </div>
          <button onClick={onClose} className="shrink-0 text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
            Esc
          </button>
        </div>

        {fields === null ? (
          <div className="mt-5 space-y-3">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : fields.length === 0 ? (
          <p className="mt-5 text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            This competency has no checklist attached yet.
          </p>
        ) : (
          <div className="mt-5 space-y-4">
            {fields.map((field) => (
              <PreviewField key={field.id} field={field} />
            ))}
          </div>
        )}

        <div className="mt-6 pt-4 border-t flex justify-end" style={{ borderColor: 'var(--color-line)' }}>
          <GhostButton onClick={() => onEdit(node.templateId)}>
            <Icon name="edit" className="h-3.5 w-3.5" />
            Edit this competency
          </GhostButton>
        </div>
      </div>
    </div>
  )
}

function PreviewField({ field }: { field: FormField }) {
  const labelClass = 'font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]'
  const labelStyle = { color: 'var(--color-char-soft)' }
  const fieldInputClass = 'w-full px-3 py-2 text-[13.5px] border outline-none bg-transparent'
  const fieldInputStyle = { borderColor: 'var(--color-line)', color: 'var(--color-char)' }

  return (
    <div>
      <label className={labelClass} style={labelStyle}>
        {field.label || 'Untitled field'}
        {field.required && <span style={{ color: 'var(--color-clay)' }}> *</span>}
      </label>

      {field.type === 'text' && (
        <input disabled placeholder="Faculty types here" className={fieldInputClass} style={fieldInputStyle} />
      )}

      {field.type === 'textarea' && (
        <textarea
          disabled
          rows={3}
          placeholder="Faculty types here"
          className={`${fieldInputClass} resize-none`}
          style={fieldInputStyle}
        />
      )}

      {field.type === 'number' && <input disabled type="number" placeholder="0" className={fieldInputClass} style={fieldInputStyle} />}

      {field.type === 'date' && <input disabled type="date" className={fieldInputClass} style={fieldInputStyle} />}

      {field.type === 'dropdown' && (
        <select disabled className={fieldInputClass} style={fieldInputStyle}>
          <option>Select…</option>
          {(field.options ?? []).map((opt, i) => (
            <option key={i}>{opt}</option>
          ))}
        </select>
      )}

      {field.type === 'checkbox' && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {(field.options ?? []).map((opt, i) => (
            <label key={i} className="flex items-center gap-1.5 text-[13px]" style={{ color: 'var(--color-char)' }}>
              <input type="checkbox" disabled />
              {opt}
            </label>
          ))}
        </div>
      )}

      {field.type === 'rating' && (
        <div className="flex items-center gap-1.5">
          {Array.from({ length: field.maxRating ?? 5 }).map((_, i) => (
            <span
              key={i}
              className="h-7 w-7 flex items-center justify-center rounded-full border text-[12px] font-medium"
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
