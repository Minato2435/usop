import { useMemo, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PrimaryAdminShell } from './shell/PrimaryAdminShell'
import { Card, PrimaryButton, GhostButton, Modal, Field, inputClass, Skeleton, Badge } from './shell/ui'
import { Icon } from './shell/Icon'
import { InstitutionPickerModal } from './shell/InstitutionPicker'
import { watchAllDepartments, createDepartment, updateDepartment, deleteDepartment } from '../../lib/firestore/departments'
import { MBBS_YEARS } from '../../lib/academicStructure'
import type { Department, MbbsYear } from '../../types'

type SortOrder = 'name-asc' | 'name-desc' | 'year-asc' | 'year-desc'

const SORT_LABELS: Record<SortOrder, string> = {
  'name-asc': 'Name (A → Z)',
  'name-desc': 'Name (Z → A)',
  'year-asc': 'Year (1 → 4)',
  'year-desc': 'Year (4 → 1)',
}

// Departments are authored here as a shared catalog (name + MBBS year +
// description), not tied to an institution — assigning a catalog department
// to a specific institution happens from the Institutions page instead.
export function PrimaryAdminDepartmentsPage() {
  const navigate = useNavigate()
  const [departments, setDepartments] = useState<Department[] | null>(null)

  // Jumps straight to an institution's Departments tab (Institution
  // Management portal) — its included/excluded catalog departments plus any
  // department exclusive to that institution — same "By institution"
  // pattern as the Competencies and Log Templates pages.
  const [institutionPickerOpen, setInstitutionPickerOpen] = useState(false)

  // Create/edit form — `formTarget` is null when closed, 'create' for a new
  // department, or the Department being edited.
  const [formTarget, setFormTarget] = useState<'create' | Department | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [mbbsYear, setMbbsYear] = useState<MbbsYear>(1)
  const [saving, setSaving] = useState(false)

  // Filters
  const [search, setSearch] = useState('')
  const [yearFilter, setYearFilter] = useState<MbbsYear | 'all'>('all')
  const [sortOrder, setSortOrder] = useState<SortOrder>('name-asc')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  useEffect(() => watchAllDepartments(setDepartments), [])

  // watchAllDepartments returns every department platform-wide, including
  // ones created as institution-exclusive from an institution's own portal
  // (Department.institutionId non-empty). This page is only the shared
  // catalog (institutionId === '') — institution-exclusive departments
  // belong solely on that institution's own Departments sub-tab, not here.
  const catalogDepartments = useMemo(() => (departments ?? []).filter((d) => d.institutionId === ''), [departments])

  const isEditing = formTarget !== null && formTarget !== 'create'

  function openCreate() {
    setName('')
    setDescription('')
    setMbbsYear(1)
    setFormTarget('create')
  }

  function openEdit(d: Department) {
    setName(d.name)
    setDescription(d.description)
    setMbbsYear(d.mbbsYear)
    setFormTarget(d)
  }

  function closeForm() {
    setFormTarget(null)
  }

  async function handleSubmit() {
    if (!name.trim()) return
    setSaving(true)
    if (isEditing) {
      await updateDepartment((formTarget as Department).id, {
        name: name.trim(),
        description: description.trim(),
        mbbsYear,
      })
    } else {
      await createDepartment({ institutionId: '', name: name.trim(), mbbsYear, description: description.trim() })
    }
    setSaving(false)
    closeForm()
  }

  const filtered = useMemo(() => {
    if (!departments) return []
    const q = search.trim().toLowerCase()
    return catalogDepartments.filter((d) => {
      const matchesSearch = q === '' || d.name.toLowerCase().includes(q)
      const matchesYear = yearFilter === 'all' || d.mbbsYear === yearFilter
      return matchesSearch && matchesYear
    })
  }, [departments, catalogDepartments, search, yearFilter])

  const yearsToShow = yearFilter === 'all' ? MBBS_YEARS : [yearFilter]
  const orderedYears = sortOrder === 'year-desc' ? [...yearsToShow].reverse() : yearsToShow

  function sortByName(list: Department[]): Department[] {
    const copy = [...list]
    copy.sort((a, b) => (sortOrder === 'name-desc' ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)))
    return copy
  }

  const loading = !departments
  const catalogEmpty = !loading && catalogDepartments.length === 0
  const filtersActive = search.trim() !== '' || yearFilter !== 'all'
  const noMatches = !loading && !catalogEmpty && filtered.length === 0

  const perYearCounts = useMemo(() => {
    const counts: Record<MbbsYear, number> = { 1: 0, 2: 0, 3: 0, 4: 0 }
    catalogDepartments.forEach((d) => {
      counts[d.mbbsYear] += 1
    })
    return counts
  }, [catalogDepartments])

  return (
    <PrimaryAdminShell
      eyebrow="Academic structure"
      title="Departments"
      actions={
        <div className="flex items-center gap-2">
          <GhostButton onClick={() => setInstitutionPickerOpen(true)}>
            <Icon name="institutions" className="h-3.5 w-3.5" />
            By institution
          </GhostButton>
          <PrimaryButton onClick={openCreate}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            New department
          </PrimaryButton>
        </div>
      }
    >
      {!loading && !catalogEmpty && (
        <>
          <div
            className="grid grid-cols-3 sm:grid-cols-5 border rounded-[6px] overflow-hidden mb-7 divide-x divide-y sm:divide-y-0 divide-[var(--color-line)]"
            style={{ borderColor: 'var(--color-line)' }}
          >
            <div className="px-5 py-4">
              <div className="font-display text-[28px] leading-none tabular-nums" style={{ color: 'var(--color-gold)' }}>
                {catalogDepartments.length}
              </div>
              <div className="mt-2 text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                Departments
              </div>
            </div>
            {MBBS_YEARS.map((y) => (
              <div key={y} className="px-5 py-4">
                <div className="font-display text-[28px] leading-none tabular-nums" style={{ color: 'var(--color-char)' }}>
                  {perYearCounts[y]}
                </div>
                <div className="mt-2 text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                  Year {y}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-6">
            <div className="relative w-full sm:w-[260px]">
              <Icon
                name="search"
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none"
                style={{ color: 'var(--color-char-soft)' }}
              />
              <input
                className={`${inputClass} pl-8`}
                style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search departments"
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
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : catalogEmpty ? (
        <Card className="chamfer max-w-lg">
          <p className="text-[13.5px] mb-4" style={{ color: 'var(--color-char-soft)' }}>
            No departments in the catalog yet — create one to start building the academic structure that
            institutions will draw from.
          </p>
          <PrimaryButton onClick={openCreate}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            Create the first department
          </PrimaryButton>
        </Card>
      ) : noMatches ? (
        <Card className="chamfer max-w-lg">
          <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            No departments match "{search}"{yearFilter !== 'all' ? ` in Year ${yearFilter}` : ''}.
          </p>
        </Card>
      ) : (
        <div className="space-y-8">
          {orderedYears.map((year) => {
            const forYear = sortByName(filtered.filter((d) => d.mbbsYear === year))
            if (forYear.length === 0) return null
            return (
              <div key={year}>
                <div className="flex items-center gap-2 mb-3">
                  <Badge tone="gold">Year {year}</Badge>
                  <span className="text-[11px]" style={{ color: 'var(--color-char-soft)' }}>
                    {forYear.length} department{forYear.length === 1 ? '' : 's'}
                  </span>
                </div>
                {viewMode === 'grid' ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {forYear.map((d, i) => (
                      <DepartmentCard
                        key={d.id}
                        department={d}
                        index={i}
                        onEdit={() => openEdit(d)}
                        onDelete={() => deleteDepartment(d.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div
                    className="border rounded-[10px] overflow-hidden"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)', borderColor: 'var(--color-line)' }}
                  >
                    {forYear.map((d, i) => (
                      <DepartmentListRow
                        key={d.id}
                        department={d}
                        isLast={i === forYear.length - 1}
                        onEdit={() => openEdit(d)}
                        onDelete={() => deleteDepartment(d.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {formTarget && (
        <Modal title={isEditing ? 'Edit department' : 'New department'} onClose={closeForm}>
          <Field label="MBBS year">
            <select
              className={inputClass}
              style={{ borderColor: 'var(--color-line)' }}
              value={mbbsYear}
              onChange={(e) => setMbbsYear(Number(e.target.value) as MbbsYear)}
            >
              {MBBS_YEARS.map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Department name">
            <input
              autoFocus
              className={inputClass}
              style={{ borderColor: 'var(--color-line)' }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Anatomy"
            />
          </Field>
          <Field label="Description (optional)">
            <textarea
              className={`${inputClass} resize-none`}
              style={{ borderColor: 'var(--color-line)' }}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this department covers, for the admins and faculty who'll see it."
            />
          </Field>
          <div className="flex justify-end gap-2 mt-2">
            <PrimaryButton onClick={handleSubmit} disabled={!name.trim() || saving}>
              {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create department'}
            </PrimaryButton>
          </div>
        </Modal>
      )}

      {institutionPickerOpen && (
        <InstitutionPickerModal
          title="Open an institution's departments"
          description="Pick an institution to see which catalog departments are included for them, plus any department exclusive to that institution."
          onClose={() => setInstitutionPickerOpen(false)}
          onSelect={(inst) => navigate(`/admin/institutions/${inst.id}?tab=departments`)}
        />
      )}
    </PrimaryAdminShell>
  )
}

function DepartmentCard({
  department,
  index,
  onEdit,
  onDelete,
}: {
  department: Department
  index: number
  onEdit: () => void
  onDelete: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)

  return (
    <div
      className={`fade-up group relative rounded-[10px] border p-5 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-14px_rgba(11,18,32,0.35)] ${
        confirming ? 'border-[var(--color-clay)]' : 'border-[var(--color-line)] hover:border-[var(--color-gold-line)]'
      }`}
      style={{
        backgroundColor: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)',
        animationDelay: `${index * 35}ms`,
      }}
    >
      {confirming ? (
        <>
          <p className="text-[12.5px] leading-relaxed mb-3" style={{ color: 'var(--color-clay)' }}>
            Remove <span className="font-medium">"{department.name}"</span>? This can't be undone.
          </p>
          <div className="flex gap-2">
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
        </>
      ) : (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 font-display text-[17px] leading-snug break-words" style={{ color: 'var(--color-char)' }}>
              {department.name}
            </div>
            <div className="flex gap-0.5 shrink-0 opacity-70 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
              <IconButton icon="edit" title="Edit department" onClick={onEdit} />
              <IconButton icon="trash" title="Remove department" tone="danger" onClick={() => setConfirming(true)} />
            </div>
          </div>
          <div className="mt-2">
            <span
              className="inline-flex items-center font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] px-1.5 py-0.5 rounded-[4px]"
              style={{ color: 'var(--color-gold)', backgroundColor: 'color-mix(in srgb, var(--color-gold) 14%, transparent)' }}
            >
              Year {department.mbbsYear}
            </span>
          </div>
          <div className="my-3.5 h-px" style={{ backgroundColor: 'var(--color-line)' }} />
          <p
            className="text-[13px] leading-relaxed"
            style={{
              color: 'var(--color-char-soft)',
              opacity: department.description ? 1 : 0.55,
              fontStyle: department.description ? 'normal' : 'italic',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {department.description || 'No description provided.'}
          </p>
        </>
      )}
    </div>
  )
}

function DepartmentListRow({
  department,
  isLast,
  onEdit,
  onDelete,
}: {
  department: Department
  isLast: boolean
  onEdit: () => void
  onDelete: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [removing, setRemoving] = useState(false)

  if (confirming) {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
        style={{ borderBottom: isLast ? undefined : '1px solid var(--color-line)', backgroundColor: 'var(--color-clay-soft)' }}
      >
        <p className="text-[12.5px]" style={{ color: 'var(--color-clay)' }}>
          Remove <span className="font-medium">"{department.name}"</span>? This can't be undone.
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
      className="group flex items-center gap-3.5 px-4 py-3 transition-colors hover:bg-black/[0.02]"
      style={{ borderBottom: isLast ? undefined : '1px solid color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)' }}
    >
      <span
        className="shrink-0 inline-flex items-center font-mono text-[10.5px] font-semibold uppercase tracking-[0.06em] px-1.5 py-0.5 rounded-[4px]"
        style={{ color: 'var(--color-gold)', backgroundColor: 'color-mix(in srgb, var(--color-gold) 14%, transparent)' }}
      >
        Year {department.mbbsYear}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-display text-[15.5px] leading-snug truncate" style={{ color: 'var(--color-char)' }}>
          {department.name}
        </div>
        {department.description && (
          <div className="text-[11.5px] truncate" style={{ color: 'var(--color-char-soft)' }}>
            {department.description}
          </div>
        )}
      </div>
      <div className="flex gap-0.5 shrink-0 opacity-70 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <IconButton icon="edit" title="Edit department" onClick={onEdit} />
        <IconButton icon="trash" title="Remove department" tone="danger" onClick={() => setConfirming(true)} />
      </div>
    </div>
  )
}

function IconButton({
  icon,
  title,
  onClick,
  tone = 'default',
}: {
  icon: 'edit' | 'trash'
  title: string
  onClick: () => void
  tone?: 'default' | 'danger'
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="h-6 w-6 flex items-center justify-center transition-colors duration-150 hover:bg-black/[0.06]"
      style={{ color: tone === 'danger' ? 'var(--color-clay)' : 'var(--color-char-soft)' }}
    >
      <Icon name={icon} className="h-3.5 w-3.5" />
    </button>
  )
}
