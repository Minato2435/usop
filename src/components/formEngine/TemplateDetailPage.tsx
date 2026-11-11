import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TreeBuilder, numberTree, maxTreeDepth } from './TreeBuilder'
import { SdlCategoryBuilder } from './SdlCategoryBuilder'
import {
  watchTemplate,
  updateTemplate,
  watchTreeNodes,
  createTreeNode,
  updateTreeNode,
  deleteTreeNode,
  insertTreeNode,
  duplicateTreeSubtree,
  watchSdlCategories,
  createSdlCategory,
  deleteSdlCategory,
} from '../../lib/firestore/logTemplates'
import { watchAllDepartments, watchInstitutionDepartments } from '../../lib/firestore/departments'
import { MBBS_YEARS } from '../../lib/academicStructure'
import type { Department, LogTemplate, LogType, MbbsYear, TreeNode, TreeNodeFieldType } from '../../types'

const PAGE_BG = '#f3f2f2'

const LOG_TYPE_INFO: Record<LogType, string> = {
  SSL: 'Structured Skill Log — supervised procedures verified by faculty.',
  SDL: 'Self-Directed Learning — student-recorded study and reflection.',
}

// What a student sees under a leaf field of this type when actually filling
// out the log (shown in the preview dialog only — purely descriptive).
const FIELD_HINTS: Record<TreeNodeFieldType, string> = {
  Section: '',
  'Short text': 'Single line answer',
  'Long text': 'Paragraph answer',
  Number: '0',
  Date: 'dd / mm / yyyy',
  Dropdown: 'Select an option',
  Checklist: 'Multiple selection',
  Signature: 'Supervisor signature',
}

