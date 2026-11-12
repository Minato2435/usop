import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PrimaryAdminShell } from './shell/PrimaryAdminShell'
import { Card, GhostButton, PrimaryButton, Skeleton } from './shell/ui'
import { Icon, type IconName } from './shell/Icon'
import { UserFormModal } from './shell/UserFormModal'
import { watchUsers, setUserStatus, type UserStatus } from '../../lib/firestore/users'
import { watchInstitutions } from '../../lib/firestore/institutions'
import { watchAllDepartments, watchAllDepartmentOverrides } from '../../lib/firestore/departments'
import { AcademicCell, UserFilterBar, applyUserFilters, useStoredUserFilters, useUserAcademics } from '../../components/users/UserListFilters'
import type { AppUser, Department, Institution, InstitutionDepartmentOverride, Role } from '../../types'

const ROLE_LABELS: Record<Role, string> = {
  primaryAdmin: 'Primary Admin',
  institutionAdmin: 'Institution Admin',
  principal: 'Principal',
  hod: 'HOD',
  faculty: 'Faculty',
  student: 'Student',
  skillLabDirector: 'Skill Lab Director',
}
const ROLES: Role[] = ['primaryAdmin', 'skillLabDirector', 'student', 'faculty', 'hod', 'principal', 'institutionAdmin']

// Three visual tiers, admin-weight down to instructional-weight, so the role
// chip communicates seniority at a glance rather than being an arbitrary
// palette assignment.
function roleTone(role: Role): { border: string; color: string } {
  if (role === 'primaryAdmin') return { border: 'var(--color-gold)', color: 'var(--color-gold)' }
  if (role === 'institutionAdmin' || role === 'principal' || role === 'skillLabDirector') return { border: 'var(--color-gold-line)', color: 'var(--color-gold)' }
  if (role === 'hod') return { border: 'var(--color-char-soft)', color: 'var(--color-char)' }
  return { border: 'var(--color-line)', color: 'var(--color-char-soft)' }
}

// One emblem per role, standing in for what that role actually does —
// authority (crest), an institution (building), oversight (eye), a single
// department (departments), marking up a submission (edit), study
// (graduation cap), and approving a certificate (certificate) — used on the
// role strip so each count reads as a stat, not a lone glyph.
const ROLE_ICONS: Record<Role, IconName> = {
  primaryAdmin: 'crest',
  institutionAdmin: 'institutions',
  principal: 'eye',
  hod: 'departments',
  faculty: 'edit',
  student: 'cap',
  skillLabDirector: 'certificate',
}

// A small curated set of saturated jewel-tone hues — one per role — so each
// cell in the strip is genuinely distinguishable and reads clearly against
// the paper ground, rather than shading along a single muted gradient.
// Deliberately doesn't reuse --color-teal/--color-clay: those are reserved
// elsewhere on this page for active/inactive status, and reusing them here
// would blur that meaning.
const ROLE_COLOR: Record<Role, string> = {
  primaryAdmin: 'var(--color-gold)', // #B8863B — the app's one apex accent
  institutionAdmin: '#7B4FA0', // royal plum
  principal: '#2E6DA4', // cobalt blue
  hod: '#9C6B1F', // amber bronze
  faculty: '#3F7D4A', // forest green
  student: '#A83B5C', // berry rose
  skillLabDirector: '#1F8A7A', // deep teal — a second platform-wide, approval-flavored tone
}
function roleColor(role: Role): string {
  return ROLE_COLOR[role]
}

function userStatus(u: AppUser): UserStatus {
  if (u.active) return 'active'
  return u.rejected ? 'rejected' : 'paused'
}

const STATUS_LABELS: Record<UserStatus, string> = { active: 'Active', paused: 'Paused', rejected: 'Rejected' }
const STATUS_COLORS: Record<UserStatus, string> = {
  active: 'var(--color-teal)',
  paused: 'var(--color-char-soft)',
  rejected: 'var(--color-clay)',
}

function initials(name: string): string {
  const cleaned = name.replace(/^Dr\.?\s*/i, '').trim()
  const parts = cleaned.split(/\s+/).filter(Boolean).slice(0, 2)
  return parts.map((w) => w[0]?.toUpperCase() ?? '').join('') || '—'
}

