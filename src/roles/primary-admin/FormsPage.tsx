import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { PrimaryAdminShell } from './shell/PrimaryAdminShell'
import { Card, Badge, GhostButton, Modal, PrimaryButton, Skeleton, Field, inputClass } from './shell/ui'
import { Icon } from './shell/Icon'
import { watchAllFormTemplates, createFormTemplate, updateFormTemplate, deleteFormTemplate } from '../../lib/firestore/facultyForms'
import { watchInstitutions } from '../../lib/firestore/institutions'
import { PRESET_LABELS, getPresetFields } from '../../lib/facultyFormPresets'
import type { FacultyFormTemplate, FacultyFormType, Institution } from '../../types'

const FORM_TYPES: FacultyFormType[] = ['CBD', 'MiniCEX', 'OSCE', 'Custom']

// Module 05 "Forms Management" — faculty-initiated path, independent of
// the SSL submission/review pipeline. This is the catalog list — same
// role CompetenciesPage plays for competencies: a card grid linking into
// a dedicated editor page (FormEditorPage.tsx) rather than editing
// anything in a modal here. Primary Admin creates a form from one of the
// three preset structures or a blank Custom canvas (facultyFormPresets.ts),
// then lands straight in the editor to build it out and turn it on for
// whichever colleges should have it.
export function PrimaryAdminFormsPage() {
  const { appUser } = useAuth()
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<FacultyFormTemplate[] | null>(null)
  useEffect(() => watchAllFormTemplates(setTemplates), [])
  const [institutions, setInstitutions] = useState<Institution[]>([])
  useEffect(() => watchInstitutions(setInstitutions), [])

  const [creating, setCreating] = useState(false)
  const [newType, setNewType] = useState<FacultyFormType>('CBD')
  const [newTitle, setNewTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [collegesForId, setCollegesForId] = useState<string | null>(null)
  const [collegeSearch, setCollegeSearch] = useState('')
  const collegesTarget = (templates ?? []).find((t) => t.id === collegesForId) ?? null
  const filteredInstitutions = institutions.filter((inst) => inst.name.toLowerCase().includes(collegeSearch.trim().toLowerCase()))

  function closeCollegesModal() {
    setCollegesForId(null)
    setCollegeSearch('')
  }

  async function handleCreate() {
    if (!appUser || !newTitle.trim()) return
    setSaving(true)
    try {
      const id = await createFormTemplate({
        formType: newType,
        title: newTitle.trim(),
        fields: getPresetFields(newType),
        enabledInstitutionIds: [],
        createdBy: appUser.uid,
      })
      setCreating(false)
      setNewTitle('')
      navigate(`/admin/forms/${id}`)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    setConfirmDeleteId(null)
    await deleteFormTemplate(id)
  }

  async function toggleCollege(template: FacultyFormTemplate, institutionId: string) {
    const enabled = template.enabledInstitutionIds.includes(institutionId)
    await updateFormTemplate(template.id, {
      enabledInstitutionIds: enabled
        ? template.enabledInstitutionIds.filter((id) => id !== institutionId)
        : [...template.enabledInstitutionIds, institutionId],
    })
  }

  async function selectAllColleges(template: FacultyFormTemplate) {
    await updateFormTemplate(template.id, { enabledInstitutionIds: institutions.map((inst) => inst.id) })
  }

  async function deselectAllColleges(template: FacultyFormTemplate) {
    await updateFormTemplate(template.id, { enabledInstitutionIds: [] })
  }

  const loading = templates === null

  return (
    <PrimaryAdminShell
      eyebrow="Content"
      title="Forms"
      actions={
        <PrimaryButton onClick={() => setCreating(true)}>
          <Icon name="plus" className="h-3.5 w-3.5" />
          New form
        </PrimaryButton>
      }
    >
      <p className="text-[13px] mb-6" style={{ color: 'var(--color-char-soft)' }}>
        Faculty-initiated assessment forms (CBD, Mini-CEX, OSCE, or a form you design yourself) —
        independent of the SSL submission review flow. Turn a form on for a college and faculty
        there can send it directly to a student.
      </p>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          <Skeleton className="h-36 rounded-[10px]" />
          <Skeleton className="h-36 rounded-[10px]" />
        </div>
      ) : templates.length === 0 ? (
        <Card className="chamfer max-w-lg">
          <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            No form templates yet — create one from a preset, or start from a blank Custom form.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {templates.map((t, i) => (
            <div
              key={t.id}
              className="fade-up rounded-[10px] border p-5 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-14px_rgba(11,18,32,0.35)] hover:border-[var(--color-gold-line)]"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)',
                borderColor: 'var(--color-line)',
                animationDelay: `${i * 30}ms`,
              }}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <Badge tone="gold">{t.formType}</Badge>
                {confirmDeleteId === t.id ? (
                  <div className="flex items-center gap-1.5 text-[11px]">
                    <button onClick={() => handleDelete(t.id)} className="font-medium" style={{ color: 'var(--color-clay)' }}>
                      Remove
                    </button>
                    <button onClick={() => setConfirmDeleteId(null)} style={{ color: 'var(--color-char-soft)' }}>
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setConfirmDeleteId(t.id)}
                      title="Remove"
                      className="h-6 w-6 flex items-center justify-center rounded-[3px] hover:bg-black/[0.06]"
                      style={{ color: 'var(--color-char-soft)' }}
                    >
                      <Icon name="trash" className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
              <button onClick={() => navigate(`/admin/forms/${t.id}`)} className="block text-left w-full">
                <div className="font-display text-[18px] leading-snug mb-1" style={{ color: 'var(--color-char)' }}>
                  {t.title}
                </div>
                <div className="text-[12px] mb-4" style={{ color: 'var(--color-char-soft)' }}>
                  {t.fields.length} fields · {t.enabledInstitutionIds.length} college{t.enabledInstitutionIds.length === 1 ? '' : 's'} enabled
                </div>
              </button>

              <div className="flex items-center gap-2">
                <GhostButton onClick={() => navigate(`/admin/forms/${t.id}`)}>
                  <Icon name="edit" className="h-3.5 w-3.5" />
                  Edit
                </GhostButton>
                <button
                  onClick={() => setCollegesForId(t.id)}
                  title="Edit colleges"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium border rounded-[3px] transition-colors duration-150 hover:bg-black/[0.04]"
                  style={{ borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)' }}
                >
                  <Icon name="institutions" className="h-[18px] w-[18px]" />
                  Colleges
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <Modal title="New form" onClose={() => setCreating(false)}>
          <Field label="Form type">
            <select
              value={newType}
              onChange={(e) => setNewType(e.target.value as FacultyFormType)}
              className={inputClass}
              style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
            >
              {FORM_TYPES.map((type) => (
                <option key={type} value={type}>
                  {PRESET_LABELS[type]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Title">
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder={newType === 'Custom' ? 'e.g. Ward Round Assessment' : PRESET_LABELS[newType]}
              className={inputClass}
              style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
            />
          </Field>
          <p className="text-[12px] mb-4" style={{ color: 'var(--color-char-soft)' }}>
            {newType === 'Custom'
              ? 'Starts blank — build it section by section in the editor after creating.'
              : `Starts from the standard ${PRESET_LABELS[newType]} field structure — opens straight into the editor to adjust it.`}
          </p>
          <div className="flex justify-end gap-2">
            <GhostButton onClick={() => setCreating(false)}>Cancel</GhostButton>
            <PrimaryButton onClick={handleCreate} disabled={saving || !newTitle.trim()}>
              {saving ? 'Creating…' : 'Create'}
            </PrimaryButton>
          </div>
        </Modal>
      )}

      {collegesTarget && (
        <Modal title={`Colleges — ${collegesTarget.title}`} onClose={closeCollegesModal} wide>
          <div className="flex items-center justify-between mb-3">
            <span className="text-[12px]" style={{ color: 'var(--color-char-soft)' }}>
              {collegesTarget.enabledInstitutionIds.length} of {institutions.length} enabled
            </span>
            <div className="flex items-center gap-3">
              <button
                onClick={() => selectAllColleges(collegesTarget)}
                disabled={institutions.length === 0}
                className="text-[12px] font-medium disabled:opacity-40"
                style={{ color: 'var(--color-gold)' }}
              >
                Select all
              </button>
              <button
                onClick={() => deselectAllColleges(collegesTarget)}
                disabled={collegesTarget.enabledInstitutionIds.length === 0}
                className="text-[12px] font-medium disabled:opacity-40"
                style={{ color: 'var(--color-char-soft)' }}
              >
                Deselect all
              </button>
            </div>
          </div>

          {institutions.length > 0 && (
            <div className="relative mb-3">
              <Icon
                name="search"
                className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2"
                style={{ color: 'var(--color-char-soft)' }}
              />
              <input
                value={collegeSearch}
                onChange={(e) => setCollegeSearch(e.target.value)}
                placeholder="Search colleges…"
                className={inputClass}
                style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)', paddingLeft: '2.5rem', height: '44px', fontSize: '14px' }}
              />
            </div>
          )}

          {institutions.length === 0 ? (
            <p className="text-[12.5px] mb-4" style={{ color: 'var(--color-char-soft)' }}>
              No institutions exist yet.
            </p>
          ) : filteredInstitutions.length === 0 ? (
            <p className="text-[12.5px] mb-4" style={{ color: 'var(--color-char-soft)' }}>
              No colleges match "{collegeSearch}".
            </p>
          ) : (
            <div className="rounded-[8px] border overflow-hidden mb-4 max-h-[420px] overflow-y-auto" style={{ borderColor: 'var(--color-line)' }}>
              {filteredInstitutions.map((inst, i) => {
                const on = collegesTarget.enabledInstitutionIds.includes(inst.id)
                return (
                  <label
                    key={inst.id}
                    className="flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-colors duration-150 hover:bg-black/[0.03]"
                    style={{ borderTop: i > 0 ? '1px solid var(--color-line)' : undefined }}
                  >
                    <input type="checkbox" checked={on} onChange={() => toggleCollege(collegesTarget, inst.id)} className="h-4 w-4" />
                    <span className="text-[14.5px] flex-1 min-w-0 truncate" style={{ color: 'var(--color-char)' }}>
                      {inst.name}
                    </span>
                    {on && (
                      <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] shrink-0" style={{ color: 'var(--color-gold)' }}>
                        Enabled
                      </span>
                    )}
                  </label>
                )
              })}
            </div>
          )}

          <div className="flex justify-end">
            <PrimaryButton onClick={closeCollegesModal}>Done</PrimaryButton>
          </div>
        </Modal>
      )}
    </PrimaryAdminShell>
  )
}
