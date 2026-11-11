import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { PrimaryAdminShell } from './shell/PrimaryAdminShell'
import { GhostButton, PrimaryButton, Skeleton, Badge } from './shell/ui'
import { Icon } from './shell/Icon'
import { StandardFormPreview } from '../../components/formEngine/StandardFormPreview'
import { watchFormTemplate, updateFormTemplate, deleteFormTemplate } from '../../lib/firestore/facultyForms'
import { watchInstitutions } from '../../lib/firestore/institutions'
import { PRESET_LABELS } from '../../lib/facultyFormPresets'
import type { FacultyFormTemplate, FormField, FormFieldType, Institution } from '../../types'

const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  text: 'Short text',
  textarea: 'Long text',
  number: 'Number',
  date: 'Date',
  dropdown: 'Dropdown',
  checkbox: 'Checkbox group',
  rating: 'Rating scale',
}

// Same "merges with the page, defined by its border" treatment
// CompetencyEditorPage uses instead of a white-fill card.
const BORDER = 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)'
const SECTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']

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

// A section only exists in this editor's local state (EditorSection, keyed
// by a synthetic `key` independent of its display `name` so renaming never
// loses identity) — flattened back to FormField[] (each field stamped with
// `section: name`) only on save. Mirrors CompetencyEditorPage's own
// sections-are-local-state-until-save shape, adapted since these forms
// have no step-N/remark id convention to parse/serialize around.
type EditorField = FormField
interface EditorSection {
  key: string
  name: string
  fields: EditorField[]
}

function groupIntoSections(fields: FormField[]): EditorSection[] {
  const sections: EditorSection[] = []
  for (const field of fields) {
    const name = field.section || 'Untitled Section'
    let bucket = sections.find((s) => s.name === name)
    if (!bucket) {
      bucket = { key: crypto.randomUUID(), name, fields: [] }
      sections.push(bucket)
    }
    bucket.fields.push(field)
  }
  return sections
}

function flattenSections(sections: EditorSection[]): FormField[] {
  return sections.flatMap((s) => s.fields.map((f) => ({ ...f, section: s.name })))
}

function newField(): EditorField {
  return { id: crypto.randomUUID(), type: 'text', label: '', required: false, options: null, maxRating: null }
}