export function PrimaryAdminUsersPage() {
  const navigate = useNavigate()
  const [users, setUsers] = useState<AppUser[] | null>(null)
  const [institutions, setInstitutions] = useState<Institution[] | null>(null)
  const [departments, setDepartments] = useState<Department[] | null>(null)
  const [busyUid, setBusyUid] = useState<string | null>(null)
  const [newUserOpen, setNewUserOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<AppUser | null>(null)

  const [overrides, setOverrides] = useState<InstitutionDepartmentOverride[]>([])
  const [filters, setFilters] = useStoredUserFilters('usop.admin.userFilters', { departmentNeedsCollege: true })

  useEffect(() => watchUsers(setUsers), [])
  useEffect(() => watchInstitutions(setInstitutions), [])
  useEffect(() => watchAllDepartments(setDepartments), [])
  useEffect(() => watchAllDepartmentOverrides(setOverrides), [])

  const institutionName = useMemo(() => {
    const map = new Map((institutions ?? []).map((i) => [i.id, i.name]))
    return (id: string | null) => (id ? (map.get(id) ?? '—') : null)
  }, [institutions])

  const academics = useUserAcademics(departments ?? [], overrides)

  const loading = !users || !institutions || !departments
  const list = useMemo(() => users ?? [], [users])

  const filtered = useMemo(() => applyUserFilters(list, filters, academics, institutionName), [list, filters, academics, institutionName])
  // Role tiles count everyone matching the other filters (so picking a
  // college shows that college's breakdown).
  const roleCounts = useMemo(() => {
    const m = new Map<Role, number>()
    applyUserFilters(list, { ...filters, role: 'all' }, academics, institutionName).forEach((u) => m.set(u.role, (m.get(u.role) ?? 0) + 1))
    return m
  }, [list, filters, academics, institutionName])
  const pausedCount = list.filter((u) => userStatus(u) === 'paused').length
  const rejectedCount = list.filter((u) => userStatus(u) === 'rejected').length

  async function changeStatus(u: AppUser, status: UserStatus) {
    setBusyUid(u.uid)
    await setUserStatus(u.uid, status)
    setBusyUid(null)
  }

  return (
    <PrimaryAdminShell
      eyebrow="People & institutions"
      title="Users"
      actions={
        <div className="flex items-center gap-2">
          <GhostButton onClick={() => navigate('/admin/users/import')}>
            <Icon name="upload" className="h-3.5 w-3.5" />
            Bulk add
          </GhostButton>
          <PrimaryButton onClick={() => setNewUserOpen(true)}>
            <Icon name="plus" className="h-3.5 w-3.5" />
            New user
          </PrimaryButton>
        </div>
      }
    >
      {!loading && (
        <p className="text-[13px] mb-5" style={{ color: 'var(--color-char-soft)' }}>
          {list.length} account{list.length === 1 ? '' : 's'} on the platform
          {pausedCount > 0 && ` · ${pausedCount} paused`}
          {rejectedCount > 0 && ` · ${rejectedCount} rejected`}
        </p>
      )}

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-64" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5 mb-7">
            {ROLES.map((r, i) => {
              const active = filters.role === r
              const color = roleColor(r)
              return (
                <button
                  key={r}
                  onClick={() => setFilters({ ...filters, role: active ? 'all' : r })}
                  className="rounded-[6px] fade-up text-left px-4 py-4 border transition-all duration-200"
                  style={{
                    animationDelay: `${i * 40}ms`,
                    // The tile's own paper-colored ground, tinted by the role's
                    // hue and picked up again in the border — so the shape
                    // reads as etched into the page rather than a white card
                    // floating on top of it.
                    backgroundColor: active
                      ? `color-mix(in srgb, ${color} 16%, var(--color-paper) 84%)`
                      : `color-mix(in srgb, ${color} 6%, var(--color-paper) 94%)`,
                    borderColor: active ? color : `color-mix(in srgb, ${color} 38%, var(--color-line) 62%)`,
                  }}
                >
                  <div className="flex items-center gap-2 mb-2.5">
                    <span
                      className="h-6 w-6 shrink-0 rounded-full flex items-center justify-center"
                      style={{ backgroundColor: `color-mix(in srgb, ${color} 24%, var(--color-paper) 76%)`, color }}
                    >
                      <Icon name={ROLE_ICONS[r]} className="h-3.5 w-3.5" />
                    </span>
                    <span className="font-display text-[26px] leading-none tabular-nums" style={{ color }}>
                      {roleCounts.get(r) ?? 0}
                    </span>
                  </div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.07em] leading-tight" style={{ color }}>
                    {ROLE_LABELS[r]}
                  </div>
                </button>
              )
            })}
          </div>

          <UserFilterBar f={filters} onChange={setFilters} ac={academics} institutions={institutions ?? []} shown={filtered.length} total={list.length} />

          {filtered.length === 0 ? (
            <Card className="chamfer">
              <div className="text-center py-8">
                <div className="font-display text-[20px] mb-1.5" style={{ color: 'var(--color-char)' }}>
                  No users match these filters
                </div>
                <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
                  Clear the filters to see everyone again.
                </p>
              </div>
            </Card>
          ) : (
            // Deliberately not the shared <Card> — that's white
            // (--color-paper-raised) everywhere else. This table sits on
            // the page's own paper ground instead, distinguished only by
            // its border, so it merges with the page rather than reading
            // as a white panel dropped on top of it.
            <div
              className="rounded-[10px] overflow-hidden border"
              style={{
                backgroundColor: 'var(--color-paper)',
                borderColor: 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)',
              }}
            >
              <div className="overflow-x-auto">
                <div className="min-w-[880px]">
                  <div
                    className="flex items-center gap-4 px-5 py-3 border-b text-[10.5px] font-semibold uppercase tracking-[0.08em]"
                    style={{
                      borderColor: 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)',
                      color: 'var(--color-char-soft)',
                    }}
                  >
                    <div className="flex-[2] min-w-[220px]">Name</div>
                    <div className="w-[150px] shrink-0">Role</div>
                    <div className="w-[190px] shrink-0">Institution</div>
                    <div className="w-[160px] shrink-0">Year · Department</div>
                    <div className="w-[92px] shrink-0">Status</div>
                    <div className="w-[132px] shrink-0 text-right">Actions</div>
                  </div>

                  {filtered.map((u) => (
                    <UserRow
                      key={u.uid}
                      user={u}
                      institution={institutionName(u.institutionId)}
                      academic={academics.academic(u)}
                      busy={busyUid === u.uid}
                      onChangeStatus={(status) => changeStatus(u, status)}
                      onEdit={() => setEditingUser(u)}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {(newUserOpen || editingUser) && (
        <UserFormModal
          institutions={institutions ?? []}
          departments={departments ?? []}
          existingUsers={list}
          editingUser={editingUser ?? undefined}
          onClose={() => {
            setNewUserOpen(false)
            setEditingUser(null)
          }}
          onSaved={() => {
            setNewUserOpen(false)
            setEditingUser(null)
          }}
        />
      )}
    </PrimaryAdminShell>
  )
}

function UserRow({
  user: u,
  institution,
  academic,
  busy,
  onChangeStatus,
  onEdit,
}: {
  user: AppUser
  institution: string | null
  academic: { main: string; sub: string | null }
  busy: boolean
  onChangeStatus: (status: UserStatus) => void
  onEdit: () => void
}) {
  const tone = roleTone(u.role)
  const status = userStatus(u)
  return (
    <div
      className="flex items-center gap-4 px-5 py-3.5 border-b last:border-0 transition-colors duration-100 hover:bg-black/[0.015]"
      style={{ borderColor: 'color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)' }}
    >
      <div className="flex-[2] min-w-[220px] flex items-center gap-3">
        <span
          className="shrink-0 h-9 w-9 rounded-full border flex items-center justify-center font-display text-[14px]"
          style={{ borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)' }}
        >
          {initials(u.name)}
        </span>
        <span className="min-w-0">
          <span className="block font-display text-[16px] leading-tight truncate" style={{ color: 'var(--color-char)' }}>
            {u.name}
          </span>
          <span className="block font-mono text-[11.5px] truncate" style={{ color: 'var(--color-char-soft)' }}>
            {u.email}
          </span>
          {(u.phone || u.rollNumber) && (
            <span className="block font-mono text-[11.5px] truncate" style={{ color: 'var(--color-char-soft)' }}>
              {[u.phone ? `+91 ${u.phone}` : null, u.rollNumber ? `Reg ${u.rollNumber}` : null].filter(Boolean).join(' · ')}
            </span>
          )}
        </span>
      </div>

      <div className="w-[150px] shrink-0">
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border"
          style={{ borderColor: tone.border, color: tone.color }}
        >
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: tone.color }} />
          {ROLE_LABELS[u.role]}
        </span>
      </div>

      <div
        className="w-[190px] shrink-0 text-[13px] truncate"
        style={{ color: institution ? 'var(--color-char)' : 'var(--color-char-soft)' }}
      >
        {institution ?? 'All institutions'}
      </div>

      <AcademicCell academic={academic} />

      <div className="w-[92px] shrink-0">
        <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: STATUS_COLORS[status] }}>
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLORS[status] }} />
          {STATUS_LABELS[status]}
        </span>
      </div>

      <div className="w-[132px] shrink-0 flex justify-end gap-0.5">
        <RowIconButton title="Edit user" icon="edit" busy={busy} onClick={onEdit} />
        {status === 'active' && (
          <RowIconButton title="Pause account" icon="pause" busy={busy} tone="danger" onClick={() => onChangeStatus('paused')} />
        )}
        {status !== 'active' && (
          <RowIconButton title="Resume account" icon="play" busy={busy} onClick={() => onChangeStatus('active')} />
        )}
        {status !== 'rejected' && (
          <RowIconButton title="Reject account" icon="close" busy={busy} tone="danger" onClick={() => onChangeStatus('rejected')} />
        )}
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
