import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { InstitutionAdminShell } from './shell/InstitutionAdminShell'
import { SaveChangesBar, SubTabBar, ToggleRow } from './shell/toggleUi'
import { ToggleSwitch } from '../primary-admin/shell/VideoShared'
import { Card, Field, GhostButton, Modal, PrimaryButton, Skeleton, inputClass } from '../primary-admin/shell/ui'
import { Icon } from '../primary-admin/shell/Icon'
import {
  watchCatalogDepartments,
  watchInstitutionDepartments,
  watchInstitutionDepartmentOverrides,
  setDepartmentEnabledForInstitution,
  createDepartment,
  updateDepartment,
  deleteDepartment,
} from '../../lib/firestore/departments'
import { MBBS_YEARS } from '../../lib/academicStructure'
import type { Department, InstitutionDepartmentOverride, MbbsYear } from '../../types'

type SubTab = 'catalog' | 'own'

function groupByYear(depts: Department[]): { year: MbbsYear; depts: Department[] }[] {
  return MBBS_YEARS.map((year) => ({
    year,
    depts: depts.filter((d) => d.mbbsYear === year).sort((a, b) => a.name.localeCompare(b.name)),
  })).filter((g) => g.depts.length > 0)
}

export function InstitutionAdminDepartmentsPage() {
  const { appUser } = useAuth()
  const institutionId = appUser?.institutionId ?? null

  const [subTab, setSubTab] = useState<SubTab>('catalog')
  const [search, setSearch] = useState('')
  const [yearFilter, setYearFilter] = useState<MbbsYear | 'all'>('all')

  const [catalogDepartments, setCatalogDepartments] = useState<Department[] | null>(null)
  const [ownDepartments, setOwnDepartments] = useState<Department[] | null>(null)
  const [overrides, setOverrides] = useState<InstitutionDepartmentOverride[] | null>(null)
  const [draft, setDraft] = useState<Record<string, boolean>>({})
  const [savingChanges, setSavingChanges] = useState(false)

  const [formTarget, setFormTarget] = useState<'create' | Department | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [formYear, setFormYear] = useState<MbbsYear>(1)
  const [saving, setSaving] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => watchCatalogDepartments(setCatalogDepartments), [])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionDepartments(institutionId, setOwnDepartments)
  }, [institutionId])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionDepartmentOverrides(institutionId, setOverrides)
  }, [institutionId])

  const loading = !catalogDepartments || !ownDepartments || !overrides

  function isEnabled(departmentId: string): boolean {
    if (departmentId in draft) return draft[departmentId]
    const override = overrides?.find((o) => o.departmentId === departmentId)
    return override ? override.enabled : true
  }

  function stageToggle(departmentId: string) {
    setDraft((prev) => ({ ...prev, [departmentId]: !isEnabled(departmentId) }))
  }

  function stageGroupAll(depts: Department[], enabled: boolean) {
    setDraft((prev) => {
      const next = { ...prev }
      depts.forEach((d) => (next[d.id] = enabled))
      return next
    })
  }

  async function saveChanges() {
    if (!institutionId) return
    setSavingChanges(true)
    await Promise.all(
      Object.entries(draft).map(([departmentId, enabled]) => setDepartmentEnabledForInstitution(institutionId, departmentId, enabled)),
    )
    setDraft({})
    setSavingChanges(false)
  }

  const filtered = useMemo(() => {
    const list = subTab === 'catalog' ? (catalogDepartments ?? []) : (ownDepartments ?? [])
    const q = search.trim().toLowerCase()
    return list.filter((d) => (q === '' || d.name.toLowerCase().includes(q)) && (yearFilter === 'all' || d.mbbsYear === yearFilter))
  }, [subTab, catalogDepartments, ownDepartments, search, yearFilter])

  const grouped = groupByYear(filtered)
  const includedCatalogCount = (catalogDepartments ?? []).filter((d) => isEnabled(d.id)).length

  function openCreate() {
    setName('')
    setDescription('')
    setFormYear(1)
    setFormTarget('create')
  }
  function openEdit(d: Department) {
    setName(d.name)
    setDescription(d.description)
    setFormYear(d.mbbsYear)
    setFormTarget(d)
  }
  const isEditingDept = formTarget !== null && formTarget !== 'create'

  async function handleSubmit() {
    if (!name.trim() || !institutionId) return
    setSaving(true)
    if (isEditingDept) {
      await updateDepartment((formTarget as Department).id, { name: name.trim(), description: description.trim(), mbbsYear: formYear })
    } else {
      await createDepartment({ institutionId, name: name.trim(), description: description.trim(), mbbsYear: formYear })
    }
    setSaving(false)
    setFormTarget(null)
  }

  return (
    <InstitutionAdminShell
      eyebrow="Academic structure"
      title="Departments"
      actions={
        subTab === 'own' ? (
          <PrimaryButton onClick={openCreate}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            New department
          </PrimaryButton>
        ) : undefined
      }
    >
      <SubTabBar
        value={subTab}
        onChange={setSubTab}
        options={[
          { v: 'catalog', label: 'Catalog departments' },
          { v: 'own', label: 'Institution-only departments' },
        ]}
      />

      <div className="flex items-center gap-2.5 flex-wrap mb-5">
        <div className="relative flex-1 min-w-[200px]">
          <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: 'var(--color-char-soft)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search departments"
            className={`${inputClass} pl-8`}
            style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
          />
        </div>
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
      </div>

      <SaveChangesBar pendingCount={Object.keys(draft).length} saving={savingChanges} onSave={saveChanges} onDiscard={() => setDraft({})} />

      {subTab === 'catalog' && (
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            {includedCatalogCount} of {catalogDepartments?.length ?? 0} catalog departments included
          </div>
          {(catalogDepartments?.length ?? 0) > 0 && (
            <div className="flex gap-2">
              <button onClick={() => stageGroupAll(catalogDepartments ?? [], true)} className="text-[11.5px] font-medium hover:opacity-70 transition-opacity" style={{ color: 'var(--color-gold)' }}>
                Select all
              </button>
              <button onClick={() => stageGroupAll(catalogDepartments ?? [], false)} className="text-[11.5px] font-medium hover:opacity-70 transition-opacity" style={{ color: 'var(--color-char-soft)' }}>
                Deselect all
              </button>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : grouped.length === 0 ? (
        <Card className="chamfer max-w-lg">
          <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            {subTab === 'catalog'
              ? 'No catalog departments match your filters.'
              : "No institution-only departments yet — they're exclusive to your institution, not part of the shared catalog."}
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-8">
          {grouped.map(({ year, depts }) => (
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
              {subTab === 'catalog' ? (
                <div className="border rounded-[10px] overflow-hidden" style={{ backgroundColor: 'var(--color-paper)', borderColor: 'var(--color-line)' }}>
                  {depts.map((d, i) => (
                    <ToggleRow
                      key={d.id}
                      title={d.name}
                      description={d.description}
                      enabled={isEnabled(d.id)}
                      onToggle={() => stageToggle(d.id)}
                      isLast={i === depts.length - 1}
                    />
                  ))}
                </div>
              ) : (
                <div className="border rounded-[10px] overflow-hidden" style={{ backgroundColor: 'var(--color-paper)', borderColor: 'var(--color-line)' }}>
                  {depts.map((d, i) => {
                    const enabled = isEnabled(d.id)
                    return (
                    <div
                      key={d.id}
                      className="flex items-center gap-4 px-4 py-3"
                      style={{ borderBottom: i === depts.length - 1 ? undefined : '1px solid color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)' }}
                    >
                      <ToggleSwitch on={enabled} onChange={() => stageToggle(d.id)} label={enabled ? 'Included — click to exclude' : 'Excluded — click to include'} />
                      <div className="min-w-0 flex-1">
                        <div className="font-display text-[16px] leading-snug truncate" style={{ color: enabled ? 'var(--color-char)' : 'var(--color-char-soft)' }}>
                          {d.name}
                        </div>
                        {d.description && (
                          <div className="text-[11.5px] mt-0.5 truncate" style={{ color: 'var(--color-char-soft)' }}>
                            {d.description}
                          </div>
                        )}
                      </div>
                      {confirmDeleteId === d.id ? (
                        <div className="flex items-center gap-2 shrink-0">
                          <GhostButton tone="danger" onClick={() => deleteDepartment(d.id).then(() => setConfirmDeleteId(null))}>
                            Confirm
                          </GhostButton>
                          <GhostButton onClick={() => setConfirmDeleteId(null)}>Cancel</GhostButton>
                        </div>
                      ) : (
                        <div className="flex gap-0.5 shrink-0">
                          <button onClick={() => openEdit(d)} title="Edit" className="h-6 w-6 flex items-center justify-center hover:bg-black/[0.06]" style={{ color: 'var(--color-char-soft)' }}>
                            <Icon name="edit" className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => setConfirmDeleteId(d.id)} title="Delete" className="h-6 w-6 flex items-center justify-center hover:bg-black/[0.06]" style={{ color: 'var(--color-clay)' }}>
                            <Icon name="trash" className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                    )
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {formTarget && (
        <Modal title={isEditingDept ? 'Edit department' : 'New department'} onClose={() => setFormTarget(null)}>
          <Field label="MBBS year">
            <select className={inputClass} style={{ borderColor: 'var(--color-line)' }} value={formYear} onChange={(e) => setFormYear(Number(e.target.value) as MbbsYear)}>
              {MBBS_YEARS.map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Department name">
            <input autoFocus className={inputClass} style={{ borderColor: 'var(--color-line)' }} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Anatomy" />
          </Field>
          <Field label="Description (optional)">
            <textarea className={`${inputClass} resize-none`} style={{ borderColor: 'var(--color-line)' }} rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2 mt-2">
            <PrimaryButton onClick={handleSubmit} disabled={!name.trim() || saving}>
              {saving ? 'Saving…' : isEditingDept ? 'Save changes' : 'Create department'}
            </PrimaryButton>
          </div>
        </Modal>
      )}
    </InstitutionAdminShell>
  )
}
