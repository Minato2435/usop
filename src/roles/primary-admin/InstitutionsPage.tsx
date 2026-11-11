import { useMemo, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PrimaryAdminShell } from './shell/PrimaryAdminShell'
import { Card, PrimaryButton, Badge, Modal, Field, inputClass, Skeleton } from './shell/ui'
import { Icon } from './shell/Icon'
import { watchInstitutions, createInstitution, updateInstitution } from '../../lib/firestore/institutions'
import { watchUsers } from '../../lib/firestore/users'
import { INDIAN_STATES, INDIAN_UNION_TERRITORIES } from '../../lib/indianStates'
import type { AppUser, Institution } from '../../types'

const INSTITUTION_TYPES = [
  'Government Medical College',
  'Private Medical College',
  'Deemed University',
]

type SortOrder = 'name-asc' | 'name-desc' | 'year-desc' | 'year-asc'
const SORT_LABELS: Record<SortOrder, string> = {
  'name-asc': 'Name (A → Z)',
  'name-desc': 'Name (Z → A)',
  'year-desc': 'Established (newest first)',
  'year-asc': 'Established (oldest first)',
}

const CURRENT_YEAR = new Date().getFullYear()

export function PrimaryAdminInstitutionsPage() {
  const navigate = useNavigate()
  const [institutions, setInstitutions] = useState<Institution[] | null>(null)
  const [users, setUsers] = useState<AppUser[] | null>(null)

  // Dual-purpose modal target — 'create' for a fresh institution, an
  // Institution to edit its details in place (same fields, same form),
  // null when closed. Mirrors the formTarget convention already used on
  // the Video Tutorials pages.
  const [formTarget, setFormTarget] = useState<'create' | Institution | null>(null)
  const [name, setName] = useState('')
  const [state, setState] = useState('')
  const [city, setCity] = useState('')
  const [type, setType] = useState('')
  const [establishedYear, setEstablishedYear] = useState('')
  const [saving, setSaving] = useState(false)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | string>('all')
  const [sortOrder, setSortOrder] = useState<SortOrder>('name-asc')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  useEffect(() => watchInstitutions(setInstitutions), [])
  useEffect(() => watchUsers(setUsers), [])

  function openCreate() {
    setName('')
    setState('')
    setCity('')
    setType('')
    setEstablishedYear('')
    setFormTarget('create')
  }

  function openEdit(inst: Institution) {
    // A few institutions predate the state/city/type/establishedYear
    // fields (created back when Institution was just name+createdAt) and
    // are genuinely missing them in Firestore, not just empty-string —
    // defaulting here is what makes Save changes clickable for them
    // instead of canSubmit silently reading undefined as never-satisfied.
    setName(inst.name)
    setState(inst.state ?? '')
    setCity(inst.city ?? '')
    setType(inst.type ?? '')
    setEstablishedYear(inst.establishedYear != null ? String(inst.establishedYear) : '')
    setFormTarget(inst)
  }

  function closeModal() {
    setFormTarget(null)
  }

  const isEditing = formTarget !== null && formTarget !== 'create'
  const canSubmit = name.trim() && state && city.trim() && type

  async function handleSave() {
    if (!canSubmit || !formTarget) return
    const year = Number(establishedYear)
    const patch = {
      name: name.trim(),
      state,
      city: city.trim(),
      type,
      establishedYear: establishedYear.trim() && Number.isFinite(year) ? year : null,
    }
    setSaving(true)
    if (formTarget === 'create') await createInstitution(patch)
    else await updateInstitution(formTarget.id, patch)
    setSaving(false)
    closeModal()
  }

  const loading = !institutions || !users

  const filtered = useMemo(() => {
    if (!institutions) return []
    const q = search.trim().toLowerCase()
    const matched = institutions.filter((inst) => {
      const matchesType = typeFilter === 'all' || inst.type === typeFilter
      const matchesSearch =
        q === '' ||
        inst.name.toLowerCase().includes(q) ||
        inst.city.toLowerCase().includes(q) ||
        inst.state.toLowerCase().includes(q)
      return matchesType && matchesSearch
    })
    return [...matched].sort((a, b) => {
      if (sortOrder === 'name-asc') return a.name.localeCompare(b.name)
      if (sortOrder === 'name-desc') return b.name.localeCompare(a.name)
      // Undated institutions sort to the end regardless of direction.
      if (a.establishedYear == null) return b.establishedYear == null ? 0 : 1
      if (b.establishedYear == null) return -1
      return sortOrder === 'year-desc' ? b.establishedYear - a.establishedYear : a.establishedYear - b.establishedYear
    })
  }, [institutions, search, typeFilter, sortOrder])

  const totalUsers = users?.length ?? 0

  return (
    <PrimaryAdminShell
      eyebrow="People & institutions"
      title="Institutions"
      actions={
        <PrimaryButton onClick={() => openCreate()}>
          <Icon name="plus" className="h-3.5 w-3.5" />
          New institution
        </PrimaryButton>
      }
    >
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      ) : institutions!.length === 0 ? (
        <Card className="chamfer max-w-lg">
          <p className="text-[13.5px] mb-4" style={{ color: 'var(--color-char-soft)' }}>
            No institutions exist yet. Every Institution Administrator, department, and student record is scoped to
            one — create the first institution to begin onboarding.
          </p>
          <PrimaryButton onClick={() => openCreate()}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            Create the first institution
          </PrimaryButton>
        </Card>
      ) : (
        <>
          <p className="text-[13px] mb-5" style={{ color: 'var(--color-char-soft)' }}>
            {institutions!.length} institution{institutions!.length === 1 ? '' : 's'} · {totalUsers} user
            {totalUsers === 1 ? '' : 's'} across the platform
          </p>

          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 mb-6">
            <div className="relative sm:w-[300px] shrink-0">
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
                placeholder="Search institutions"
              />
            </div>
            <select
              className={inputClass}
              style={{ width: 200, borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="all">All types</option>
              {INSTITUTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <select
              className={inputClass}
              style={{ width: 210, borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
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
          </div>

          {filtered.length === 0 ? (
            <Card className="chamfer max-w-lg">
              <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
                No institutions match "{search}"{typeFilter !== 'all' ? ` in ${typeFilter}` : ''}.
              </p>
            </Card>
          ) : viewMode === 'grid' ? (
            <div className="grid gap-5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
              {filtered.map((inst, i) => {
                const userCount = users!.filter((u) => u.institutionId === inst.id).length
                const admins = users!.filter((u) => u.institutionId === inst.id && u.role === 'institutionAdmin').length
                return (
                  <InstitutionCard
                    key={inst.id}
                    institution={inst}
                    admins={admins}
                    userCount={userCount}
                    index={i}
                    onOpen={() => navigate(`/admin/institutions/${inst.id}`)}
                    onEdit={() => openEdit(inst)}
                  />
                )
              })}
            </div>
          ) : (
            <div
              className="border rounded-[10px] overflow-hidden"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)', borderColor: 'var(--color-line)' }}
            >
              {filtered.map((inst, i) => {
                const userCount = users!.filter((u) => u.institutionId === inst.id).length
                const admins = users!.filter((u) => u.institutionId === inst.id && u.role === 'institutionAdmin').length
                return (
                  <InstitutionListRow
                    key={inst.id}
                    institution={inst}
                    admins={admins}
                    userCount={userCount}
                    isLast={i === filtered.length - 1}
                    onOpen={() => navigate(`/admin/institutions/${inst.id}`)}
                    onEdit={() => openEdit(inst)}
                  />
                )
              })}
            </div>
          )}
        </>
      )}

      {formTarget && (
        <Modal title={isEditing ? `Edit ${(formTarget as Institution).name}` : 'New institution'} onClose={closeModal}>
          <Field label="Institution name">
            <input
              autoFocus
              className={inputClass}
              style={{ borderColor: 'var(--color-line)' }}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Kasturba Medical College"
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="State">
              <select
                className={inputClass}
                style={{ borderColor: 'var(--color-line)', color: state ? 'var(--color-char)' : 'var(--color-char-soft)' }}
                value={state}
                onChange={(e) => setState(e.target.value)}
              >
                <option value="" disabled>
                  Select
                </option>
                <optgroup label="States">
                  {INDIAN_STATES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Union Territories">
                  {INDIAN_UNION_TERRITORIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </optgroup>
              </select>
            </Field>
            <Field label="City">
              <input
                className={inputClass}
                style={{ borderColor: 'var(--color-line)' }}
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Manipal"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Institution type">
              <select
                className={inputClass}
                style={{ borderColor: 'var(--color-line)', color: type ? 'var(--color-char)' : 'var(--color-char-soft)' }}
                value={type}
                onChange={(e) => setType(e.target.value)}
              >
                <option value="" disabled>
                  Select
                </option>
                {INSTITUTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Established year (optional)">
              <input
                type="number"
                min={1800}
                max={CURRENT_YEAR}
                className={inputClass}
                style={{ borderColor: 'var(--color-line)' }}
                value={establishedYear}
                onChange={(e) => setEstablishedYear(e.target.value)}
                placeholder="e.g. 1998"
              />
            </Field>
          </div>

          <div className="flex justify-end gap-2 mt-2">
            <PrimaryButton onClick={handleSave} disabled={!canSubmit || saving}>
              {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create institution'}
            </PrimaryButton>
          </div>
        </Modal>
      )}
    </PrimaryAdminShell>
  )
}

function InstitutionCard({
  institution,
  admins,
  userCount,
  index,
  onOpen,
  onEdit,
}: {
  institution: Institution
  admins: number
  userCount: number
  index: number
  onOpen: () => void
  onEdit: () => void
}) {
  const location = [institution.city, institution.state].filter(Boolean).join(', ')
  const initial = institution.name.trim()[0]?.toUpperCase() ?? '?'

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className="fade-up group overflow-hidden rounded-[10px] border p-5 cursor-pointer transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_28px_-16px_rgba(11,18,32,0.4)] hover:border-[var(--color-gold-line)]"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)',
        borderColor: 'var(--color-line)',
        animationDelay: `${index * 40}ms`,
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3.5 min-w-0 flex-1">
          <div
            className="shrink-0 h-12 w-12 rounded-full border-[1.5px] flex items-center justify-center font-display text-[19px]"
            style={{ borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)' }}
          >
            {initial}
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <div className="font-display text-[19px] leading-snug break-words" style={{ color: 'var(--color-char)' }}>
              {institution.name}
            </div>
            <div className="mt-1 text-[12.5px] break-words" style={{ color: 'var(--color-char-soft)' }}>
              {location || 'Location not set'}
            </div>
          </div>
        </div>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          title="Edit institution"
          className="shrink-0 h-7 w-7 flex items-center justify-center rounded-[5px] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-black/[0.05]"
          style={{ color: 'var(--color-char-soft)' }}
        >
          <Icon name="edit" className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-3">
        <Badge tone="gold">{institution.type || 'Institution'}</Badge>
      </div>

      <div className="my-4 h-px" style={{ backgroundColor: 'var(--color-line)' }} />

      <div className="flex items-center justify-between text-center">
        <StatBlock value={admins} label="Admins" />
        <StatBlock value={userCount} label="Users" />
        <StatBlock value={institution.establishedYear ?? '—'} label="Est." />
      </div>
    </div>
  )
}

function InstitutionListRow({
  institution,
  admins,
  userCount,
  isLast,
  onOpen,
  onEdit,
}: {
  institution: Institution
  admins: number
  userCount: number
  isLast: boolean
  onOpen: () => void
  onEdit: () => void
}) {
  const location = [institution.city, institution.state].filter(Boolean).join(', ')
  const initial = institution.name.trim()[0]?.toUpperCase() ?? '?'
  const meta = [
    `${admins} admin${admins === 1 ? '' : 's'}`,
    `${userCount} user${userCount === 1 ? '' : 's'}`,
    institution.establishedYear ? `Est. ${institution.establishedYear}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      className="group flex items-center gap-3.5 px-4 py-3 cursor-pointer transition-colors hover:bg-black/[0.02]"
      style={{ borderBottom: isLast ? undefined : '1px solid color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)' }}
    >
      <div
        className="shrink-0 h-9 w-9 rounded-full border-[1.5px] flex items-center justify-center font-display text-[14px]"
        style={{ borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)' }}
      >
        {initial}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-display text-[15.5px] leading-snug truncate" style={{ color: 'var(--color-char)' }}>
          {institution.name}
        </div>
        <div className="text-[11.5px] truncate" style={{ color: 'var(--color-char-soft)' }}>
          {[location || 'Location not set', meta].filter(Boolean).join(' · ')}
        </div>
      </div>
      <Badge tone="gold">{institution.type || 'Institution'}</Badge>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onEdit()
        }}
        title="Edit institution"
        className="shrink-0 h-7 w-7 flex items-center justify-center rounded-[5px] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity hover:bg-black/[0.06]"
        style={{ color: 'var(--color-char-soft)' }}
      >
        <Icon name="edit" className="h-3.5 w-3.5" />
      </button>
      <Icon name="chevron" className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--color-char-soft)' }} />
    </div>
  )
}

function StatBlock({ value, label }: { value: number | string; label: string }) {
  return (
    <div>
      <div className="font-display text-[20px] tabular-nums" style={{ color: 'var(--color-char)' }}>
        {value}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
        {label}
      </div>
    </div>
  )
}
