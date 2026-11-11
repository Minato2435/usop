import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PrimaryAdminShell } from './shell/PrimaryAdminShell'
import { Card, GhostButton, PrimaryButton, Skeleton } from './shell/ui'
import { Icon, type IconName } from './shell/Icon'
import { InstitutionPickerModal } from './shell/InstitutionPicker'
import { useAuth } from '../../auth/AuthContext'
import {
  watchGlobalTemplates,
  createTemplate,
  duplicateTemplate,
  deleteTemplate,
  countTemplateFields,
} from '../../lib/firestore/logTemplates'
import { watchUsers } from '../../lib/firestore/users'
import { BASE_DEPARTMENTS_BY_YEAR, MBBS_YEARS } from '../../lib/academicStructure'
import type { AppUser, LogTemplate, LogType, MbbsYear } from '../../types'

export function PrimaryAdminLogTemplatesPage() {
  const { appUser } = useAuth()
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<LogTemplate[] | null>(null)
  const [users, setUsers] = useState<AppUser[] | null>(null)
  const [fieldCounts, setFieldCounts] = useState<Record<string, number>>({})
  const [creating, setCreating] = useState(false)
  // Jumps straight to an institution's SSL Logs tab (Institution Management
  // portal) — its global-toggle view plus institution-exclusive logs —
  // same "By institution" pattern as the Competencies page.
  const [institutionPickerOpen, setInstitutionPickerOpen] = useState(false)

  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState<LogType | 'all'>('all')
  const [yearFilter, setYearFilter] = useState<MbbsYear | 'all'>('all')

  useEffect(() => watchGlobalTemplates({}, setTemplates), [])
  useEffect(() => watchUsers(setUsers), [])

  useEffect(() => {
    if (!templates) return
    let cancelled = false
    Promise.all(templates.map(async (t) => [t.id, await countTemplateFields(t)] as const)).then((pairs) => {
      if (!cancelled) setFieldCounts(Object.fromEntries(pairs))
    })
    return () => {
      cancelled = true
    }
  }, [templates])

  const authorName = useMemo(() => {
    const map = new Map((users ?? []).map((u) => [u.uid, u.name]))
    return (uid: string) => map.get(uid) ?? '—'
  }, [users])

  const filtered = useMemo(() => {
    if (!templates) return []
    const q = search.trim().toLowerCase()
    return templates.filter(
      (t) =>
        (typeFilter === 'all' || t.logType === typeFilter) &&
        (yearFilter === 'all' || t.mbbsYear === yearFilter) &&
        (q === '' || t.title.toLowerCase().includes(q) || t.department.toLowerCase().includes(q)),
    )
  }, [templates, search, typeFilter, yearFilter])

  const loading = !templates || !users
  const noTemplatesAtAll = !loading && templates!.length === 0
  const noMatches = !loading && !noTemplatesAtAll && filtered.length === 0

  // Beyond the raw total, surface signal a Primary Admin actually cares
  // about when auditing template coverage: the SSL/SDL breakdown, and how
  // much of the department catalog has a template yet.
  const list = templates ?? []
  const sslCount = list.filter((t) => t.logType === 'SSL').length
  const sdlCount = list.length - sslCount

  const departmentsCovered = new Set(list.map((t) => t.department)).size
  const totalCatalogDepartments = useMemo(
    () => new Set(Object.values(BASE_DEPARTMENTS_BY_YEAR).flat()).size,
    [],
  )

  async function handleAddTemplate() {
    if (!appUser) return
    setCreating(true)
    const id = await createTemplate({
      logType: 'SSL',
      scope: 'global',
      institutionId: '',
      department: BASE_DEPARTMENTS_BY_YEAR[1][0],
      mbbsYear: 1,
      title: '',
      createdBy: appUser.uid,
    })
    navigate(`/admin/log-templates/${id}`)
  }

  return (
    <PrimaryAdminShell
      eyebrow="Logbook configuration"
      title="Log templates"
      actions={
        <div className="flex items-center gap-2">
          <GhostButton onClick={() => setInstitutionPickerOpen(true)}>
            <Icon name="institutions" className="h-3.5 w-3.5" />
            By institution
          </GhostButton>
          <PrimaryButton onClick={handleAddTemplate} disabled={creating}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            {creating ? 'Creating…' : 'Add log template'}
          </PrimaryButton>
        </div>
      }
    >
      {!loading && (
        <p className="text-[13px] mb-5" style={{ color: 'var(--color-char-soft)' }}>
          {filtered.length} of {templates!.length} template{templates!.length === 1 ? '' : 's'} shown
        </p>
      )}

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-64" />
        </div>
      ) : noTemplatesAtAll ? (
        <Card className="chamfer max-w-lg">
          <p className="text-[13.5px] mb-4" style={{ color: 'var(--color-char-soft)' }}>
            No log templates exist yet. Start one to define the SSL procedures or SDL categories
            students will log against.
          </p>
          <PrimaryButton onClick={handleAddTemplate} disabled={creating}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            {creating ? 'Creating…' : 'Add the first template'}
          </PrimaryButton>
        </Card>
      ) : (
        <>
          <div
            className="grid grid-cols-2 sm:grid-cols-4 border rounded-[6px] overflow-hidden mb-7 divide-x divide-y sm:divide-y-0 divide-[var(--color-line)]"
            style={{ borderColor: 'var(--color-line)' }}
          >
            <div className="px-5 py-4">
              <div className="font-display text-[28px] leading-none tabular-nums" style={{ color: 'var(--color-char)' }}>
                {list.length}
              </div>
              <div className="mt-2 text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                Templates
              </div>
            </div>

            <div className="px-5 py-4">
              <div className="font-display text-[28px] leading-none tabular-nums" style={{ color: 'var(--color-gold)' }}>
                {sslCount}
              </div>
              <div className="mt-2 text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                SSL templates
              </div>
            </div>

            <div className="px-5 py-4">
              <div className="font-display text-[28px] leading-none tabular-nums" style={{ color: 'var(--color-char)' }}>
                {sdlCount}
              </div>
              <div className="mt-2 text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                SDL templates
              </div>
            </div>

            <div className="px-5 py-4">
              <div className="font-display text-[28px] leading-none tabular-nums" style={{ color: 'var(--color-char)' }}>
                {departmentsCovered}
                <span className="text-[15px]" style={{ color: 'var(--color-char-soft)' }}>/{totalCatalogDepartments}</span>
              </div>
              <div className="mt-2 text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                Departments covered
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 mb-6">
            <div className="relative w-full sm:w-[260px]">
              <Icon
                name="search"
                className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none"
                style={{ color: 'var(--color-char-soft)' }}
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search templates"
                className="w-full pl-8 pr-3 py-2 text-[13.5px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]"
                style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              />
            </div>
            <SegGroup value={typeFilter} onChange={setTypeFilter} options={[{ v: 'all', l: 'All types' }, { v: 'SSL', l: 'SSL' }, { v: 'SDL', l: 'SDL' }]} />
            <SegGroup
              value={yearFilter}
              onChange={setYearFilter}
              options={[{ v: 'all', l: 'All years' }, ...MBBS_YEARS.map((y) => ({ v: y, l: `Y${y}` }))]}
            />
          </div>

          {noMatches ? (
            <Card className="chamfer">
              <div className="text-center py-8">
                <div className="font-display text-[20px] mb-1.5" style={{ color: 'var(--color-char)' }}>
                  No templates match these filters
                </div>
                <p className="text-[13.5px] mb-5" style={{ color: 'var(--color-char-soft)' }}>
                  Clear the filters, or start a new template from scratch.
                </p>
                <PrimaryButton onClick={handleAddTemplate} disabled={creating}>
                  <Icon name="plus" className="h-3.5 w-3.5" />
                  Add log template
                </PrimaryButton>
              </div>
            </Card>
          ) : (
            // Matches the Users table treatment: not the shared white
            // <Card> — sits on the page's own paper ground instead,
            // distinguished only by its border.
            <div
              className="rounded-[10px] overflow-hidden border"
              style={{
                backgroundColor: 'var(--color-paper)',
                borderColor: 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)',
              }}
            >
              <div className="overflow-x-auto">
                <div className="min-w-[920px]">
                  <div
                    className="flex items-center gap-4 px-5 py-3 border-b text-[10.5px] font-semibold uppercase tracking-[0.08em]"
                    style={{
                      borderColor: 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)',
                      color: 'var(--color-char-soft)',
                    }}
                  >
                    <div className="flex-[2.2] min-w-[260px]">Template</div>
                    <div className="w-[78px] shrink-0">Type</div>
                    <div className="w-[160px] shrink-0">Department</div>
                    <div className="w-[64px] shrink-0 text-right">Fields</div>
                    <div className="w-[118px] shrink-0 ml-2">Created</div>
                    <div className="w-[108px] shrink-0 ml-2 text-right">Actions</div>
                  </div>

                  {filtered.map((t) => (
                    <TemplateRow
                      key={t.id}
                      template={t}
                      fieldCount={fieldCounts[t.id]}
                      author={authorName(t.createdBy)}
                      onOpen={() => navigate(`/admin/log-templates/${t.id}`)}
                      onDuplicate={() => duplicateTemplate(t)}
                      onDelete={() => deleteTemplate(t.id)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {institutionPickerOpen && (
        <InstitutionPickerModal
          title="Open an institution's SSL logs"
          description="Pick an institution to see which global SSL logs are enabled for them, plus any logs exclusive to that institution."
          onClose={() => setInstitutionPickerOpen(false)}
          onSelect={(inst) => navigate(`/admin/institutions/${inst.id}?tab=sslLogs`)}
        />
      )}
    </PrimaryAdminShell>
  )
}

function SegGroup<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T | 'all'
  onChange: (v: T | 'all') => void
  options: { v: T | 'all'; l: string }[]
}) {
  return (
    <div className="inline-flex border rounded-[3px] overflow-hidden" style={{ borderColor: 'var(--color-line)' }}>
      {options.map((o, i) => (
        <button
          key={String(o.v)}
          onClick={() => onChange(o.v)}
          className="px-2.5 py-2 text-[12.5px] font-medium transition-colors duration-150"
          style={{
            backgroundColor: value === o.v ? 'var(--color-ink)' : 'transparent',
            color: value === o.v ? 'var(--color-frost)' : 'var(--color-char-soft)',
            borderRight: i < options.length - 1 ? '1px solid var(--color-line)' : undefined,
          }}
        >
          {o.l}
        </button>
      ))}
    </div>
  )
}

// One row of the template list. Owns its own confirm-before-delete state,
// same in-place-confirm pattern DepartmentCard uses — no native confirm().
function TemplateRow({
  template: t,
  fieldCount,
  author,
  onOpen,
  onDuplicate,
  onDelete,
}: {
  template: LogTemplate
  fieldCount: number | undefined
  author: string
  onOpen: () => void
  onDuplicate: () => Promise<string>
  onDelete: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState<'duplicate' | 'delete' | null>(null)

  if (confirming) {
    return (
      <div
        className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b last:border-0"
        style={{ borderColor: 'var(--color-clay)', backgroundColor: 'var(--color-clay-soft)' }}
      >
        <p className="text-[12.5px]" style={{ color: 'var(--color-clay)' }}>
          Delete <span className="font-medium">"{t.title || 'Untitled template'}"</span>? This can't be undone.
        </p>
        <div className="flex items-center gap-2 shrink-0">
          <GhostButton
            tone="danger"
            onClick={async () => {
              setBusy('delete')
              await onDelete()
            }}
          >
            {busy === 'delete' ? 'Deleting…' : 'Delete'}
          </GhostButton>
          <GhostButton onClick={() => setConfirming(false)}>Cancel</GhostButton>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex items-center gap-4 px-5 py-3.5 border-b last:border-0 transition-colors duration-100 hover:bg-black/[0.015]"
      style={{ borderColor: 'color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)' }}
    >
      <div className="flex-[2.2] min-w-[260px]">
        <button
          onClick={onOpen}
          className="font-display text-[16.5px] leading-snug text-left hover:opacity-70 transition-opacity"
          style={{ color: 'var(--color-char)' }}
        >
          {t.title || 'Untitled template'}
        </button>
        <div className="text-[12px] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
          Year {t.mbbsYear} · {author}
        </div>
      </div>
      <div className="w-[78px] shrink-0">
        <span
          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border"
          style={
            t.logType === 'SSL'
              ? { borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)' }
              : { borderColor: 'var(--color-line)', color: 'var(--color-char-soft)' }
          }
        >
          {t.logType}
        </span>
      </div>
      <div className="w-[160px] shrink-0 text-[13px] truncate" style={{ color: 'var(--color-char)' }}>
        {t.department}
      </div>
      <div className="w-[64px] shrink-0 text-right font-mono text-[13px] tabular-nums" style={{ color: 'var(--color-char-soft)' }}>
        {fieldCount ?? '…'}
      </div>
      <div className="w-[118px] shrink-0 ml-2 font-mono text-[12px] tabular-nums" style={{ color: 'var(--color-char-soft)' }}>
        {new Date(t.createdAt).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}
      </div>
      <div className="w-[108px] shrink-0 ml-2 flex justify-end gap-0.5">
        <RowIconButton title="Edit template" icon="edit" onClick={onOpen} />
        <RowIconButton
          title="Duplicate"
          icon="copy"
          busy={busy === 'duplicate'}
          onClick={async () => {
            setBusy('duplicate')
            await onDuplicate()
            setBusy(null)
          }}
        />
        <RowIconButton title="Delete" icon="trash" tone="danger" onClick={() => setConfirming(true)} />
      </div>
    </div>
  )
}

function RowIconButton({
  title,
  icon,
  onClick,
  busy,
  tone = 'default',
}: {
  title: string
  icon: IconName
  onClick: () => void
  busy?: boolean
  tone?: 'default' | 'danger'
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={busy}
      className="h-7 w-7 flex items-center justify-center rounded-[3px] transition-colors duration-150 hover:bg-black/[0.06] disabled:opacity-40"
      style={{ color: tone === 'danger' ? 'var(--color-clay)' : 'var(--color-char-soft)' }}
    >
      <Icon name={icon} className="h-3.5 w-3.5" />
    </button>
  )
}