// A dedicated page (not a modal) for building one Faculty Form's
// structure — same design language as PrimaryAdminCompetencyEditorPage:
// numbered StepHeader kickers, bordered-on-paper cards (not raised
// white), lettered section blocks with reorderable fields, a live
// preview overlay, and an inline (not native confirm()) delete at the
// bottom. Reachable from the Forms page's "Edit" action.
export function PrimaryAdminFormEditorPage() {
  const { templateId } = useParams<{ templateId: string }>()
  const navigate = useNavigate()

  const [template, setTemplate] = useState<FacultyFormTemplate | null | undefined>(undefined)
  useEffect(() => {
    if (!templateId) return
    return watchFormTemplate(templateId, setTemplate)
  }, [templateId])

  const [institutions, setInstitutions] = useState<Institution[]>([])
  useEffect(() => watchInstitutions(setInstitutions), [])

  const [title, setTitle] = useState('')
  const [enabledInstitutionIds, setEnabledInstitutionIds] = useState<string[]>([])
  const [sections, setSections] = useState<EditorSection[]>([])
  const [loaded, setLoaded] = useState(false)
  const [lastAddedFieldId, setLastAddedFieldId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)

  useEffect(() => {
    if (template === undefined) return
    if (template === null) {
      setLoaded(true)
      return
    }
    // Only hydrate local editor state the first time this template loads
    // — not on every snapshot tick, or a background re-fetch mid-edit
    // would silently clobber unsaved changes. Same guard
    // CompetencyEditorPage uses.
    if (!loaded) {
      setTitle(template.title)
      setEnabledInstitutionIds(template.enabledInstitutionIds)
      setSections(groupIntoSections(template.fields))
      setLoaded(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template, loaded])

  const notFound = template === null || !templateId
  const loading = template === undefined || !loaded

  const previewFields = useMemo(() => flattenSections(sections), [sections])
  const totalFields = previewFields.length

  function addSection() {
    setSections((prev) => [...prev, { key: crypto.randomUUID(), name: `Section ${prev.length + 1}`, fields: [] }])
  }
  function removeSection(key: string) {
    setSections((prev) => prev.filter((s) => s.key !== key))
  }
  function renameSection(key: string, name: string) {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, name } : s)))
  }
  function addField(sectionKey: string) {
    const field = newField()
    setSections((prev) => prev.map((s) => (s.key === sectionKey ? { ...s, fields: [...s.fields, field] } : s)))
    setLastAddedFieldId(field.id)
  }
  function updateField(sectionKey: string, fieldId: string, patch: Partial<FormField>) {
    setSections((prev) =>
      prev.map((s) => (s.key === sectionKey ? { ...s, fields: s.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f)) } : s)),
    )
  }
  function removeField(sectionKey: string, fieldId: string) {
    setSections((prev) => prev.map((s) => (s.key === sectionKey ? { ...s, fields: s.fields.filter((f) => f.id !== fieldId) } : s)))
  }
  function moveField(sectionKey: string, index: number, dir: -1 | 1) {
    setSections((prev) =>
      prev.map((s) => {
        if (s.key !== sectionKey) return s
        const fs = [...s.fields]
        const target = index + dir
        if (target < 0 || target >= fs.length) return s
        ;[fs[index], fs[target]] = [fs[target], fs[index]]
        return { ...s, fields: fs }
      }),
    )
  }
  function toggleInstitution(id: string) {
    setEnabledInstitutionIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function handleSave() {
    if (!templateId) return
    setSaving(true)
    try {
      await updateFormTemplate(templateId, { title: title.trim(), enabledInstitutionIds, fields: flattenSections(sections) })
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!templateId) return
    setSaving(true)
    await deleteFormTemplate(templateId)
    navigate('/admin/forms')
  }

  return (
    <PrimaryAdminShell
      eyebrow="Content · Forms"
      title={loading ? 'Loading…' : notFound ? 'Not found' : title || 'Untitled form'}
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
          onClick={() => navigate('/admin/forms')}
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium mb-5 hover:opacity-70 transition-opacity"
          style={{ color: 'var(--color-char-soft)' }}
        >
          <Icon name="chevron" className="h-3 w-3 rotate-180" />
          All forms
        </button>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-14" />
            <Skeleton className="h-32" />
            <Skeleton className="h-32" />
          </div>
        ) : notFound ? (
          <div className="rounded-[10px] border p-5" style={{ backgroundColor: 'var(--color-paper)', borderColor: BORDER }}>
            <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
              This form doesn't exist or you don't have access to it.
            </p>
          </div>
        ) : (
          <>
            <StepHeader step="01" title="Identity" hint="What this form is, and which colleges have it turned on." />
            <div className="rounded-[10px] border p-5 mb-9" style={{ backgroundColor: 'var(--color-paper)', borderColor: BORDER }}>
              <div className="flex items-center gap-2.5 mb-4">
                <Badge tone="gold">{PRESET_LABELS[template!.formType]}</Badge>
              </div>
              <label
                className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]"
                style={{ color: 'var(--color-char-soft)' }}
              >
                Form title
              </label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full font-display text-[22px] outline-none bg-transparent pb-4 mb-5 border-b"
                style={{ color: 'var(--color-char)', borderColor: BORDER }}
                placeholder="e.g. Case-Based Discussion (CBD)"
              />

              <label
                className="font-display block mb-2 text-[11.5px] font-medium uppercase tracking-[0.08em]"
                style={{ color: 'var(--color-char-soft)' }}
              >
                Enabled colleges
              </label>
              {institutions.length === 0 ? (
                <p className="text-[12.5px]" style={{ color: 'var(--color-char-soft)' }}>
                  No institutions exist yet.
                </p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {institutions.map((inst) => {
                    const active = enabledInstitutionIds.includes(inst.id)
                    return (
                      <button
                        key={inst.id}
                        onClick={() => toggleInstitution(inst.id)}
                        className="px-3 py-1.5 text-[12.5px] font-medium border rounded-full transition-colors duration-150"
                        style={{
                          borderColor: active ? 'var(--color-ink)' : 'var(--color-line)',
                          backgroundColor: active ? 'var(--color-ink)' : 'transparent',
                          color: active ? 'var(--color-frost)' : 'var(--color-char-soft)',
                        }}
                      >
                        {inst.name}
                      </button>
                    )
                  })}
                </div>
              )}
              <p className="mt-3 text-[12px] leading-relaxed" style={{ color: 'var(--color-char-soft)' }}>
                Faculty at an enabled college will see this form in their own Forms section.
              </p>
            </div>

            <StepHeader
              step="02"
              title="Sections & Fields"
              hint={`${totalFields} field${totalFields === 1 ? '' : 's'} across ${sections.length} section${sections.length === 1 ? '' : 's'}`}
            />

            <div className="space-y-4">
              {sections.map((section, si) => (
                <SectionBox
                  key={section.key}
                  section={section}
                  letter={SECTION_LETTERS[si] ?? String(si + 1)}
                  lastAddedFieldId={lastAddedFieldId}
                  onRename={(name) => renameSection(section.key, name)}
                  onRemove={() => removeSection(section.key)}
                  onAddField={() => addField(section.key)}
                  onFieldChange={(fid, patch) => updateField(section.key, fid, patch)}
                  onFieldRemove={(fid) => removeField(section.key, fid)}
                  onFieldMove={(fi, dir) => moveField(section.key, fi, dir)}
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

            <div className="mt-8 pt-5 border-t" style={{ borderColor: BORDER }}>
              {confirmDelete ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[12.5px]" style={{ color: 'var(--color-clay)' }}>
                    Remove <span className="font-medium">"{title}"</span>? Every form faculty have already sent from it stays
                    intact — only this template is removed, and it can no longer be sent again.
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <GhostButton tone="danger" onClick={handleDelete}>
                      {saving ? 'Removing…' : 'Remove'}
                    </GhostButton>
                    <GhostButton onClick={() => setConfirmDelete(false)}>Cancel</GhostButton>
                  </div>
                </div>
              ) : (
                <button onClick={() => setConfirmDelete(true)} className="text-[12.5px] font-medium" style={{ color: 'var(--color-clay)' }}>
                  Remove this form
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {previewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 py-10"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 55%, transparent)' }}
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPreviewOpen(false)
          }}
        >
          <div className="w-full max-w-[860px] rounded-[10px] overflow-hidden fade-up" style={{ maxHeight: '90vh' }}>
            <div
              className="flex items-center justify-between gap-3 px-5 py-3 shrink-0"
              style={{ backgroundColor: 'var(--color-paper)', borderBottom: '1px solid var(--color-gold-line)' }}
            >
              <span
                className="text-[10.5px] font-semibold uppercase tracking-[0.1em] truncate"
                style={{ color: 'var(--color-char-soft)', fontFamily: 'var(--font-mono)' }}
              >
                Preview · what faculty will fill in
              </span>
              <button
                onClick={() => setPreviewOpen(false)}
                title="Close (Esc)"
                className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] transition-colors shrink-0"
                style={{
                  color: 'var(--color-char-soft)',
                  fontFamily: 'var(--font-mono)',
                  border: '1px solid var(--color-line)',
                  borderRadius: 999,
                  padding: '6px 14px 6px 12px',
                  backgroundColor: 'var(--color-paper-raised)',
                }}
              >
                <Icon name="close" style={{ width: 11, height: 11 }} />
                Esc
              </button>
            </div>
            <div style={{ maxHeight: 'calc(90vh - 54px)', overflowY: 'auto', backgroundColor: 'var(--color-paper-raised)', padding: '0 24px' }}>
              {previewFields.length === 0 ? (
                <p className="py-8 text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
                  No fields yet.
                </p>
              ) : (
                <StandardFormPreview title={title || 'Untitled form'} fields={previewFields} mode="review" value={{}} />
              )}
            </div>
          </div>
        </div>
      )}
    </PrimaryAdminShell>
  )
}

