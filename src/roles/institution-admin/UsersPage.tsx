import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { InstitutionAdminShell } from './shell/InstitutionAdminShell'
import { Card, GhostButton, PrimaryButton, Skeleton } from '../primary-admin/shell/ui'
import { Icon, type IconName } from '../primary-admin/shell/Icon'
import { UserFormModal } from '../primary-admin/shell/UserFormModal'
import { watchInstitutionUsers, setUserStatus, type UserStatus } from '../../lib/firestore/users'
import { watchInstitutionDepartments, watchCatalogDepartments } from '../../lib/firestore/departments'
import { watchInstitution } from '../../lib/firestore/institutions'
import type { AppUser, Department, Institution, Role } from '../../types'

const ROLE_LABELS: Record<Role, string> = {
  primaryAdmin: 'Primary Admin',
  institutionAdmin: 'Institution Admin',
  principal: 'Principal',
  hod: 'HOD',
  faculty: 'Faculty',
  student: 'Student',
  skillLabDirector: 'Skill Lab Director',
}
// An institution admin shouldn't create peer or superior admin accounts.
const ALLOWED_ROLES: Role[] = ['principal', 'hod', 'faculty', 'student']

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

export function InstitutionAdminUsersPage() {
  const { appUser } = useAuth()
  const institutionId = appUser?.institutionId ?? null

  const [users, setUsers] = useState<AppUser[] | null>(null)
  const [institution, setInstitution] = useState<Institution | null>(null)
  const [catalogDepartments, setCatalogDepartments] = useState<Department[]>([])
  const [ownDepartments, setOwnDepartments] = useState<Department[]>([])
  const [busyUid, setBusyUid] = useState<string | null>(null)
  const [newUserOpen, setNewUserOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<AppUser | null>(null)

  const [search, setSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState<Role | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | UserStatus>('all')

  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionUsers(institutionId, setUsers)
  }, [institutionId])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitution(institutionId, setInstitution)
  }, [institutionId])
  useEffect(() => watchCatalogDepartments(setCatalogDepartments), [])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionDepartments(institutionId, setOwnDepartments)
  }, [institutionId])

  const departmentName = useMemo(() => {
    const map = new Map([...catalogDepartments, ...ownDepartments].map((d) => [d.id, d.name]))
    return (id: string | null) => (id ? (map.get(id) ?? '—') : null)
  }, [catalogDepartments, ownDepartments])

  // A student is bound by year only — every department enabled for their
  // college in that year applies — so there's no single department to
  // name; every other role still uses its own departmentId.
  const departmentDisplay = useMemo(() => {
    return (u: AppUser) => (u.role === 'student' ? (u.mbbsYear ? `All Year ${u.mbbsYear}` : null) : departmentName(u.departmentId))
  }, [departmentName])

  const loading = !users || !institution
  const list = users ?? []
  const q = search.trim().toLowerCase()
  const filtered = list.filter(
    (u) =>
      (roleFilter === 'all' || u.role === roleFilter) &&
      (statusFilter === 'all' || userStatus(u) === statusFilter) &&
      (q === '' || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)),
  )
  const filtersActive = roleFilter !== 'all' || statusFilter !== 'all' || q !== ''

  async function changeStatus(u: AppUser, status: UserStatus) {
    setBusyUid(u.uid)
    await setUserStatus(u.uid, status)
    setBusyUid(null)
  }

  return (
    <InstitutionAdminShell
      eyebrow="People"
      title="Users"
      actions={
        <PrimaryButton onClick={() => setNewUserOpen(true)}>
          <Icon name="plus" className="h-3.5 w-3.5" />
          New user
        </PrimaryButton>
      }
    >
      {!loading && (
        <p className="text-[13px] mb-5" style={{ color: 'var(--color-char-soft)' }}>
          {filtered.length} of {list.length} account{list.length === 1 ? '' : 's'} at {institution!.name}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative w-full sm:w-[260px]">
          <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: 'var(--color-char-soft)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or email"
            className="w-full pl-8 pr-3 py-2 text-[13.5px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]"
            style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as Role | 'all')}
          className="px-3 py-2 text-[13px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]"
          style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)', backgroundColor: 'var(--color-paper)' }}
        >
          <option value="all">All roles</option>
          {ALLOWED_ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | UserStatus)}
          className="px-3 py-2 text-[13px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]"
          style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)', backgroundColor: 'var(--color-paper)' }}
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="rejected">Rejected</option>
        </select>
        {filtersActive && (
          <GhostButton
            onClick={() => {
              setRoleFilter('all')
              setStatusFilter('all')
              setSearch('')
            }}
          >
            Clear filters
          </GhostButton>
        )}
      </div>

      {loading ? (
        <div className="space-y-4">
          <Skeleton className="h-64" />
        </div>
      ) : filtered.length === 0 ? (
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
        <div
          className="rounded-[10px] overflow-hidden border"
          style={{ backgroundColor: 'var(--color-paper)', borderColor: 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)' }}
        >
          <div className="overflow-x-auto">
            <div className="min-w-[760px]">
              <div
                className="flex items-center gap-4 px-5 py-3 border-b text-[10.5px] font-semibold uppercase tracking-[0.08em]"
                style={{ borderColor: 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)', color: 'var(--color-char-soft)' }}
              >
                <div className="flex-[2] min-w-[220px]">Name</div>
                <div className="w-[140px] shrink-0">Role</div>
                <div className="w-[160px] shrink-0">Department</div>
                <div className="w-[92px] shrink-0">Status</div>
                <div className="w-[132px] shrink-0 text-right">Actions</div>
              </div>
              {filtered.map((u) => (
                <UserRow
                  key={u.uid}
                  user={u}
                  department={departmentDisplay(u)}
                  busy={busyUid === u.uid}
                  onChangeStatus={(status) => changeStatus(u, status)}
                  onEdit={() => setEditingUser(u)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {(newUserOpen || editingUser) && institution && (
        <UserFormModal
          institutions={[institution]}
          departments={[...catalogDepartments, ...ownDepartments]}
          existingUsers={list}
          editingUser={editingUser ?? undefined}
          allowedRoles={ALLOWED_ROLES}
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
    </InstitutionAdminShell>
  )
}

function UserRow({
  user: u,
  department,
  busy,
  onChangeStatus,
  onEdit,
}: {
  user: AppUser
  department: string | null
  busy: boolean
  onChangeStatus: (status: UserStatus) => void
  onEdit: () => void
}) {
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
          {u.phone && (
            <span className="block font-mono text-[11.5px] truncate" style={{ color: 'var(--color-char-soft)' }}>
              +91 {u.phone}
            </span>
          )}
        </span>
      </div>

      <div className="w-[140px] shrink-0">
        <span
          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border"
          style={{ borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)' }}
        >
          {ROLE_LABELS[u.role]}
        </span>
      </div>

      <div className="w-[160px] shrink-0 text-[13px] truncate" style={{ color: 'var(--color-char-soft)' }}>
        {department ?? '—'}
      </div>

      <div className="w-[92px] shrink-0">
        <span className="inline-flex items-center gap-1.5 text-[12.5px]" style={{ color: STATUS_COLORS[status] }}>
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: STATUS_COLORS[status] }} />
          {STATUS_LABELS[status]}
        </span>
      </div>

      <div className="w-[132px] shrink-0 flex justify-end gap-0.5">
        <RowIconButton title="Edit user" icon="edit" busy={busy} onClick={onEdit} />
        {status === 'active' && <RowIconButton title="Pause account" icon="pause" busy={busy} tone="danger" onClick={() => onChangeStatus('paused')} />}
        {status !== 'active' && <RowIconButton title="Resume account" icon="play" busy={busy} onClick={() => onChangeStatus('active')} />}
        {status !== 'rejected' && <RowIconButton title="Reject account" icon="close" busy={busy} tone="danger" onClick={() => onChangeStatus('rejected')} />}
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
