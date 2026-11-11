import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { InstitutionAdminShell } from './shell/InstitutionAdminShell'
import { SaveChangesBar, SubTabBar } from './shell/toggleUi'
import { ToggleSwitch } from '../primary-admin/shell/VideoShared'
import { Card, Skeleton, inputClass } from '../primary-admin/shell/ui'
import { Icon } from '../primary-admin/shell/Icon'
import {
  watchGlobalTemplates,
  watchInstitutionTemplates,
  watchTreeNodes,
  watchInstitutionCompetencyOverrides,
  watchInstitutionCompetencyFormOverrides,
  setCompetencyEnabledForInstitution,
} from '../../lib/firestore/logTemplates'
import type { InstitutionCompetencyFormOverride, InstitutionCompetencyOverride, LogTemplate, TreeNode } from '../../types'

type SubTab = 'global' | 'own'
type ViewMode = 'grid' | 'list'

interface Row {
  template: LogTemplate
  node: TreeNode
}

// Same browser shape as the Primary Admin's own Competencies catalog page
// (collapsible department sidebar, stat strip, search/sort/grid-list
// toolbar, grouped-by-department cards) — with a ToggleSwitch worked into
// each card/row, since toggling is this page's actual job (the admin
// catalog page never needed one, it's authoring the global catalog, not
// enabling/disabling it for one institution).
function CompetencyLibrary({
  templates,
  nodesByTemplate,
  loading,
  isEnabled,
  onToggle,
  badge,
  actionLabel,
  actionHref,
  emptyState,
  mode = 'flat',
}: {
  templates: LogTemplate[]
  nodesByTemplate: Record<string, TreeNode[]>
  loading: boolean
  isEnabled: (nodeId: string) => boolean
  onToggle: (nodeId: string) => void
  badge?: (nodeId: string) => string | null
  actionLabel: (nodeId: string) => string
  actionHref: (templateId: string, nodeId: string) => string
  emptyState: ReactNode
  // 'flat' — the admin catalog's own layout: skills grouped only by
  // department, one card per skill (used by the Global sub-tab). 'grouped'
  // — each SSL log's own title heads a card with its skills listed
  // underneath, departments grouped above that (used by the
  // Institution-specific sub-tab, matching the Primary Admin's Institution
  // Management portal's own-competencies layout).
  mode?: 'flat' | 'grouped'
}) {
  const [search, setSearch] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState<'all' | string>('all')
  const [viewMode, setViewMode] = useState<ViewMode>('grid')
  const [sidebarOpen, setSidebarOpen] = useState(true)

  const allRows: Row[] = useMemo(() => {
    const rows: Row[] = []
    templates.forEach((t) => {
      ;(nodesByTemplate[t.id] ?? []).forEach((n) => rows.push({ template: t, node: n }))
    })
    return rows
  }, [templates, nodesByTemplate])

  const deptCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    templates.forEach((t) => {
      counts[t.department] = (counts[t.department] ?? 0) + (nodesByTemplate[t.id]?.length ?? 0)
    })
    return counts
  }, [templates, nodesByTemplate])
  const sidebarDepartments = useMemo(
    () => Object.keys(deptCounts).filter((d) => deptCounts[d] > 0).sort((a, b) => a.localeCompare(b)),
    [deptCounts],
  )

  const q = search.trim().toLowerCase()
  const filteredRows = useMemo(
    () =>
      allRows.filter((r) => {
        if (departmentFilter !== 'all' && r.template.department !== departmentFilter) return false
        if (q && !r.node.title.toLowerCase().includes(q)) return false
        return true
      }),
    [allRows, departmentFilter, q],
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
        rows: [...rows].sort((a, b) => a.node.title.localeCompare(b.node.title)),
      }))
  }, [filteredRows])

  // 'grouped' mode: department, then each SSL log's own title heading a
  // card with its skills nested underneath — so several logs sharing a
  // department read as one indicated group, and each log's title stays
  // together with the skills it owns.
  const deptTemplateGroups = useMemo(() => {
    const byDept = new Map<string, Map<string, { template: LogTemplate; rows: Row[] }>>()
    filteredRows.forEach((r) => {
      const deptMap = byDept.get(r.template.department) ?? new Map<string, { template: LogTemplate; rows: Row[] }>()
      const g = deptMap.get(r.template.id) ?? { template: r.template, rows: [] }
      g.rows.push(r)
      deptMap.set(r.template.id, g)
      byDept.set(r.template.department, deptMap)
    })
    return [...byDept.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([department, deptMap]) => ({
        department,
        templates: [...deptMap.values()]
          .sort((a, b) => a.template.title.localeCompare(b.template.title))
          .map((g) => ({
            template: g.template,
            rows: g.rows.slice().sort((a, b) => a.node.title.localeCompare(b.node.title)),
          })),
      }))
  }, [filteredRows])

  const includedCount = filteredRows.filter((r) => isEnabled(r.node.id)).length
  const noneAtAll = !loading && allRows.length === 0
  const noMatches = !loading && !noneAtAll && filteredRows.length === 0
  const filtersActive = search.trim() !== '' || departmentFilter !== 'all'

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-64" />
      </div>
    )
  }
  if (noneAtAll) return <>{emptyState}</>

  return (
    <div className="flex items-start gap-8">
      {/* ---------- Library sidebar: departments ---------- */}
      <div
        className="hidden lg:block shrink-0 sticky top-0 transition-all duration-300 ease-out"
        style={{ width: sidebarOpen ? 212 : 0, opacity: sidebarOpen ? 1 : 0, maxHeight: '100vh', overflowX: 'hidden', overflowY: 'auto' }}
      >
        <aside className="w-[212px]">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] mb-2 px-1" style={{ color: 'var(--color-char-soft)' }}>
            Departments
          </div>
          <div>
            <SidebarRow label="All departments" count={allRows.length} active={departmentFilter === 'all'} onClick={() => setDepartmentFilter('all')} />
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
        </aside>
      </div>

      {/* ---------- Main content ---------- */}
      <div className="min-w-0 flex-1">
        <div className="grid grid-cols-3 border rounded-[6px] overflow-hidden mb-6" style={{ borderColor: 'var(--color-line)' }}>
          <div className="px-5 py-4" style={{ borderRight: '1px solid var(--color-line)' }}>
            <div className="font-display text-[26px] leading-none tabular-nums" style={{ color: 'var(--color-char)' }}>
              {sidebarDepartments.length}
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
          <div className="px-5 py-4">
            <div className="font-display text-[26px] leading-none tabular-nums" style={{ color: 'var(--color-char)' }}>
              {includedCount}
              <span className="text-[14px]" style={{ color: 'var(--color-char-soft)' }}>/{filteredRows.length}</span>
            </div>
            <div className="mt-2 text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
              Included
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap mb-3">
          <button
            onClick={() => setSidebarOpen((o) => !o)}
            title={sidebarOpen ? 'Hide departments' : 'Show departments'}
            className="hidden lg:flex h-8 w-9 shrink-0 items-center justify-center border rounded-[6px] transition-colors"
            style={{ borderColor: 'var(--color-line)', color: 'var(--color-char-soft)' }}
          >
            <Icon name="chevron" className={`h-3.5 w-3.5 transition-transform duration-300 ${sidebarOpen ? 'rotate-180' : ''}`} />
          </button>

          <div className="relative flex-1 min-w-[200px]">
            <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: 'var(--color-char-soft)' }} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search skill name…"
              className="w-full pl-8 pr-3 py-2 text-[13.5px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]"
              style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
            />
          </div>

          {!sidebarOpen && (
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
          )}

          {mode === 'flat' && (
            <div className="inline-flex border rounded-[6px] overflow-hidden shrink-0" style={{ borderColor: 'var(--color-line)' }}>
              <button
                onClick={() => setViewMode('grid')}
                title="Grid view"
                className="h-8 w-9 flex items-center justify-center transition-colors"
                style={{ backgroundColor: viewMode === 'grid' ? 'var(--color-ink)' : 'transparent', color: viewMode === 'grid' ? 'var(--color-frost)' : 'var(--color-char-soft)' }}
              >
                <Icon name="grid" className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                title="List view"
                className="h-8 w-9 flex items-center justify-center transition-colors border-l"
                style={{ borderColor: 'var(--color-line)', backgroundColor: viewMode === 'list' ? 'var(--color-ink)' : 'transparent', color: viewMode === 'list' ? 'var(--color-frost)' : 'var(--color-char-soft)' }}
              >
                <Icon name="list" className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {filtersActive && (
          <button
            onClick={() => {
              setSearch('')
              setDepartmentFilter('all')
            }}
            className="text-[11.5px] font-medium hover:opacity-70 transition-opacity mb-5"
            style={{ color: 'var(--color-gold)' }}
          >
            Clear filters
          </button>
        )}

        {noMatches ? (
          <Card className="chamfer">
            <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
              No competencies match these filters.
            </p>
          </Card>
        ) : mode === 'grouped' ? (
          <div className="flex flex-col gap-8">
            {deptTemplateGroups.map(({ department, templates: deptTemplates }) => (
              <div key={department}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="font-display text-[19px]" style={{ color: 'var(--color-char)' }}>
                    {department}
                  </span>
                  <span className="text-[11px]" style={{ color: 'var(--color-char-soft)' }}>
                    {deptTemplates.length} log{deptTemplates.length === 1 ? '' : 's'}
                  </span>
                </div>
                <div className="space-y-5">
                  {deptTemplates.map(({ template, rows }, i) => (
                    <TemplateGroupCard
                      key={template.id}
                      template={template}
                      rows={rows}
                      index={i}
                      isEnabled={isEnabled}
                      onToggle={onToggle}
                      badge={badge}
                      actionLabel={actionLabel}
                      actionHref={actionHref}
                      scopeLabel={template.scope === 'institution' ? 'Institution-owned log' : 'Global log'}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
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
                    {rows.map(({ template, node }, i) => (
                      <CompetencyCard
                        key={node.id}
                        node={node}
                        index={i}
                        enabled={isEnabled(node.id)}
                        onToggle={() => onToggle(node.id)}
                        badgeLabel={badge?.(node.id) ?? null}
                        actionLabel={actionLabel(node.id)}
                        actionHref={actionHref(template.id, node.id)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="border rounded-[10px] overflow-hidden" style={{ backgroundColor: 'var(--color-paper)', borderColor: 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)' }}>
                    {rows.map(({ template, node }, i) => (
                      <CompetencyListRow
                        key={node.id}
                        node={node}
                        isLast={i === rows.length - 1}
                        enabled={isEnabled(node.id)}
                        onToggle={() => onToggle(node.id)}
                        badgeLabel={badge?.(node.id) ?? null}
                        actionLabel={actionLabel(node.id)}
                        actionHref={actionHref(template.id, node.id)}
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
  )
}

function SidebarRow({ label, count, active, onClick }: { label: string; count: number; active: boolean; onClick: () => void }) {
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

// Always-present pill, same slot/shape as the admin catalog's ChecklistBadge
// (border pill + dot), so every card carries the same bottom line whether
// or not it's also customized.
function StatusPill({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0"
      style={{ borderColor: 'var(--color-teal)', color: 'var(--color-teal)' }}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: 'var(--color-teal)' }} />
      Included
    </span>
  ) : (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border shrink-0"
      style={{ borderColor: 'var(--color-clay)', color: 'var(--color-clay)' }}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: 'var(--color-clay)' }} />
      Excluded
    </span>
  )
}

function CompetencyBadge({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold uppercase tracking-[0.04em] shrink-0"
      style={{ color: 'var(--color-gold)', backgroundColor: 'color-mix(in srgb, var(--color-gold) 14%, transparent)' }}
    >
      {label}
    </span>
  )
}

function CompetencyCard({
  node,
  index,
  enabled,
  onToggle,
  badgeLabel,
  actionLabel,
  actionHref,
}: {
  node: TreeNode
  index: number
  enabled: boolean
  onToggle: () => void
  badgeLabel: string | null
  actionLabel: string
  actionHref: string
}) {
  return (
    <Link
      to={actionHref}
      title={actionLabel}
      // Byte-for-byte the Primary Admin catalog page's own CompetencyCard
      // shape (p-4, h-10 w-10 avatar, text-[16.5px] title, the mt-3 pill
      // line always present) — that persistent bottom line is what gives
      // every card the same balanced height regardless of title length;
      // leaving it conditional (an earlier pass here) is what made short
      // cards read as flat and horizontally stretched. The toggle sits in
      // the same top-right corner admin's hover-only icon buttons use,
      // just always visible instead of hover-reveal, since seeing its
      // state at rest is the actual point of this page.
      className="fade-up group block rounded-[10px] border p-4 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-14px_rgba(11,18,32,0.35)] hover:border-[var(--color-gold-line)]"
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
            <div
              className="font-display text-[16.5px] font-semibold leading-snug break-words"
              style={{ color: enabled ? 'var(--color-char)' : 'var(--color-char-soft)' }}
            >
              {node.title || 'Untitled competency'}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle() }}>
            <ToggleSwitch on={enabled} onChange={onToggle} label={enabled ? 'Included — click to exclude' : 'Excluded — click to include'} size="sm" />
          </div>
          <span
            className="h-6 w-6 flex items-center justify-center rounded-[3px] opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
            style={{ color: 'var(--color-char-soft)' }}
          >
            <Icon name="edit" className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <StatusPill enabled={enabled} />
        {badgeLabel && <CompetencyBadge label={badgeLabel} />}
      </div>
    </Link>
  )
}

function CompetencyListRow({
  node,
  isLast,
  enabled,
  onToggle,
  badgeLabel,
  actionLabel,
  actionHref,
}: {
  node: TreeNode
  isLast: boolean
  enabled: boolean
  onToggle: () => void
  badgeLabel: string | null
  actionLabel: string
  actionHref: string
}) {
  return (
    <Link
      to={actionHref}
      title={actionLabel}
      className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-black/[0.02]"
      style={{ borderBottom: isLast ? undefined : '1px solid color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)' }}
    >
      <div className="min-w-0 flex-1">
        <div className="font-display text-[15px] leading-snug truncate" style={{ color: enabled ? 'var(--color-char)' : 'var(--color-char-soft)' }}>
          {node.title || 'Untitled competency'}
        </div>
      </div>

      <StatusPill enabled={enabled} />
      {badgeLabel && <CompetencyBadge label={badgeLabel} />}

      <div className="flex items-center gap-1.5 shrink-0">
        <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle() }}>
          <ToggleSwitch on={enabled} onChange={onToggle} label={enabled ? 'Included — click to exclude' : 'Excluded — click to include'} size="sm" />
        </div>
        <span
          className="h-6 w-6 flex items-center justify-center rounded-[3px] opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity"
          style={{ color: 'var(--color-char-soft)' }}
        >
          <Icon name="edit" className="h-3.5 w-3.5" />
        </span>
      </div>
    </Link>
  )
}

// Byte-matches the Primary Admin's Institution Management portal's own-
// competencies card: monogram chip + log title + department/scope meta
// line, a divider, then every skill the log owns listed underneath as its
// own row — so a log's title always stays together with its skills, and
// an "Edit checklist"/"Add checklist" action sits right on each skill.
function TemplateGroupCard({
  template,
  rows,
  index,
  isEnabled,
  onToggle,
  badge,
  actionLabel,
  actionHref,
  scopeLabel,
}: {
  template: LogTemplate
  rows: Row[]
  index: number
  isEnabled: (nodeId: string) => boolean
  onToggle: (nodeId: string) => void
  badge?: (nodeId: string) => string | null
  actionLabel: (nodeId: string) => string
  actionHref: (templateId: string, nodeId: string) => string
  scopeLabel: string
}) {
  return (
    <div
      className="fade-up relative overflow-hidden rounded-[10px] border"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)',
        borderColor: 'var(--color-line)',
        animationDelay: `${index * 35}ms`,
      }}
    >
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="chamfer-sm shrink-0 inline-flex items-center justify-center font-display text-[13px] font-semibold"
            style={{ width: 32, height: 32, backgroundColor: 'var(--color-ink)', color: 'var(--color-gold)' }}
          >
            {template.title.trim()[0]?.toUpperCase() ?? '?'}
          </span>
          <div className="min-w-0">
            <div className="font-display text-[16.5px] leading-snug truncate" style={{ color: 'var(--color-char)' }}>
              {template.title}
            </div>
            <div className="text-[12px] truncate" style={{ color: 'var(--color-char-soft)' }}>
              {template.department} · {scopeLabel}
            </div>
          </div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--color-line)' }}>
        {rows.map((r, i) => {
          const enabled = isEnabled(r.node.id)
          const badgeLabel = badge?.(r.node.id) ?? null
          return (
            <div
              key={r.node.id}
              className="flex items-center gap-3.5 px-5 py-2.5"
              style={{ borderBottom: i === rows.length - 1 ? undefined : '1px solid color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)' }}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="text-[13.5px] truncate" style={{ color: enabled ? 'var(--color-char)' : 'var(--color-char-soft)' }}>
                    {r.node.title || 'Untitled competency'}
                  </span>
                  {badgeLabel && <CompetencyBadge label={badgeLabel} />}
                  {!r.node.formSchemaId && (
                    <span className="shrink-0 text-[11px]" style={{ color: 'var(--color-char-soft)' }}>
                      No checklist yet
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2.5 shrink-0">
                <StatusPill enabled={enabled} />
                <div onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggle(r.node.id) }}>
                  <ToggleSwitch on={enabled} onChange={() => onToggle(r.node.id)} label={enabled ? 'Included — click to exclude' : 'Excluded — click to include'} size="sm" />
                </div>
                <Link
                  to={actionHref(template.id, r.node.id)}
                  title={enabled ? actionLabel(r.node.id) : 'Include this skill to edit its checklist'}
                  onClick={(e) => { if (!enabled) e.preventDefault() }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium border transition-colors duration-150"
                  style={{
                    borderColor: 'var(--color-line)',
                    color: enabled ? 'var(--color-char)' : 'var(--color-char-soft)',
                    opacity: enabled ? 1 : 0.45,
                    pointerEvents: enabled ? 'auto' : 'none',
                  }}
                >
                  <Icon name="edit" className="h-3.5 w-3.5" />
                  {actionLabel(r.node.id)}
                </Link>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function InstitutionAdminCompetenciesPage() {
  const { appUser } = useAuth()
  const institutionId = appUser?.institutionId ?? null

  const [subTab, setSubTab] = useState<SubTab>('global')

  const [globalTemplates, setGlobalTemplates] = useState<LogTemplate[] | null>(null)
  const [ownTemplates, setOwnTemplates] = useState<LogTemplate[] | null>(null)
  const [globalNodesByTemplate, setGlobalNodesByTemplate] = useState<Record<string, TreeNode[]>>({})
  const [ownNodesByTemplate, setOwnNodesByTemplate] = useState<Record<string, TreeNode[]>>({})
  const [overrides, setOverrides] = useState<InstitutionCompetencyOverride[] | null>(null)
  const [formOverrides, setFormOverrides] = useState<InstitutionCompetencyFormOverride[]>([])
  const [draft, setDraft] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => watchGlobalTemplates({}, (all) => setGlobalTemplates(all.filter((t) => t.logType === 'SSL'))), [])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionTemplates(institutionId, {}, (all) => setOwnTemplates(all.filter((t) => t.logType === 'SSL')))
  }, [institutionId])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionCompetencyOverrides(institutionId, setOverrides)
  }, [institutionId])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionCompetencyFormOverrides(institutionId, setFormOverrides)
  }, [institutionId])

  const globalTemplateIds = (globalTemplates ?? []).map((t) => t.id).join(',')
  useEffect(() => {
    const templates = globalTemplates ?? []
    if (templates.length === 0) {
      setGlobalNodesByTemplate({})
      return
    }
    const unsubs = templates.map((t) => watchTreeNodes(t.id, (n) => setGlobalNodesByTemplate((prev) => ({ ...prev, [t.id]: n }))))
    return () => unsubs.forEach((u) => u())
  }, [globalTemplateIds])

  const ownTemplateIds = (ownTemplates ?? []).map((t) => t.id).join(',')
  useEffect(() => {
    const templates = ownTemplates ?? []
    if (templates.length === 0) {
      setOwnNodesByTemplate({})
      return
    }
    const unsubs = templates.map((t) => watchTreeNodes(t.id, (n) => setOwnNodesByTemplate((prev) => ({ ...prev, [t.id]: n }))))
    return () => unsubs.forEach((u) => u())
  }, [ownTemplateIds])

  const customizedNodeIds = useMemo(() => new Set(formOverrides.map((o) => o.nodeId)), [formOverrides])
  const ownNodeById = useMemo(() => {
    const map: Record<string, TreeNode> = {}
    Object.values(ownNodesByTemplate).forEach((nodes) => nodes.forEach((n) => { map[n.id] = n }))
    return map
  }, [ownNodesByTemplate])
  const loading = subTab === 'global' ? !globalTemplates : !ownTemplates

  function isEnabled(nodeId: string): boolean {
    if (nodeId in draft) return draft[nodeId]
    const override = overrides?.find((o) => o.nodeId === nodeId)
    return override ? override.enabled : true
  }
  function stageToggle(nodeId: string) {
    setDraft((prev) => ({ ...prev, [nodeId]: !isEnabled(nodeId) }))
  }
  async function saveChanges() {
    if (!institutionId) return
    setSaving(true)
    await Promise.all(Object.entries(draft).map(([nodeId, enabled]) => setCompetencyEnabledForInstitution(institutionId, nodeId, enabled)))
    setDraft({})
    setSaving(false)
  }

  return (
    <InstitutionAdminShell eyebrow="Academic structure" title="Competencies">
      <SubTabBar
        value={subTab}
        onChange={setSubTab}
        options={[
          { v: 'global', label: 'Global competencies' },
          { v: 'own', label: 'Institution-specific competencies' },
        ]}
      />

      <SaveChangesBar pendingCount={Object.keys(draft).length} saving={saving} onSave={saveChanges} onDiscard={() => setDraft({})} />

      <p className="text-[13.5px] leading-relaxed mb-6 max-w-2xl" style={{ color: 'var(--color-char-soft)' }}>
        {subTab === 'global' ? (
          <>
            Grouped by the SSL log each procedure belongs to, then by department. Toggle one on or off for your institution, or open
            it to <strong className="font-medium">Customize</strong> its evaluation checklist — your edits become an institution-only
            copy and never touch the global competency or any other institution.
          </>
        ) : (
          <>
            Every procedure that belongs only to your institution — added under your own SSL logs, grouped by the log they belong to.
            Toggle one off to hide it, or use <strong className="font-medium">Edit checklist</strong> /{' '}
            <strong className="font-medium">Add checklist</strong> to build its evaluation form.
          </>
        )}
      </p>

      {subTab === 'global' ? (
        <CompetencyLibrary
          templates={globalTemplates ?? []}
          nodesByTemplate={globalNodesByTemplate}
          loading={loading}
          isEnabled={isEnabled}
          onToggle={stageToggle}
          mode="grouped"
          badge={(nodeId) => (customizedNodeIds.has(nodeId) ? 'Customized' : null)}
          actionLabel={(nodeId) => (customizedNodeIds.has(nodeId) ? 'Edit' : 'Customize')}
          actionHref={(templateId, nodeId) => `/institution-admin/competencies/global/${templateId}/${nodeId}`}
          emptyState={
            <Card className="chamfer max-w-lg">
              <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
                No global competencies exist in an included department yet.
              </p>
            </Card>
          }
        />
      ) : (
        <CompetencyLibrary
          templates={ownTemplates ?? []}
          nodesByTemplate={ownNodesByTemplate}
          loading={loading}
          isEnabled={isEnabled}
          onToggle={stageToggle}
          mode="grouped"
          actionLabel={(nodeId) => (ownNodeById[nodeId]?.formSchemaId ? 'Edit checklist' : 'Add checklist')}
          actionHref={(templateId, nodeId) => `/institution-admin/competencies/own/${templateId}/${nodeId}`}
          emptyState={
            <Card className="chamfer max-w-lg">
              <p className="text-[13.5px] mb-4" style={{ color: 'var(--color-char-soft)' }}>
                No institution-specific SSL logs yet — create one from Log Templates to start building your own competency checklists.
              </p>
              <Link to="/institution-admin/log-templates" className="text-[12.5px] font-medium" style={{ color: 'var(--color-gold)' }}>
                Go to Log Templates →
              </Link>
            </Card>
          }
        />
      )}
    </InstitutionAdminShell>
  )
}