function SectionBox({
  section,
  letter,
  lastAddedFieldId,
  onRename,
  onRemove,
  onAddField,
  onFieldChange,
  onFieldRemove,
  onFieldMove,
}: {
  section: EditorSection
  letter: string
  lastAddedFieldId: string | null
  onRename: (name: string) => void
  onRemove: () => void
  onAddField: () => void
  onFieldChange: (fieldId: string, patch: Partial<FormField>) => void
  onFieldRemove: (fieldId: string) => void
  onFieldMove: (index: number, dir: -1 | 1) => void
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
          {section.fields.length} field{section.fields.length === 1 ? '' : 's'}
        </span>
        <button
          onClick={onRemove}
          title="Remove section"
          className="shrink-0 h-7 w-7 flex items-center justify-center rounded-[3px] hover:bg-black/[0.06]"
          style={{ color: 'var(--color-clay)' }}
        >
          <Icon name="trash" className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="p-4 space-y-3">
        {section.fields.map((field, fi) => (
          <FieldCard
            key={field.id}
            field={field}
            index={fi}
            total={section.fields.length}
            autoFocus={field.id === lastAddedFieldId}
            onChange={(patch) => onFieldChange(field.id, patch)}
            onRemove={() => onFieldRemove(field.id)}
            onMove={(dir) => onFieldMove(fi, dir)}
          />
        ))}

        <button onClick={onAddField} className="text-[12.5px] font-medium" style={{ color: 'var(--color-gold)' }}>
          + Add field
        </button>
      </div>
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div
      ref={containerRef}
      className="rounded-[8px] border p-3.5 transition-shadow duration-500"
      style={{
        borderColor: autoFocus ? 'var(--color-gold-line)' : 'var(--color-line)',
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

// Same vertical, ledger-style options list as CompetencyEditorPage's own
// local OptionsEditor (duplicated rather than shared — a small view
// helper local to each editor, same convention that file's own comments
// document for its two-line formatting helpers elsewhere in this app).
function OptionsEditor({ options, onChange }: { options: string[]; onChange: (options: string[]) => void }) {
  return (
    <div className="rounded-[8px] border overflow-hidden" style={{ borderColor: 'var(--color-line)' }}>
      {options.map((opt, i) => (
        <div
          key={i}
          className="group flex items-center gap-2.5 px-3 py-2"
          style={{ borderBottom: i < options.length - 1 ? '1px solid var(--color-line)' : undefined }}
        >
          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: 'var(--color-gold)' }} />
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
