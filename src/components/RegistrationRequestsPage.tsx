import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { Badge, Card, Field, GhostButton, Modal, PrimaryButton, Skeleton, inputClass } from '../roles/primary-admin/shell/ui'
import { Icon, type IconName } from '../roles/primary-admin/shell/Icon'
import {
  accountErrorMessage,
  decideRegistration,
  syncEmailStatus,
  getRegistrationOptions,
  listAbandonedSignups,
  removeAbandonedSignups,
  watchRegistrationRequests,
  type AbandonedSignup,
  type RegistrationOptions,
} from '../lib/accounts'
import { watchInstitutionUsers } from '../lib/firestore/users'
import type { AppUser, MbbsYear, RegistrationRequest, RegistrationStatus, Role } from '../types'
import { regNoHelp, sameRegNo } from '../lib/registrationNumber'

// Self-registrations waiting for approval. Shared by Primary Admin (every
// request — the only approver for Institution Admin / Skill Lab Director,
// backup approver for everything else) and Institution Admin (Principal /
// HOD / Faculty / Student requests for their own college). The server
// function re-checks who may decide, so this page only shapes the view.

type ShellProps = { eyebrow?: string; title: string; actions?: ReactNode; children: ReactNode }

const ROLE_LABELS: Record<Role, string> = {
  primaryAdmin: 'Primary Admin',
  institutionAdmin: 'Institution Admin',
  principal: 'Principal',
  hod: 'HOD',
  faculty: 'Faculty',
  student: 'Student',
  skillLabDirector: 'Skill Lab Director',
}
const COLLEGE_ROLES: Role[] = ['student', 'faculty', 'hod', 'principal']
const ALL_ROLES: Role[] = [...COLLEGE_ROLES, 'institutionAdmin'] // Skill Lab Director: admin-created only
const YEARS: MbbsYear[] = [1, 2, 3, 4]
const fmt = (ms: number | null) =>
  ms ? new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

// Same jewel tones and emblems as the Users page, so a role reads the same
// everywhere in the admin panel.
const ROLE_COLOR: Record<Role, string> = {
  primaryAdmin: 'var(--color-gold)',
  institutionAdmin: '#7B4FA0',
  principal: '#2E6DA4',
  hod: '#9C6B1F',
  faculty: '#3F7D4A',
  student: '#A83B5C',
  skillLabDirector: '#1F8A7A',
}
const TABLE_BORDER = 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)'
const ROW_BORDER = 'color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)'

type TabKey = RegistrationStatus | 'abandoned'
const TAB_META: Record<TabKey, { label: string; icon: IconName; color: string }> = {
  pending: { label: 'Waiting', icon: 'inbox', color: 'var(--color-gold)' },
  approved: { label: 'Approved', icon: 'checkCircle', color: 'var(--color-teal)' },
  rejected: { label: 'Rejected', icon: 'close', color: 'var(--color-clay)' },
  abandoned: { label: 'Abandoned', icon: 'clock', color: '#6B7280' },
}

function initials(name: string): string {
  const parts = name.replace(/^Dr\.?\s*/i, '').trim().split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '·'
}

function RoleChip({ role }: { role: Role }) {
  const color = ROLE_COLOR[role]
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border"
      style={{ borderColor: `color-mix(in srgb, ${color} 45%, var(--color-line) 55%)`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      {ROLE_LABELS[role]}
    </span>
  )
}

function Dot({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color }}>
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      {children}
    </span>
  )
}

function SegGroup<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; l: string }[] }) {
  return (
    <div className="inline-flex border rounded-[3px] overflow-hidden" style={{ borderColor: 'var(--color-line)' }}>
      {options.map((o, i) => (
        <button
          key={o.v}
          type="button"
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

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full sm:w-[260px]">
      <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: 'var(--color-char-soft)' }} />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full pl-8 pr-3 py-2 text-[13.5px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]"
        style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)', backgroundColor: 'var(--color-paper)' }}
      />
    </div>
  )
}

const selectStyle = { borderColor: 'var(--color-line)', color: 'var(--color-char)', backgroundColor: 'var(--color-paper)' }
const selectCls = 'px-3 py-2 text-[13px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]'

function EmptyState({ title, text }: { title: string; text: string }) {
  return (
    <Card className="chamfer">
      <div className="text-center py-8">
        <div className="font-display text-[20px] mb-1.5" style={{ color: 'var(--color-char)' }}>
          {title}
        </div>
        <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
          {text}
        </p>
      </div>
    </Card>
  )
}