// Shared detail/editor page for a single log template. Rendered under both
// /admin/log-templates/:templateId and /institution-admin/log-templates/:templateId
// — access is enforced by Firestore security rules based on the template's
// own scope/institutionId, not by which route wraps this component. Also
// doubles as the "create" flow: the caller creates a blank draft doc first
// (see PrimaryAdminLogTemplatesPage.handleAddTemplate) and navigates straight
// here — every field in the left rail writes live via updateTemplate, there
// is no separate create-then-edit step. Deliberately standalone (no AppShell)
// — a full-bleed single-purpose editor, matching the design reference, which
// has no persistent app chrome of its own either.
export function TemplateDetailPage({ backPath }: { backPath: string }) {
  const { templateId } = useParams<{ templateId: string }>()
  const navigate = useNavigate()
  const [template, setTemplate] = useState<LogTemplate | null | undefined>(undefined)
  const [nodes, setNodes] = useState<TreeNode[]>([])
  const [categories, setCategories] = useState<{ id: string; templateId: string; title: string; order: number }[]>([])
  const [institutionDepartments, setInstitutionDepartments] = useState<Department[]>([])
  const [catalogDepartments, setCatalogDepartments] = useState<Department[]>([])
  const [previewOpen, setPreviewOpen] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')

  useEffect(() => {
    if (!templateId) return
    return watchTemplate(templateId, setTemplate)
  }, [templateId])

  useEffect(() => {
    if (!templateId || !template) return
    if (template.logType === 'SSL') return watchTreeNodes(templateId, setNodes)
    return watchSdlCategories(templateId, setCategories)
  }, [templateId, template?.logType])

  useEffect(() => {
    if (!template || template.scope !== 'institution') return
    return watchInstitutionDepartments(template.institutionId, setInstitutionDepartments)
  }, [template?.scope, template?.institutionId])

  // Global templates draw department options from the Primary Admin's
  // shared department catalog (the same data as /admin/departments), not a
  // hardcoded reference list — so this dropdown always matches whatever's
  // actually been created there. watchAllDepartments returns every
  // department platform-wide, including institution-exclusive ones, so
  // filter down to the shared catalog (institutionId === '') here — a
  // global template's department picker should never offer a department
  // that only exists for one institution.
  useEffect(() => {
    if (!template || template.scope !== 'global') return
    return watchAllDepartments((all) => setCatalogDepartments(all.filter((d) => d.institutionId === '')))
  }, [template?.scope])

  useEffect(() => {
    if (template) setTitleDraft(template.title)
  }, [template?.id])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setPreviewOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  if (template === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: PAGE_BG }}>
        <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
          Loading template…
        </p>
      </div>
    )
  }

  if (template === null || !templateId) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3" style={{ backgroundColor: PAGE_BG }}>
        <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
          This template doesn't exist or you don't have access to it.
        </p>
        <BackLink onClick={() => navigate(backPath)} />
      </div>
    )
  }

  const departmentOptionsForYear = (year: MbbsYear): string[] =>
    template.scope === 'institution'
      ? institutionDepartments.filter((d) => d.mbbsYear === year).map((d) => d.name)
      : catalogDepartments.filter((d) => d.institutionId === '' && d.mbbsYear === year).map((d) => d.name)

  const structureLocked = template.logType === 'SSL' ? nodes.length > 0 : categories.length > 0

  async function handleAddChild(parentId: string | null) {
    const siblingCount = nodes.filter((n) => n.parentId === parentId).length
    await createTreeNode(templateId!, {
      parentId,
      title: '',
      order: siblingCount,
      type: 'Short text',
      required: false,
      formSchemaId: null,
    })
    // A node gaining its first child becomes pure structure — match the
    // reference's behavior of auto-promoting it to a Section.
    if (parentId) {
      const parent = nodes.find((n) => n.id === parentId)
      if (parent && parent.type !== 'Section' && siblingCount === 0) {
        await updateTreeNode(templateId!, parentId, { type: 'Section' })
      }
    }
  }

  async function handleRename(nodeId: string, title: string) {
    await updateTreeNode(templateId!, nodeId, { title })
  }

  async function handleToggleRequired(nodeId: string) {
    const node = nodes.find((n) => n.id === nodeId)
    if (!node) return
    await updateTreeNode(templateId!, nodeId, { required: !node.required })
  }

  async function handleRemove(nodeId: string) {
    // Cascade-delete this node and all its descendants.
    const toDelete: string[] = []
    const collect = (id: string) => {
      toDelete.push(id)
      nodes.filter((n) => n.parentId === id).forEach((c) => collect(c.id))
    }
    collect(nodeId)
    await Promise.all(toDelete.map((id) => deleteTreeNode(templateId!, id)))
  }

  async function handleInsert(referenceNodeId: string, position: 'above' | 'below') {
    await insertTreeNode(templateId!, nodes, referenceNodeId, position)
  }

  async function handleDuplicate(nodeId: string) {
    await duplicateTreeSubtree(templateId!, nodes, nodeId)
  }

  async function handleAddCategory(title: string) {
    await createSdlCategory(templateId!, { title, order: categories.length })
  }

  async function handleRemoveCategory(categoryId: string) {
    await deleteSdlCategory(templateId!, categoryId)
  }

  async function handleLogTypeChange(logType: LogType) {
    if (structureLocked || logType === template!.logType) return
    await updateTemplate(templateId!, { logType })
  }

  async function handleYearChange(mbbsYear: MbbsYear) {
    if (mbbsYear === template!.mbbsYear) return
    const department = departmentOptionsForYear(mbbsYear)[0] ?? ''
    await updateTemplate(templateId!, { mbbsYear, department })
  }

  async function handleDepartmentChange(department: string) {
    await updateTemplate(templateId!, { department })
  }

  function commitTitle() {
    const trimmed = titleDraft.trim()
    if (trimmed !== template!.title) updateTemplate(templateId!, { title: trimmed })
  }

  const previewRows = template.logType === 'SSL' ? numberTree(nodes) : []
  const departmentChoices = departmentOptionsForYear(template.mbbsYear)

  return (
    <div className="min-h-screen lg:h-screen lg:overflow-hidden flex flex-col" style={{ backgroundColor: PAGE_BG }}>
      <div className="max-w-[1440px] mx-auto w-full flex flex-col lg:h-full lg:min-h-0">
      <header className="shrink-0 flex items-start justify-between gap-4 px-8 md:px-12 pt-8 pb-5">
        <div>
          <BackLink onClick={() => navigate(backPath)} />
          <div
            className="text-[11px] font-semibold uppercase tracking-[0.14em] mt-3 mb-1.5"
            style={{ color: 'var(--color-gold)' }}
          >
            Logbook configuration
          </div>
          <h1 className="font-display text-[32px] leading-tight" style={{ color: 'var(--color-char)' }}>
            {template.title || 'Untitled template'}
          </h1>
          <div className="mt-1.5 text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            {template.logType} · Year {template.mbbsYear} · {template.department || 'No department set'}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0 pt-1">
          {template.logType === 'SSL' && (
            <button
              onClick={() => setPreviewOpen(true)}
              className="px-4 py-2 text-[13px] font-medium border rounded-[4px] transition-colors duration-150 hover:bg-black/[0.03]"
              style={{ borderColor: '#d7d3d3', color: 'var(--color-char)', backgroundColor: PAGE_BG }}
            >
              Preview
            </button>
          )}
          <button
            onClick={() => navigate(backPath)}
            className="px-4 py-2 text-[13px] font-medium rounded-[4px] transition-transform duration-150 hover:-translate-y-[1px]"
            style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-frost)' }}
          >
            Save template
          </button>
        </div>
      </header>

      <div className="shrink-0 h-px" style={{ backgroundColor: '#d7d3d3' }} />

      <div className="flex flex-col lg:flex-row lg:flex-1 lg:min-h-0">
        <aside
          className="lg:w-[350px] lg:shrink-0 px-8 md:px-12 lg:pl-12 lg:pr-8 pt-7 pb-14 flex flex-col gap-6 lg:border-r"
          style={{ borderColor: '#d7d3d3' }}
        >
          <div>
            <div
              className="text-[10.5px] font-semibold uppercase tracking-[0.1em] mb-2"
              style={{ color: 'var(--color-char-soft)' }}
            >
              Log type
            </div>
            <div className="flex flex-col gap-2">
              {(['SSL', 'SDL'] as LogType[]).map((lt) => {
                const active = template.logType === lt
                const disabled = structureLocked && !active
                return (
                  <button
                    key={lt}
                    onClick={() => handleLogTypeChange(lt)}
                    disabled={disabled}
                    title={disabled ? "Can't change type after fields have been added" : undefined}
                    className="flex items-start gap-2.5 rounded-[6px] border p-3 text-left transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45"
                    style={
                      active
                        ? { backgroundColor: 'var(--color-gold-soft)', borderColor: 'var(--color-gold-line)' }
                        : { backgroundColor: 'transparent', borderColor: '#d7d3d3' }
                    }
                  >
                    <span
                      className="shrink-0 h-4 w-4 rounded-full border flex items-center justify-center mt-0.5"
                      style={{ borderColor: active ? 'var(--color-gold)' : 'var(--color-char-soft)' }}
                    >
                      {active && <span className="h-[7px] w-[7px] rounded-full" style={{ backgroundColor: 'var(--color-gold)' }} />}
                    </span>
                    <span>
                      <span className="block font-display text-[16px]" style={{ color: 'var(--color-char)' }}>
                        {lt}
                      </span>
                      <span className="block text-[12px] leading-snug mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
                        {LOG_TYPE_INFO[lt]}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="h-px" style={{ backgroundColor: '#d7d3d3' }} />

          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] mb-1.5" style={{ color: 'var(--color-char-soft)' }}>
              MBBS year
            </div>
            <div className="inline-flex border rounded-[4px] overflow-hidden" style={{ borderColor: '#d7d3d3' }}>
              {MBBS_YEARS.map((y, i) => (
                <button
                  key={y}
                  onClick={() => handleYearChange(y)}
                  className="px-3 py-1.5 text-[12.5px] font-medium transition-colors duration-150"
                  style={{
                    backgroundColor: template.mbbsYear === y ? 'var(--color-ink)' : 'transparent',
                    color: template.mbbsYear === y ? 'var(--color-frost)' : 'var(--color-char-soft)',
                    borderRight: i < MBBS_YEARS.length - 1 ? '1px solid #d7d3d3' : undefined,
                  }}
                >
                  Year {y}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] mb-1.5" style={{ color: 'var(--color-char-soft)' }}>
              Department
            </div>
            <select
              value={template.department}
              onChange={(e) => handleDepartmentChange(e.target.value)}
              className="w-full px-2.5 py-1.5 text-[13.5px] border rounded-[4px] outline-none transition-colors duration-150 focus:border-[var(--color-gold)]"
              style={{ borderColor: '#d7d3d3', color: 'var(--color-char)' }}
            >
              {!departmentChoices.includes(template.department) && template.department && (
                <option value={template.department}>{template.department}</option>
              )}
              {departmentChoices.length === 0 && !template.department && <option value="">No departments yet</option>}
              {departmentChoices.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            {departmentChoices.length === 0 && (
              <p className="mt-1.5 text-[11.5px] leading-snug" style={{ color: 'var(--color-char-soft)' }}>
                No departments exist for Year {template.mbbsYear} yet
                {template.scope === 'global' ? ' — add one on the Departments page.' : ' for your institution.'}
              </p>
            )}
          </div>

          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] mb-1.5" style={{ color: 'var(--color-char-soft)' }}>
              Log title
            </div>
            <input
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
              placeholder={template.logType === 'SSL' ? 'e.g. Suturing Skills' : 'e.g. Self-Directed Learning'}
              className="w-full px-2.5 py-1.5 text-[13.5px] border rounded-[4px] outline-none transition-colors duration-150 focus:border-[var(--color-gold)]"
              style={{ borderColor: '#d7d3d3', color: 'var(--color-char)' }}
            />
          </div>

          <div className="h-px" style={{ backgroundColor: '#d7d3d3' }} />

          <div className="flex gap-7">
            {template.logType === 'SSL' ? (
              <>
                <Stat value={nodes.length} label="Fields" />
                <Stat value={maxTreeDepth(nodes)} label="Levels deep" />
              </>
            ) : (
              <Stat value={categories.length} label="Categories" />
            )}
          </div>
        </aside>

        <section className="min-w-0 flex-1 overflow-x-auto lg:min-h-0 lg:overflow-y-auto px-8 md:px-12 pt-7 pb-16">
          {template.logType === 'SSL' ? (
            <>
              <TreeBuilder
                nodes={nodes}
                onAddChild={handleAddChild}
                onRename={handleRename}
                onToggleRequired={handleToggleRequired}
                onRemove={handleRemove}
                onInsert={handleInsert}
                onDuplicate={handleDuplicate}
              />
              <div className="flex items-center gap-2.5 mt-4 text-[12.5px]" style={{ color: 'var(--color-char-soft)' }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" className="shrink-0">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 16v-4M12 8h.01" />
                </svg>
                The arrows insert a field above or below; the corner arrow{' '}
                <span style={{ color: 'var(--color-gold)' }}>(↳)</span> nests a subfield inside it, at any depth.
              </div>
            </>
          ) : (
            <SdlCategoryBuilder categories={categories} onAdd={handleAddCategory} onRemove={handleRemoveCategory} />
          )}
        </section>
      </div>
      </div>

      {previewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 55%, transparent)' }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPreviewOpen(false)
          }}
        >
          <div
            className="border w-full max-w-xl max-h-[84vh] overflow-y-auto p-6"
            style={{ backgroundColor: PAGE_BG, borderColor: '#d7d3d3' }}
          >
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--color-gold)' }}>
              {template.logType} · Year {template.mbbsYear}
            </div>
            <h2 className="font-display text-[24px] mt-1" style={{ color: 'var(--color-char)' }}>
              {template.title || 'Untitled log template'}
            </h2>
            <div className="text-[13px] -mt-1" style={{ color: 'var(--color-char-soft)' }}>
              {template.department}
            </div>
            <div className="h-px my-4" style={{ backgroundColor: '#d7d3d3' }} />
            <div className="flex flex-col gap-3.5">
              {previewRows.length === 0 ? (
                <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
                  No fields yet.
                </p>
              ) : (
                previewRows.map(({ node, depth, number }) => (
                  <div key={node.id} style={{ paddingLeft: depth * 20 }}>
                    <div className="flex items-baseline gap-2">
                      <span className="w-9 shrink-0 font-mono text-[10.5px] tabular-nums" style={{ color: 'var(--color-char-soft)' }}>
                        {number}
                      </span>
                      <span
                        className="font-display"
                        style={{ fontSize: depth === 0 ? '17px' : '14.5px', color: 'var(--color-char)' }}
                      >
                        {node.title || 'Untitled field'}
                      </span>
                      {node.required && (
                        <span className="text-[13px]" style={{ color: 'var(--color-gold)' }}>
                          *
                        </span>
                      )}
                    </div>
                    {node.type !== 'Section' && (
                      <div
                        className="ml-11 mt-1.5 px-2.5 py-2 text-[13px] border"
                        style={{ borderColor: '#d7d3d3', color: 'var(--color-char-soft)', backgroundColor: PAGE_BG }}
                      >
                        {FIELD_HINTS[node.type]}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
            <div className="flex justify-end mt-6">
              <button
                onClick={() => setPreviewOpen(false)}
                className="px-4 py-2 text-[13px] font-medium border rounded-[4px] hover:bg-black/[0.03]"
                style={{ borderColor: '#d7d3d3', color: 'var(--color-char)' }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors duration-150"
      style={{ color: 'var(--color-char-soft)' }}
      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--color-gold)')}
      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--color-char-soft)')}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square">
        <path d="M18 4 8 12l10 8" />
      </svg>
      Log templates
    </button>
  )
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div>
      <div className="font-display text-[26px] leading-none tabular-nums" style={{ color: 'var(--color-char)' }}>
        {value}
      </div>
      <div className="mt-1 text-[10.5px] uppercase tracking-[0.06em]" style={{ color: 'var(--color-char-soft)' }}>
        {label}
      </div>
    </div>
  )
}
