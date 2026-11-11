import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { InstitutionAdminShell } from './shell/InstitutionAdminShell'
import { SaveChangesBar, SubTabBar } from './shell/toggleUi'
import { ToggleSwitch } from '../primary-admin/shell/VideoShared'
import { Card, Field, Modal, PrimaryButton, Skeleton, inputClass } from '../primary-admin/shell/ui'
import { Icon } from '../primary-admin/shell/Icon'
import {
  watchGlobalTemplates,
  watchInstitutionTemplates,
  watchTreeNodes,
  watchInstitutionCompetencyOverrides,
  setCompetencyEnabledForInstitution,
  createTemplate,
} from '../../lib/firestore/logTemplates'
import { watchInstitutionDepartments, watchCatalogDepartments } from '../../lib/firestore/departments'
import { MBBS_YEARS } from '../../lib/academicStructure'
import type { Department, InstitutionCompetencyOverride, LogTemplate, LogType, MbbsYear, TreeNode } from '../../types'

type SubTab = 'global' | 'own'

export function InstitutionAdminLogTemplatesPage() {
  const { appUser } = useAuth()
  const navigate = useNavigate()
  const institutionId = appUser?.institutionId ?? null

  const [subTab, setSubTab] = useState<SubTab>('global')
  const [search, setSearch] = useState('')
  const [departmentFilter, setDepartmentFilter] = useState<string>('all')
  const [yearFilter, setYearFilter] = useState<MbbsYear | 'all'>('all')

  const [globalTemplates, setGlobalTemplates] = useState<LogTemplate[] | null>(null)
  const [ownTemplates, setOwnTemplates] = useState<LogTemplate[] | null>(null)
  const [competencyOverrides, setCompetencyOverrides] = useState<InstitutionCompetencyOverride[] | null>(null)
  const [nodesByTemplate, setNodesByTemplate] = useState<Record<string, TreeNode[]>>({})
  const [catalogDepartments, setCatalogDepartments] = useState<Department[]>([])
  const [ownDepartments, setOwnDepartments] = useState<Department[]>([])
  // Draft is keyed by competency nodeId — a log's title toggle stages
  // every one of its skills at once, exactly like the Primary Admin
  // Institution Management portal's SSL Logs master toggle, so both
  // surfaces read and write the same `institutionCompetencyOverrides`
  // state and stay in sync.
  const [draft, setDraft] = useState<Record<string, boolean>>({})
  const [savingChanges, setSavingChanges] = useState(false)
  const [creating, setCreating] = useState(false)

  useEffect(() => watchGlobalTemplates({}, setGlobalTemplates), [])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionTemplates(institutionId, {}, setOwnTemplates)
  }, [institutionId])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionCompetencyOverrides(institutionId, setCompetencyOverrides)
  }, [institutionId])
  useEffect(() => watchCatalogDepartments(setCatalogDepartments), [])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionDepartments(institutionId, setOwnDepartments)
  }, [institutionId])

  // Every template's skill list — global AND own — so each log card can
  // show its skills as individual toggle rows underneath, the same way the
  // Primary Admin Institution Management portal's SSL Logs cards do for
  // both its Global SSL and Institution-specific logs sub-tabs.
  const allTemplateIds = [...(globalTemplates ?? []), ...(ownTemplates ?? [])].map((t) => t.id).join(',')
  useEffect(() => {
    const templates = [...(globalTemplates ?? []), ...(ownTemplates ?? [])]
    if (templates.length === 0) {
      setNodesByTemplate({})
      return
    }
    const unsubs = templates.map((t) => watchTreeNodes(t.id, (n) => setNodesByTemplate((prev) => ({ ...prev, [t.id]: n }))))
    return () => unsubs.forEach((u) => u())
    // Keyed on the stable id-list string, not the array references.
  }, [allTemplateIds])

  const loading = !globalTemplates || !ownTemplates || !competencyOverrides
  const allDepartmentNames = useMemo(
    () => Array.from(new Set([...catalogDepartments, ...ownDepartments].map((d) => d.name))).sort(),
    [catalogDepartments, ownDepartments],
  )
  const departmentsByYear = useMemo(() => {
    const map: Record<MbbsYear, string[]> = { 1: [], 2: [], 3: [], 4: [] }
    for (const d of [...catalogDepartments, ...ownDepartments]) if (!map[d.mbbsYear].includes(d.name)) map[d.mbbsYear].push(d.name)
    return map
  }, [catalogDepartments, ownDepartments])

  function isCompetencyEnabled(nodeId: string): boolean {
    if (nodeId in draft) return draft[nodeId]
    const override = competencyOverrides?.find((o) => o.nodeId === nodeId)
    return override ? override.enabled : true
  }

  // A log reads as enabled while *any* of its skills is still included,
  // and only flips off once every skill is excluded — same "some" logic as
  // the admin portal's SSL Logs master toggle. A log with no skills yet
  // counts as enabled (nothing to exclude).
  function isLogEnabled(templateId: string): boolean {
    const nodes = nodesByTemplate[templateId] ?? []
    if (nodes.length === 0) return true
    return nodes.some((n) => isCompetencyEnabled(n.id))
  }

  function stageToggle(templateId: string) {
    const nodes = nodesByTemplate[templateId] ?? []
    const next = !isLogEnabled(templateId)
    setDraft((prev) => {
      const updated = { ...prev }
      nodes.forEach((n) => (updated[n.id] = next))
      return updated
    })
  }

  async function saveChanges() {
    if (!institutionId) return
    setSavingChanges(true)
    await Promise.all(
      Object.entries(draft).map(([nodeId, enabled]) => setCompetencyEnabledForInstitution(institutionId, nodeId, enabled)),
    )
    setDraft({})
    setSavingChanges(false)
  }

  const filtered = useMemo(() => {
    const list = subTab === 'global' ? (globalTemplates ?? []) : (ownTemplates ?? [])
    const q = search.trim().toLowerCase()
    return list.filter(
      (t) =>
        (q === '' || t.title.toLowerCase().includes(q) || t.department.toLowerCase().includes(q)) &&
        (departmentFilter === 'all' || t.department === departmentFilter) &&
        (yearFilter === 'all' || t.mbbsYear === yearFilter),
    )
  }, [subTab, globalTemplates, ownTemplates, search, departmentFilter, yearFilter])

  async function handleCreate(input: { logType: LogType; department: string; mbbsYear: MbbsYear; title: string }) {
    if (!appUser || !institutionId) return
    const id = await createTemplate({ ...input, scope: 'institution', institutionId, createdBy: appUser.uid })
    setCreating(false)
    navigate(`/institution-admin/log-templates/${id}`)
  }

  return (
    <InstitutionAdminShell
      eyebrow="Content"
      title="Log Templates"
      actions={
        subTab === 'own' ? (
          <PrimaryButton onClick={() => setCreating(true)}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            New template
          </PrimaryButton>
        ) : undefined
      }
    >
      <SubTabBar
        value={subTab}
        onChange={setSubTab}
        options={[
          { v: 'global', label: 'Global SSL & SDL' },
          { v: 'own', label: 'Institution-specific logs' },
        ]}
      />

      <div className="flex items-center gap-2.5 flex-wrap mb-5">
        <div className="relative flex-1 min-w-[200px]">
          <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: 'var(--color-char-soft)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search department or log title"
            className={`${inputClass} pl-8`}
            style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
          />
        </div>
        <select className={inputClass} style={{ width: 172, borderColor: 'var(--color-line)', color: 'var(--color-char)' }} value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)}>
          <option value="all">All departments</option>
          {allDepartmentNames.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select className={inputClass} style={{ width: 140, borderColor: 'var(--color-line)', color: 'var(--color-char)' }} value={yearFilter} onChange={(e) => setYearFilter(e.target.value === 'all' ? 'all' : (Number(e.target.value) as MbbsYear))}>
          <option value="all">All years</option>
          {MBBS_YEARS.map((y) => (
            <option key={y} value={y}>
              Year {y}
            </option>
          ))}
        </select>
      </div>

      <SaveChangesBar pendingCount={Object.keys(draft).length} saving={savingChanges} onSave={saveChanges} onDiscard={() => setDraft({})} />

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="chamfer max-w-lg">
          <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            {subTab === 'global' ? 'No global templates match your filters.' : 'No institution-specific logs yet.'}
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map((t, i) => {
            const enabled = isLogEnabled(t.id)
            const skills = nodesByTemplate[t.id] ?? []
            return (
              <div
                key={t.id}
                className="fade-up overflow-hidden rounded-[10px] border"
                style={{
                  backgroundColor: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)',
                  borderColor: 'var(--color-line)',
                  animationDelay: `${i * 30}ms`,
                }}
              >
                <div className="px-5 pt-5 pb-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                      {skills.length > 0 && (
                        <ToggleSwitch
                          on={enabled}
                          onChange={() => stageToggle(t.id)}
                          label={enabled ? 'Some or all skills included — click to exclude all' : 'All skills excluded — click to include all'}
                        />
                      )}
                      <span
                        className="chamfer-sm shrink-0 inline-flex items-center justify-center font-mono text-[10.5px] font-semibold tracking-[0.04em] px-1.5 py-0.5"
                        style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-gold)' }}
                      >
                        {t.logType}
                      </span>
                      <div className="min-w-0">
                        <div
                          className="font-display text-[16.5px] leading-snug truncate"
                          style={{ color: enabled ? 'var(--color-char)' : 'var(--color-char-soft)' }}
                        >
                          {t.title}
                        </div>
                        <div className="text-[12px] truncate" style={{ color: 'var(--color-char-soft)' }}>
                          {t.department} · Year {t.mbbsYear}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => navigate(`/institution-admin/log-templates/${t.id}`)}
                      className="shrink-0 inline-flex items-center gap-1 text-[12px] font-medium hover:opacity-70 transition-opacity"
                      style={{ color: 'var(--color-gold)' }}
                    >
                      {subTab === 'global' ? 'Open' : 'Open in editor'}
                      <Icon name="chevron" className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                {skills.length > 0 && (
                  <div style={{ borderTop: '1px solid var(--color-line)' }}>
                    {skills.map((n, si) => {
                      const skillEnabled = isCompetencyEnabled(n.id)
                      return (
                        <div
                          key={n.id}
                          className="flex items-center gap-3.5 px-5 py-2.5 transition-colors hover:bg-black/[0.02]"
                          style={{
                            borderBottom: si === skills.length - 1 ? undefined : '1px solid color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)',
                            borderLeft: `3px solid ${skillEnabled ? 'var(--color-gold-line)' : 'transparent'}`,
                          }}
                        >
                          <ToggleSwitch
                            on={skillEnabled}
                            onChange={() => setDraft((prev) => ({ ...prev, [n.id]: !skillEnabled }))}
                            label={skillEnabled ? 'Included — click to exclude' : 'Excluded — click to include'}
                            size="sm"
                          />
                          <span className="text-[13.5px]" style={{ color: skillEnabled ? 'var(--color-char)' : 'var(--color-char-soft)' }}>
                            {n.title || 'Untitled competency'}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {creating && (
        <CreateInstitutionTemplateModal departmentsByYear={departmentsByYear} onCreate={handleCreate} onClose={() => setCreating(false)} />
      )}
    </InstitutionAdminShell>
  )
}

function CreateInstitutionTemplateModal({
  departmentsByYear,
  onCreate,
  onClose,
}: {
  departmentsByYear: Record<MbbsYear, string[]>
  onCreate: (input: { logType: LogType; department: string; mbbsYear: MbbsYear; title: string }) => void
  onClose: () => void
}) {
  const [logType, setLogType] = useState<LogType>('SSL')
  const [mbbsYear, setMbbsYear] = useState<MbbsYear>(1)
  const [department, setDepartment] = useState('')
  const [title, setTitle] = useState('')
  const options = departmentsByYear[mbbsYear] ?? []

  function submit() {
    if (!title.trim() || !department) return
    onCreate({ logType, department, mbbsYear, title: title.trim() })
  }

  return (
    <Modal title="New institution log template" onClose={onClose}>
      <Field label="Log type">
        <div className="flex gap-2">
          {(['SSL', 'SDL'] as LogType[]).map((t) => (
            <button
              key={t}
              onClick={() => setLogType(t)}
              className="flex-1 px-3 py-2 text-[13px] font-medium border transition-colors"
              style={{
                borderColor: logType === t ? 'var(--color-gold)' : 'var(--color-line)',
                backgroundColor: logType === t ? 'var(--color-gold-soft)' : 'transparent',
                color: logType === t ? 'var(--color-gold)' : 'var(--color-char-soft)',
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </Field>
      <Field label="MBBS year">
        <select
          className={inputClass}
          style={{ borderColor: 'var(--color-line)' }}
          value={mbbsYear}
          onChange={(e) => {
            const y = Number(e.target.value) as MbbsYear
            setMbbsYear(y)
            setDepartment('')
          }}
        >
          {MBBS_YEARS.map((y) => (
            <option key={y} value={y}>
              Year {y}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Department">
        <select className={inputClass} style={{ borderColor: 'var(--color-line)' }} value={department} onChange={(e) => setDepartment(e.target.value)}>
          <option value="">Select a department</option>
          {options.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        {options.length === 0 && (
          <p className="mt-1 text-[11.5px]" style={{ color: 'var(--color-clay)' }}>
            No departments configured for Year {mbbsYear} yet — add one from Departments first.
          </p>
        )}
      </Field>
      <Field label="Title">
        <input autoFocus className={inputClass} style={{ borderColor: 'var(--color-line)' }} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Suturing — Competency Checklists" />
      </Field>
      <div className="flex justify-end gap-2 mt-2">
        <PrimaryButton onClick={submit} disabled={!title.trim() || !department}>
          Create template
        </PrimaryButton>
      </div>
    </Modal>
  )
}