export function RegistrationRequestsPage({ Shell, institutionId }: { Shell: ComponentType<ShellProps>; institutionId?: string | null }) {
  const isPrimary = institutionId === undefined
  const [requests, setRequests] = useState<RegistrationRequest[] | null>(null)
  const [loadError, setLoadError] = useState(false)
  useEffect(() => {
    if (!isPrimary && !institutionId) return
    return watchRegistrationRequests(isPrimary ? 'all' : { institutionId: institutionId! }, setRequests, () => setLoadError(true))
  }, [isPrimary, institutionId])

  const [options, setOptions] = useState<RegistrationOptions | null>(null)
  useEffect(() => {
    getRegistrationOptions({}).then(setOptions).catch(() => setOptions({ institutions: [], departments: {} }))
  }, [])
  const collegeName = (id: string | null) => (id ? (options?.institutions.find((i) => i.id === id)?.name ?? '…') : 'All colleges (platform-wide)')
  const deptName = (inst: string | null, id: string | null) =>
    inst && id ? (options?.departments[inst]?.find((d) => d.id === id)?.name ?? '…') : null

  const [tab, setTab] = useState<TabKey>('pending')
  const [abandonedCount, setAbandonedCount] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all')
  const [collegeFilter, setCollegeFilter] = useState('all')
  const [emailFilter, setEmailFilter] = useState<'all' | 'verified' | 'unverified'>('all')
  const [reviewing, setReviewing] = useState<string | null>(null)

  // Primary Admin: count abandoned sign-ups for the tile even before the tab
  // is opened.
  useEffect(() => {
    if (!isPrimary) return
    listAbandonedSignups({})
      .then((r) => setAbandonedCount(r.items.length))
      .catch(() => {})
  }, [isPrimary])

  const counts = useMemo(() => {
    const c: Record<RegistrationStatus, number> = { pending: 0, approved: 0, rejected: 0 }
    ;(requests ?? []).forEach((r) => c[r.status]++)
    return c
  }, [requests])

  const list = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (requests ?? [])
      .filter((r) => r.status === tab)
      .filter((r) => roleFilter === 'all' || r.role === roleFilter)
      .filter((r) => collegeFilter === 'all' || r.institutionId === collegeFilter)
      .filter((r) => tab !== 'pending' || emailFilter === 'all' || (emailFilter === 'verified') === (r.emailVerified === true))
      .filter((r) => !q || [r.name, r.email, r.phone, r.rollNumber ?? ''].some((v) => v.toLowerCase().includes(q)))
      .sort((a, b) => (tab === 'pending' ? a.submittedAt - b.submittedAt : (b.decidedAt ?? 0) - (a.decidedAt ?? 0)))
  }, [requests, tab, search, roleFilter, collegeFilter, emailFilter])

  const filtersActive = search !== '' || roleFilter !== 'all' || collegeFilter !== 'all' || emailFilter !== 'all'
  function clearFilters() {
    setSearch('')
    setRoleFilter('all')
    setCollegeFilter('all')
    setEmailFilter('all')
  }

  const current = reviewing ? (requests ?? []).find((r) => r.uid === reviewing) ?? null : null
  const tabs: TabKey[] = isPrimary ? ['pending', 'approved', 'rejected', 'abandoned'] : ['pending', 'approved', 'rejected']
  const roleChoices = isPrimary ? ALL_ROLES : COLLEGE_ROLES

  return (
    <Shell eyebrow="People" title="Registration requests">
      <p className="text-[13.5px] mb-6 -mt-1 max-w-2xl leading-relaxed" style={{ color: 'var(--color-char-soft)' }}>
        {isPrimary
          ? 'People who signed up themselves. You approve Institution Admins; college roles are normally approved by the college’s admin, and you can step in for them.'
          : 'Students, faculty, HODs and principals who signed up for your college. Nobody can use USOP until you approve them.'}
      </p>

      {/* Status tiles — also the tabs */}
      <div className={`grid gap-2.5 mb-7 ${isPrimary ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
        {tabs.map((k, i) => {
          const meta = TAB_META[k]
          const active = tab === k
          const n = k === 'abandoned' ? abandonedCount : requests ? counts[k] : null
          return (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className="rounded-[6px] fade-up text-left px-4 py-4 border transition-all duration-200"
              style={{
                animationDelay: `${i * 40}ms`,
                backgroundColor: active
                  ? `color-mix(in srgb, ${meta.color} 16%, var(--color-paper) 84%)`
                  : `color-mix(in srgb, ${meta.color} 6%, var(--color-paper) 94%)`,
                borderColor: active ? meta.color : `color-mix(in srgb, ${meta.color} 38%, var(--color-line) 62%)`,
              }}
            >
              <div className="flex items-center gap-2 mb-2.5">
                <span
                  className="h-6 w-6 shrink-0 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: `color-mix(in srgb, ${meta.color} 24%, var(--color-paper) 76%)`, color: meta.color }}
                >
                  <Icon name={meta.icon} className="h-3.5 w-3.5" />
                </span>
                <span className="font-display text-[26px] leading-none tabular-nums" style={{ color: meta.color }}>
                  {n ?? '–'}
                </span>
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.07em] leading-tight" style={{ color: meta.color }}>
                {meta.label}
                {k === 'pending' && n ? ' · needs you' : ''}
              </div>
            </button>
          )
        })}
      </div>

      {tab === 'abandoned' ? (
        <AbandonedPanel collegeName={collegeName} onCount={setAbandonedCount} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <SearchBox value={search} onChange={setSearch} placeholder="Name, email, mobile, reg. no." />
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as Role | 'all')} className={selectCls} style={selectStyle}>
              <option value="all">All roles</option>
              {roleChoices.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            {isPrimary && (
              <select value={collegeFilter} onChange={(e) => setCollegeFilter(e.target.value)} className={selectCls} style={selectStyle}>
                <option value="all">All colleges</option>
                {(options?.institutions ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            )}
            {tab === 'pending' && (
              <SegGroup
                value={emailFilter}
                onChange={setEmailFilter}
                options={[
                  { v: 'all', l: 'Any email' },
                  { v: 'verified', l: 'Email verified' },
                  { v: 'unverified', l: 'Not verified' },
                ]}
              />
            )}
            {filtersActive && <GhostButton onClick={clearFilters}>Clear filters</GhostButton>}
          </div>

          {loadError ? (
            <EmptyState title="Couldn’t load requests" text="The database rules may not be deployed yet." />
          ) : requests === null ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-12" />
              <Skeleton className="h-64" />
            </div>
          ) : list.length === 0 ? (
            filtersActive ? (
              <EmptyState title="No requests match these filters" text="Clear the filters to see everyone again." />
            ) : (
              <EmptyState
                title={tab === 'pending' ? 'No one is waiting' : tab === 'approved' ? 'Nothing approved yet' : 'Nothing rejected'}
                text={tab === 'pending' ? 'New sign-ups for you to approve will appear here.' : 'Decided requests are kept here for reference.'}
              />
            )
          ) : (
            <div className="rounded-[10px] overflow-hidden border" style={{ backgroundColor: 'var(--color-paper)', borderColor: TABLE_BORDER }}>
              <div className="overflow-x-auto">
                <div className="min-w-[900px]">
                  <div
                    className="flex items-center gap-4 px-5 py-3 border-b text-[10.5px] font-semibold uppercase tracking-[0.08em]"
                    style={{ borderColor: TABLE_BORDER, color: 'var(--color-char-soft)' }}
                  >
                    <div className="flex-[2] min-w-[220px]">Applicant</div>
                    <div className="w-[150px] shrink-0">Role</div>
                    <div className="w-[200px] shrink-0">College · details</div>
                    <div className="w-[120px] shrink-0">{tab === 'pending' ? 'Email' : 'Decided by'}</div>
                    <div className="w-[110px] shrink-0">{tab === 'pending' ? 'Sent' : 'Decided'}</div>
                    <div className="w-[96px] shrink-0 text-right">Action</div>
                  </div>
                  {list.map((r) => {
                    const place =
                      r.role === 'student'
                        ? `Year ${r.mbbsYear}`
                        : (deptName(r.institutionId, r.departmentId) ?? (r.role === 'faculty' && r.associatedMbbsYears?.length ? `Years ${r.associatedMbbsYears.join(', ')}` : ''))
                    const details = [place, r.rollNumber].filter(Boolean).join(' · ')
                    return (
                      <div
                        key={r.uid}
                        className="flex items-center gap-4 px-5 py-3.5 border-b last:border-0 transition-colors duration-100 hover:bg-black/[0.015]"
                        style={{ borderColor: ROW_BORDER }}
                      >
                        <div className="flex-[2] min-w-[220px] flex items-center gap-3">
                          <span
                            className="shrink-0 h-9 w-9 rounded-full border flex items-center justify-center font-display text-[14px]"
                            style={{ borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)' }}
                          >
                            {initials(r.name)}
                          </span>
                          <span className="min-w-0">
                            <span className="block font-display text-[16px] leading-tight truncate" style={{ color: 'var(--color-char)' }}>
                              {r.name}
                            </span>
                            <span className="block font-mono text-[11.5px] truncate" style={{ color: 'var(--color-char-soft)' }}>
                              {r.email}
                            </span>
                            <span className="block font-mono text-[11.5px] truncate" style={{ color: 'var(--color-char-soft)' }}>
                              +91 {r.phone}
                            </span>
                          </span>
                        </div>
                        <div className="w-[150px] shrink-0">
                          <RoleChip role={r.role} />
                        </div>
                        <div className="w-[200px] shrink-0 min-w-0">
                          <div className="text-[13px] truncate" style={{ color: 'var(--color-char)' }}>
                            {collegeName(r.institutionId)}
                          </div>
                          {details && (
                            <div className="text-[11.5px] truncate" style={{ color: 'var(--color-char-soft)' }}>
                              {details}
                            </div>
                          )}
                        </div>
                        <div className="w-[120px] shrink-0 min-w-0">
                          {tab === 'pending' ? (
                            r.emailVerified ? <Dot color="var(--color-teal)">Verified</Dot> : <Dot color="var(--color-clay)">Not verified</Dot>
                          ) : (
                            <span className="text-[12.5px] truncate block" style={{ color: 'var(--color-char-soft)' }}>
                              {r.decidedByName || '—'}
                            </span>
                          )}
                        </div>
                        <div className="w-[110px] shrink-0 font-mono text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
                          {dayFmt(tab === 'pending' ? r.submittedAt : (r.decidedAt ?? r.submittedAt))}
                          <div className="font-sans text-[11px]">{ago(tab === 'pending' ? r.submittedAt : (r.decidedAt ?? r.submittedAt))}</div>
                        </div>
                        <div className="w-[96px] shrink-0 flex justify-end">
                          {tab === 'pending' ? (
                            <PrimaryButton onClick={() => setReviewing(r.uid)}>Review</PrimaryButton>
                          ) : (
                            <GhostButton onClick={() => setReviewing(r.uid)}>View</GhostButton>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {current && options && (
        <ReviewModal
          request={current}
          isPrimary={isPrimary}
          options={options}
          collegeName={collegeName}
          deptName={deptName}
          onClose={() => setReviewing(null)}
        />
      )}
    </Shell>
  )
}

// Primary Admin: logins that never finished signing up — verified a mobile
// but never sent the form, or sent it but never verified the email. The
// daily job removes them after 7 / 14 days; this removes them now.
const dayFmt = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
function ago(ms: number) {
  const d = Math.floor((Date.now() - ms) / 86_400_000)
  return d <= 0 ? 'today' : d === 1 ? '1 day ago' : `${d} days ago`
}

function AbandonedPanel({ collegeName, onCount }: { collegeName: (id: string | null) => string; onCount: (n: number) => void }) {
  const [items, setItems] = useState<AbandonedSignup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [kind, setKind] = useState<'all' | 'empty' | 'unverified'>('all')
  const [search, setSearch] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function load() {
    setError(null)
    setItems(null)
    try {
      const { items } = await listAbandonedSignups({})
      setItems(items)
      onCount(items.length)
      setSelected((prev) => new Set([...prev].filter((u) => items.some((i) => i.uid === u))))
    } catch (e) {
      setError(accountErrorMessage(e, 'Couldn’t load abandoned sign-ups.'))
    }
  }
  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (items ?? []).filter((i) => (kind === 'all' || i.kind === kind) && (!q || [i.name, i.email, i.phone].some((v) => v.toLowerCase().includes(q))))
  }, [items, kind, search])
  const allShownSelected = shown.length > 0 && shown.every((i) => selected.has(i.uid))
  const now = Date.now()
  const kindCount = (k: 'empty' | 'unverified') => (items ?? []).filter((i) => i.kind === k).length

  function toggle(uid: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      const { removed, skipped } = await removeAbandonedSignups({ uids: [...selected] })
      setNotice(`Removed ${removed} sign-up${removed === 1 ? '' : 's'}.${skipped ? ` ${skipped} skipped — they finished signing up in the meantime.` : ''}`)
      setSelected(new Set())
      setConfirm(false)
      await load()
    } catch (e) {
      setError(accountErrorMessage(e, 'Couldn’t remove them. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="text-[12.5px] mb-5 max-w-2xl leading-relaxed" style={{ color: 'var(--color-char-soft)' }}>
        Logins that never finished signing up. They can’t use USOP, but they hold their mobile number and email. They’re removed
        automatically every night (no form after 7 days, unverified email after 14 days) — remove them sooner here. Approved accounts are
        never listed.
      </p>

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <SearchBox value={search} onChange={setSearch} placeholder="Name, email, mobile" />
        <SegGroup
          value={kind}
          onChange={setKind}
          options={[
            { v: 'all', l: `All · ${items?.length ?? 0}` },
            { v: 'empty', l: `Never sent the form · ${kindCount('empty')}` },
            { v: 'unverified', l: `Email not verified · ${kindCount('unverified')}` },
          ]}
        />
        <div className="ml-auto flex items-center gap-2">
          <GhostButton onClick={() => void load()} disabled={busy || items === null}>
            Refresh
          </GhostButton>
          {confirm ? (
            <>
              <span className="text-[12.5px]" style={{ color: 'var(--color-clay)' }}>
                Remove {selected.size} for good?
              </span>
              <GhostButton tone="danger" onClick={() => void remove()} disabled={busy}>
                {busy ? 'Removing…' : 'Yes, remove'}
              </GhostButton>
              <GhostButton onClick={() => setConfirm(false)} disabled={busy}>
                Cancel
              </GhostButton>
            </>
          ) : (
            <GhostButton tone="danger" onClick={() => setConfirm(true)} disabled={selected.size === 0}>
              Remove selected{selected.size ? ` (${selected.size})` : ''}
            </GhostButton>
          )}
        </div>
      </div>

      {notice && (
        <div className="mb-3">
          <Badge tone="teal">{notice}</Badge>
        </div>
      )}
      {error && (
        <div className="mb-3">
          <Badge tone="clay">{error}</Badge>
        </div>
      )}

      {items === null && !error ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-48" />
        </div>
      ) : shown.length === 0 ? (
        <EmptyState
          title={(items ?? []).length === 0 ? 'Nothing abandoned' : 'Nothing matches'}
          text={(items ?? []).length === 0 ? 'Every login has finished signing up.' : 'Try another filter or clear the search.'}
        />
      ) : (
        <div className="rounded-[10px] overflow-hidden border" style={{ backgroundColor: 'var(--color-paper)', borderColor: TABLE_BORDER }}>
          <div className="overflow-x-auto">
            <div className="min-w-[860px]">
              <div
                className="flex items-center gap-4 px-5 py-3 border-b text-[10.5px] font-semibold uppercase tracking-[0.08em]"
                style={{ borderColor: TABLE_BORDER, color: 'var(--color-char-soft)' }}
              >
                <label className="w-5 shrink-0 flex items-center cursor-pointer" title="Select all shown">
                  <input
                    type="checkbox"
                    checked={allShownSelected}
                    onChange={() =>
                      setSelected((prev) => {
                        const next = new Set(prev)
                        shown.forEach((i) => (allShownSelected ? next.delete(i.uid) : next.add(i.uid)))
                        return next
                      })
                    }
                    className="h-4 w-4 accent-[var(--color-gold)]"
                  />
                </label>
                <div className="flex-[2] min-w-[220px]">Login</div>
                <div className="w-[170px] shrink-0">Stopped at</div>
                <div className="w-[200px] shrink-0">Role · college</div>
                <div className="w-[160px] shrink-0">Auto-removal</div>
              </div>
              {shown.map((i) => {
                const label = i.name || (i.phone ? `+91 ${i.phone}` : i.email || 'Unnamed login')
                return (
                  <label
                    key={i.uid}
                    className="flex items-center gap-4 px-5 py-3.5 border-b last:border-0 cursor-pointer transition-colors duration-100 hover:bg-black/[0.015]"
                    style={{ borderColor: ROW_BORDER, backgroundColor: selected.has(i.uid) ? 'color-mix(in srgb, var(--color-gold) 7%, transparent)' : undefined }}
                  >
                    <span className="w-5 shrink-0 flex items-center">
                      <input type="checkbox" checked={selected.has(i.uid)} onChange={() => toggle(i.uid)} className="h-4 w-4 accent-[var(--color-gold)]" />
                    </span>
                    <div className="flex-[2] min-w-[220px] flex items-center gap-3">
                      <span
                        className="shrink-0 h-9 w-9 rounded-full border border-dashed flex items-center justify-center font-display text-[14px]"
                        style={{ borderColor: 'var(--color-char-soft)', color: 'var(--color-char-soft)' }}
                      >
                        {i.name ? initials(i.name) : '?'}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-display text-[16px] leading-tight truncate" style={{ color: 'var(--color-char)' }}>
                          {label}
                        </span>
                        {i.email && (
                          <span className="block font-mono text-[11.5px] truncate" style={{ color: 'var(--color-char-soft)' }}>
                            {i.email}
                          </span>
                        )}
                        {i.phone && i.name && (
                          <span className="block font-mono text-[11.5px] truncate" style={{ color: 'var(--color-char-soft)' }}>
                            +91 {i.phone}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="w-[170px] shrink-0">
                      {i.kind === 'empty' ? <Dot color="var(--color-char-soft)">Never sent the form</Dot> : <Dot color="var(--color-clay)">Email not verified</Dot>}
                      <div className="text-[11px] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
                        {i.kind === 'empty' ? 'Signed up' : 'Sent'} {ago(i.since)}
                      </div>
                    </div>
                    <div className="w-[200px] shrink-0 min-w-0">
                      {i.role ? <RoleChip role={i.role} /> : <span className="text-[12.5px]" style={{ color: 'var(--color-char-soft)' }}>—</span>}
                      {i.institutionId && (
                        <div className="text-[11.5px] truncate mt-1" style={{ color: 'var(--color-char-soft)' }}>
                          {collegeName(i.institutionId)}
                        </div>
                      )}
                    </div>
                    <div className="w-[160px] shrink-0 font-mono text-[11.5px]" style={{ color: i.autoRemoveAt <= now ? 'var(--color-clay)' : 'var(--color-char-soft)' }}>
                      {i.autoRemoveAt <= now ? 'Tonight' : dayFmt(i.autoRemoveAt)}
                    </div>
                  </label>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function ReviewModal({
  request: r,
  isPrimary,
  options,
  collegeName,
  deptName,
  onClose,
}: {
  request: RegistrationRequest
  isPrimary: boolean
  options: RegistrationOptions
  collegeName: (id: string | null) => string
  deptName: (inst: string | null, id: string | null) => string | null
  onClose: () => void
}) {
  const pending = r.status === 'pending'
  // Editable copy — the approver may correct details before approving.
  const [name, setName] = useState(r.name)
  const [role, setRole] = useState<Role>(r.role)
  const [institutionId, setInstitutionId] = useState(r.institutionId ?? '')
  const [mbbsYear, setMbbsYear] = useState<MbbsYear>(r.mbbsYear ?? 1)
  const [rollNumber, setRollNumber] = useState(r.rollNumber ?? '')
  const [associatedYears, setAssociatedYears] = useState<MbbsYear[]>(r.associatedMbbsYears ?? [])
  const [departmentId, setDepartmentId] = useState(r.departmentId ?? '')
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Ask the server for the live email status (the person may have clicked
  // the link a moment ago); it also updates the request for the list.
  const [emailVerified, setEmailVerified] = useState(r.emailVerified === true)
  const [checkingEmail, setCheckingEmail] = useState(false)
  async function recheckEmail() {
    setCheckingEmail(true)
    try {
      setEmailVerified((await syncEmailStatus({ uid: r.uid })).emailVerified)
    } catch {
      /* keep what we have */
    } finally {
      setCheckingEmail(false)
    }
  }
  useEffect(() => {
    if (r.status === 'pending' && !r.emailVerified) void recheckEmail()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r.uid])
  useEffect(() => {
    if (r.emailVerified) setEmailVerified(true)
  }, [r.emailVerified])

  const platformWide = role === 'skillLabDirector'
  const needsDept = role === 'faculty' || role === 'hod'
  const roleChoices = isPrimary ? ALL_ROLES : COLLEGE_ROLES
  const deptOptions = useMemo(() => {
    const all = institutionId ? (options.departments[institutionId] ?? []) : []
    return role === 'faculty' ? all.filter((d) => associatedYears.includes(d.mbbsYear)) : all
  }, [options, institutionId, role, associatedYears])

  // People already in this college, for the duplicate / clash warnings.
  const [collegeUsers, setCollegeUsers] = useState<AppUser[]>([])
  useEffect(() => {
    if (!institutionId || platformWide) {
      setCollegeUsers([])
      return
    }
    return watchInstitutionUsers(institutionId, setCollegeUsers)
  }, [institutionId, platformWide])

  const warnings = useMemo(() => {
    const w: string[] = []
    if (rollNumber.trim()) {
      const clash = collegeUsers.find((u) => sameRegNo(u.rollNumber, rollNumber))
      if (clash) w.push(`Registration number ${rollNumber.trim()} already belongs to ${clash.name}.`)
    }
    if (role === 'hod' && departmentId) {
      const hod = collegeUsers.find((u) => u.role === 'hod' && u.departmentId === departmentId && u.active)
      if (hod) w.push(`${deptName(institutionId, departmentId)} already has an HOD: ${hod.name}.`)
    }
    if (role === 'principal') {
      const p = collegeUsers.find((u) => u.role === 'principal' && u.active)
      if (p) w.push(`This college already has a Principal: ${p.name}.`)
    }
    if (role === 'institutionAdmin') {
      const a = collegeUsers.filter((u) => u.role === 'institutionAdmin' && u.active)
      if (a.length) w.push(`This college already has ${a.length} Institution Admin${a.length > 1 ? 's' : ''}: ${a.map((u) => u.name).join(', ')}.`)
    }
    if (needsDept && departmentId && !deptOptions.some((d) => d.id === departmentId)) w.push('The chosen department isn’t available for this college / these years.')
    return w
  }, [role, rollNumber, departmentId, institutionId, collegeUsers, deptName, needsDept, deptOptions])

  const valid =
    name.trim() !== '' &&
    (platformWide || institutionId !== '') &&
    (!needsDept || deptOptions.some((d) => d.id === departmentId)) &&
    rollNumber.trim() !== '' &&
    (role !== 'faculty' || associatedYears.length > 0)

  async function decide(decision: 'approve' | 'reject') {
    setBusy(true)
    setError(null)
    try {
      await decideRegistration(
        decision === 'reject'
          ? { uid: r.uid, decision, reason: reason.trim() }
          : {
              uid: r.uid,
              decision,
              edits: {
                name: name.trim(),
                role,
                institutionId: platformWide ? null : institutionId,
                departmentId: needsDept ? departmentId : null,
                mbbsYear: role === 'student' ? mbbsYear : null,
                associatedMbbsYears: role === 'faculty' ? associatedYears : null,
                rollNumber: rollNumber.trim().replace(/\s+/g, ' '),
              },
            },
      )
      onClose()
    } catch (e) {
      setError(accountErrorMessage(e, 'Couldn’t save the decision. Please try again.'))
      setBusy(false)
    }
  }

  const fieldStyle = { borderColor: 'var(--color-line)' }

  return (
    <Modal title={pending ? `Review ${r.name}` : r.name} onClose={onClose} wide>
      <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[13px] mb-5">
        <span style={{ color: 'var(--color-char-soft)' }}>Mobile</span>
        <span className="font-mono" style={{ color: 'var(--color-char)' }}>
          +91 {r.phone} <span className="text-[11px] font-sans" style={{ color: 'var(--color-teal)' }}>· verified by OTP</span>
        </span>
        <span style={{ color: 'var(--color-char-soft)' }}>Email</span>
        <span style={{ color: 'var(--color-char)' }}>
          {r.email}{' '}
          {pending &&
            (emailVerified ? (
              <span className="text-[11px]" style={{ color: 'var(--color-teal)' }}>
                · verified by link
              </span>
            ) : (
              <span className="text-[11px]" style={{ color: 'var(--color-clay)' }}>
                · not verified yet{' '}
                <button type="button" onClick={() => void recheckEmail()} disabled={checkingEmail} className="underline ml-1" style={{ color: 'var(--color-char-soft)' }}>
                  {checkingEmail ? 'checking…' : 'check again'}
                </button>
              </span>
            ))}
        </span>
        <span style={{ color: 'var(--color-char-soft)' }}>Sent</span>
        <span style={{ color: 'var(--color-char)' }}>
          {fmt(r.submittedAt)}
          {r.firstSubmittedAt && r.firstSubmittedAt !== r.submittedAt ? ` (resent — first sent ${fmt(r.firstSubmittedAt)})` : ''}
        </span>
        {!pending && (
          <>
            <span style={{ color: 'var(--color-char-soft)' }}>{r.status === 'approved' ? 'Approved' : 'Rejected'}</span>
            <span style={{ color: 'var(--color-char)' }}>
              {fmt(r.decidedAt)} by {r.decidedByName || '—'}
            </span>
          </>
        )}
        {r.status === 'rejected' && r.reason && (
          <>
            <span style={{ color: 'var(--color-char-soft)' }}>Reason</span>
            <span style={{ color: 'var(--color-clay)' }}>{r.reason}</span>
          </>
        )}
      </div>

      {pending ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5">
          <Field label="Full name">
            <input className={inputClass} style={fieldStyle} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Role">
            <select className={inputClass} style={fieldStyle} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              {roleChoices.map((x) => (
                <option key={x} value={x}>
                  {ROLE_LABELS[x]}
                </option>
              ))}
            </select>
          </Field>
          {!platformWide && (
            <Field label="College">
              <select
                className={inputClass}
                style={{ ...fieldStyle, opacity: isPrimary ? 1 : 0.6 }}
                value={institutionId}
                disabled={!isPrimary}
                onChange={(e) => setInstitutionId(e.target.value)}
              >
                <option value="">Select a college</option>
                {options.institutions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {role === 'student' && (
            <>
              <Field label="MBBS year">
                <select className={inputClass} style={fieldStyle} value={mbbsYear} onChange={(e) => setMbbsYear(Number(e.target.value) as MbbsYear)}>
                  {YEARS.map((y) => (
                    <option key={y} value={y}>
                      Year {y}
                    </option>
                  ))}
                </select>
              </Field>
            </>
          )}
          <Field label="Registration number">
            <input
              className={inputClass}
              style={{ borderColor: rollNumber.trim() ? 'var(--color-line)' : 'var(--color-clay)' }}
              value={rollNumber}
              onChange={(e) => setRollNumber(e.target.value)}
              placeholder={regNoHelp(role).placeholder}
            />
            {!rollNumber.trim() && (
              <p className="mt-1 text-[11.5px]" style={{ color: 'var(--color-clay)' }}>
                Needed to approve. {regNoHelp(role).hint}
              </p>
            )}
          </Field>
          {role === 'faculty' && (
            <div className="sm:col-span-2 mb-4">
              <span className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
                MBBS years they teach
              </span>
              <div className="flex flex-wrap gap-2">
                {YEARS.map((y) => {
                  const on = associatedYears.includes(y)
                  return (
                    <button
                      key={y}
                      type="button"
                      onClick={() => setAssociatedYears((p) => (p.includes(y) ? p.filter((v) => v !== y) : [...p, y].sort()))}
                      className="px-3 py-1.5 text-[12.5px] font-medium border"
                      style={{
                        borderColor: on ? 'var(--color-gold)' : 'var(--color-line)',
                        backgroundColor: on ? 'var(--color-gold-soft)' : 'transparent',
                        color: on ? 'var(--color-gold)' : 'var(--color-char-soft)',
                      }}
                    >
                      Year {y}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {needsDept && (
            <Field label="Department">
              <select className={inputClass} style={fieldStyle} value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">Select a department</option>
                {deptOptions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} — Year {d.mbbsYear}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[13px] mb-4">
          <span style={{ color: 'var(--color-char-soft)' }}>Role</span>
          <span style={{ color: 'var(--color-char)' }}>{ROLE_LABELS[r.role]}</span>
          <span style={{ color: 'var(--color-char-soft)' }}>College</span>
          <span style={{ color: 'var(--color-char)' }}>{collegeName(r.institutionId)}</span>
          {r.role === 'student' && (
            <>
              <span style={{ color: 'var(--color-char-soft)' }}>Year</span>
              <span style={{ color: 'var(--color-char)' }}>Year {r.mbbsYear}</span>
            </>
          )}
          {r.rollNumber && (
            <>
              <span style={{ color: 'var(--color-char-soft)' }}>Reg. no.</span>
              <span className="font-mono text-[12.5px]" style={{ color: 'var(--color-char)' }}>
                {r.rollNumber}
              </span>
            </>
          )}
          {deptName(r.institutionId, r.departmentId) && (
            <>
              <span style={{ color: 'var(--color-char-soft)' }}>Department</span>
              <span style={{ color: 'var(--color-char)' }}>{deptName(r.institutionId, r.departmentId)}</span>
            </>
          )}
        </div>
      )}

      {pending && warnings.length > 0 && (
        <div className="rounded-[8px] px-3.5 py-2.5 mb-4 text-[12.5px] space-y-1" style={{ backgroundColor: 'var(--color-gold-soft)', color: 'var(--color-char)' }}>
          {warnings.map((w) => (
            <div key={w}>⚠ {w}</div>
          ))}
        </div>
      )}

      {pending && rejecting && (
        <Field label="Reason (the person will see this)">
          <textarea
            autoFocus
            rows={3}
            className={inputClass}
            style={fieldStyle}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Registration number doesn’t match our records — please check it."
          />
        </Field>
      )}

      {pending && !emailVerified && !rejecting && (
        <div className="rounded-[8px] px-3.5 py-2.5 mb-4 text-[12.5px]" style={{ backgroundColor: 'var(--color-clay-soft)', color: 'var(--color-char)' }}>
          Waiting for {r.name.split(' ')[0] || 'them'} to click the link we emailed to <span className="font-medium">{r.email}</span>. You can approve once
          it’s verified — or reject with a reason if the email looks wrong.
        </div>
      )}

      {error && (
        <div className="mb-4">
          <Badge tone="clay">{error}</Badge>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        {!pending ? (
          <GhostButton onClick={onClose}>Close</GhostButton>
        ) : rejecting ? (
          <>
            <GhostButton onClick={() => setRejecting(false)} disabled={busy}>
              Back
            </GhostButton>
            <GhostButton tone="danger" onClick={() => decide('reject')} disabled={busy || reason.trim() === ''}>
              {busy ? 'Saving…' : 'Reject request'}
            </GhostButton>
          </>
        ) : (
          <>
            <GhostButton tone="danger" onClick={() => setRejecting(true)} disabled={busy}>
              Reject…
            </GhostButton>
            <PrimaryButton onClick={() => decide('approve')} disabled={busy || !valid || !emailVerified}>
              {busy ? 'Approving…' : 'Approve'}
            </PrimaryButton>
          </>
        )}
      </div>
    </Modal>
  )
}
