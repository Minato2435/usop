import { suggestEmailFix } from '../../../lib/emailTypos'
import { useEffect, useMemo, useState } from 'react'
import { Modal, Field, PrimaryButton, GhostButton, inputClass, Badge } from './ui'
import { Icon } from './Icon'
import { accountErrorMessage, adminCreateUser, adminDeleteUser, adminUpdateUser } from '../../../lib/accounts'
import { watchInstitutionDepartmentOverrides } from '../../../lib/firestore/departments'
import { enabledDepartmentsForYear } from '../../../lib/enabledDepartments'
import { MBBS_YEARS } from '../../../lib/academicStructure'
import { INDIAN_STATES, INDIAN_UNION_TERRITORIES } from '../../../lib/indianStates'
import type { AppUser, Department, Institution, InstitutionDepartmentOverride, MbbsYear, Role } from '../../../types'

const CREATABLE_ROLES: Role[] = ['institutionAdmin', 'skillLabDirector', 'principal', 'hod', 'faculty', 'student']
const ROLE_LABELS: Record<Role, string> = {
  primaryAdmin: 'Primary Admin',
  institutionAdmin: 'Institution Admin',
  principal: 'Principal',
  hod: 'HOD',
  faculty: 'Faculty',
  student: 'Student',
  skillLabDirector: 'Skill Lab Director',
}

// hod/faculty carry a single department (per AppUser's own field comments
// — institutionAdmin/principal oversee the whole institution, no one
// department). A student has no department field at all — bound by year
// only, their departments are every department enabled for their college
// in that year, derived automatically (lib/enabledDepartments.ts).
function needsSingleDepartment(role: Role): boolean {
  return role === 'hod' || role === 'faculty'
}

// Platform-wide roles — no institution at all (AppUser.institutionId is
// null for these, same as the already-existing primaryAdmin account; see
// its own live Firestore doc). skillLabDirector is the first *creatable*
// platform-wide role through this form — primaryAdmin itself was never
// creatable here (provisioned directly in Firebase), so there was no
// existing "hide institution for this role" branch to extend; this is new.
function isPlatformWideRole(role: Role): boolean {
  return role === 'primaryAdmin' || role === 'skillLabDirector'
}

const PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%'
function generatePassword(): string {
  let pwd = ''
  for (let i = 0; i < 12; i++) pwd += PASSWORD_CHARS[Math.floor(Math.random() * PASSWORD_CHARS.length)]
  return pwd
}

const INDIAN_MOBILE_RE = /^[6-9]\d{9}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Doubles as both "New user" and "Edit user". Both save through the server
// functions (lib/accounts.ts), which keep the login account in step with
// the profile: the mobile number is attached to the login (so mobile + OTP
// sign-in works straight away), and editing can change the email, the
// mobile number or set a new password. Edit mode also offers Delete.
export function UserFormModal({
  institutions,
  departments,
  existingUsers,
  editingUser,
  allowedRoles = CREATABLE_ROLES,
  onClose,
  onSaved,
}: {
  institutions: Institution[]
  departments: Department[]
  existingUsers: AppUser[]
  editingUser?: AppUser
  // Institution Admin reuses this same form but shouldn't be able to
  // create peer/superior admin accounts — restricts the Role dropdown.
  allowedRoles?: Role[]
  onClose: () => void
  onSaved: () => void
}) {
  const isEditing = editingUser != null
  // A single-institution list (Institution Admin, always their own) locks
  // the field automatically rather than needing a separate prop — there's
  // nothing else to pick.
  const institutionLocked = institutions.length === 1

  const [name, setName] = useState(editingUser?.name ?? '')
  const [email, setEmail] = useState(editingUser?.email ?? '')
  const [phone, setPhone] = useState(editingUser?.phone ?? '')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [role, setRole] = useState<Role>(editingUser?.role ?? allowedRoles[allowedRoles.length - 1])
  // Narrows the Institution list below before picking one — most useful
  // for Student, where an institution's home state is the fastest way to
  // find it in a platform-wide list. Not locked to any one role: every
  // role picked from this unlocked list (Institution Admin, Principal,
  // HOD, Faculty, Student) benefits the same way. Institution Admin's own
  // single-institution list is already locked, so this never shows there.
  const [stateFilter, setStateFilter] = useState('')
  const [institutionId, setInstitutionId] = useState(
    editingUser?.institutionId ?? (institutionLocked ? institutions[0].id : ''),
  )
  const [departmentId, setDepartmentId] = useState(editingUser?.departmentId ?? '') // faculty/hod
  const [mbbsYear, setMbbsYear] = useState<MbbsYear>(editingUser?.mbbsYear ?? 1)
  const [associatedMbbsYears, setAssociatedMbbsYears] = useState<MbbsYear[]>(editingUser?.associatedMbbsYears ?? [])
  const [rollNumber, setRollNumber] = useState(editingUser?.rollNumber ?? '')
  const [assignedHOD, setAssignedHOD] = useState(editingUser?.assignedHOD ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Every other user, so editing someone doesn't flag their own
  // unchanged email/phone/roll number as "already taken."
  const otherUsers = useMemo(
    () => (editingUser ? existingUsers.filter((u) => u.uid !== editingUser.uid) : existingUsers),
    [existingUsers, editingUser],
  )

  // Department options narrow as the flow progresses: always scoped to the
  // chosen institution, then further scoped to the chosen year(s) — a
  // student's single MBBS year, or any year a faculty member is
  // associated with. HOD has no year field on AppUser at all, so their
  // department list is institution-scoped only.
  // This college's own department on/off toggles (set by Primary Admin on
  // the institution's page or by Institution Admin on Departments) — a
  // department switched off for a college is never offered here, for any
  // role.
  const [overrides, setOverrides] = useState<InstitutionDepartmentOverride[]>([])
  useEffect(() => {
    if (!institutionId) {
      setOverrides([])
      return
    }
    return watchInstitutionDepartmentOverrides(institutionId, setOverrides)
  }, [institutionId])

  const departmentOptions = useMemo(() => {
    const disabled = new Set(overrides.filter((o) => !o.enabled).map((o) => o.departmentId))
    const forInstitution = departments.filter((d) => (d.institutionId === '' || d.institutionId === institutionId) && !disabled.has(d.id))
    if (role === 'faculty') return forInstitution.filter((d) => associatedMbbsYears.includes(d.mbbsYear))
    return forInstitution
  }, [departments, overrides, institutionId, role, associatedMbbsYears])

  // A student's departments are never picked by hand — every department
  // enabled for this college in the chosen year applies automatically.
  const studentDepartments = useMemo(
    () => (institutionId ? enabledDepartmentsForYear(departments, overrides, institutionId, mbbsYear) : []),
    [departments, overrides, institutionId, mbbsYear],
  )

  const institutionOptions = useMemo(
    () => (stateFilter === '' ? institutions : institutions.filter((i) => i.state === stateFilter)),
    [institutions, stateFilter],
  )
  const hodOptions = useMemo(() => {
    const ids = new Set(studentDepartments.map((d) => d.id))
    return otherUsers.filter((u) => u.role === 'hod' && u.institutionId === institutionId && u.departmentId != null && ids.has(u.departmentId))
  }, [otherUsers, institutionId, studentDepartments])

  const normalizedEmail = email.trim().toLowerCase()
  const emailFix = suggestEmailFix(normalizedEmail)
  const emailTaken = normalizedEmail !== '' && otherUsers.some((u) => u.email.trim().toLowerCase() === normalizedEmail)
  const phoneTaken = phone.length === 10 && otherUsers.some((u) => u.phone === phone)
  const rollTaken =
    rollNumber.trim() !== '' && otherUsers.some((u) => u.rollNumber?.trim().toLowerCase() === rollNumber.trim().toLowerCase())

  function toggleYear(y: MbbsYear) {
    setAssociatedMbbsYears((prev) => (prev.includes(y) ? prev.filter((v) => v !== y) : [...prev, y].sort()))
  }

  function handleRoleChange(next: Role) {
    setRole(next)
    setDepartmentId('')
    setAssignedHOD('')
  }

  const isValid =
    name.trim() !== '' &&
    EMAIL_RE.test(normalizedEmail) &&
    !emailTaken &&
    INDIAN_MOBILE_RE.test(phone) &&
    !phoneTaken &&
    (isEditing ? password === '' || password.length >= 6 : password.length >= 6) &&
    (isPlatformWideRole(role) || institutionId !== '') &&
    (role !== 'hod' && role !== 'faculty' ? true : departmentId !== '') &&
    (role !== 'student' || (rollNumber.trim() !== '' && !rollTaken)) &&
    (role !== 'faculty' || associatedMbbsYears.length > 0)

  async function handleSubmit() {
    if (!isValid || saving) return
    setSaving(true)
    setError(null)
    try {
      const profile = {
        role,
        name: name.trim(),
        email: normalizedEmail,
        phone,
        institutionId: isPlatformWideRole(role) ? null : institutionId,
        departmentId: role === 'hod' || role === 'faculty' ? departmentId : null,
        mbbsYear: role === 'student' ? mbbsYear : null,
        associatedMbbsYears: role === 'faculty' ? associatedMbbsYears : null,
        rollNumber: role === 'student' ? rollNumber.trim() : null,
        assignedHOD: role === 'student' && assignedHOD ? assignedHOD : null,
      }
      if (isEditing) {
        await adminUpdateUser({ uid: editingUser.uid, profile, ...(password ? { password } : {}) })
      } else {
        await adminCreateUser({ profile, password })
      }
      onSaved()
    } catch (e) {
      setError(accountErrorMessage(e, `Something went wrong ${isEditing ? 'saving' : 'creating'} this account. Please try again.`))
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!editingUser || deleting) return
    setDeleting(true)
    setError(null)
    try {
      await adminDeleteUser({ uid: editingUser.uid })
      onSaved()
    } catch (e) {
      setError(accountErrorMessage(e, 'Couldn’t delete this account. Please try again.'))
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  return (
    <Modal title={isEditing ? `Edit ${editingUser.name}` : 'New user'} onClose={onClose} wide>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5">
        <div className="sm:col-span-2 mb-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] mb-3" style={{ color: 'var(--color-gold)' }}>
            Identity
          </div>
        </div>

        <Field label="Full name">
          <input
            autoFocus
            className={inputClass}
            style={{ borderColor: 'var(--color-line)' }}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Dr. Anika Sharma"
          />
        </Field>

        <Field label="Email">
          <input
            type="email"
            className={inputClass}
            style={{ borderColor: emailTaken ? 'var(--color-clay)' : 'var(--color-line)' }}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@institution.edu"
          />
          {emailTaken ? (
            <p className="mt-1 text-[11.5px]" style={{ color: 'var(--color-clay)' }}>Already in use by another account.</p>
          ) : emailFix ? (
            <p className="mt-1 text-[11.5px]" style={{ color: 'var(--color-clay)' }}>
              Did you mean <span className="font-medium">{emailFix}</span>?{' '}
              <button type="button" onClick={() => setEmail(emailFix)} className="underline font-medium">
                Use this
              </button>
            </p>
          ) : (
            /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) &&
            normalizedEmail !== (editingUser?.email ?? '').trim().toLowerCase() && (
              <p className="mt-1 text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
                Check it’s right: <span className="font-medium" style={{ color: 'var(--color-char)' }}>{normalizedEmail}</span> — emails added by an admin
                are trusted without a verification link, and password resets go here.
              </p>
            )
          )}
        </Field>

        <Field label="Mobile number">
          <div className="flex items-center gap-2">
            <span
              className="shrink-0 px-3 py-2 text-[13.5px] font-mono border"
              style={{ borderColor: 'var(--color-line)', color: 'var(--color-char-soft)', backgroundColor: 'var(--color-paper)' }}
            >
              +91
            </span>
            <input
              className={inputClass}
              style={{ borderColor: phoneTaken ? 'var(--color-clay)' : 'var(--color-line)' }}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              placeholder="98765 43210"
              inputMode="numeric"
            />
          </div>
          {phone !== '' && !INDIAN_MOBILE_RE.test(phone) && (
            <p className="mt-1 text-[11.5px]" style={{ color: 'var(--color-clay)' }}>
              Enter a valid 10-digit Indian mobile number.
            </p>
          )}
          {phoneTaken ? (
            <p className="mt-1 text-[11.5px]" style={{ color: 'var(--color-clay)' }}>Already in use by another account.</p>
          ) : (
            <p className="mt-1 text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
              They can sign in with this number and an OTP.
            </p>
          )}
        </Field>

        {
          <Field label={isEditing ? 'New password (optional)' : 'Password'}>
            <div className="flex items-center gap-2">
              <input
                type={showPassword ? 'text' : 'password'}
                className={inputClass}
                style={{ borderColor: 'var(--color-line)' }}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isEditing ? 'Leave blank to keep the current one' : 'At least 6 characters'}
              />
              <button
                type="button"
                title={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword((s) => !s)}
                className="shrink-0 h-[38px] w-[38px] flex items-center justify-center border transition-colors"
                style={{ borderColor: 'var(--color-line)', color: 'var(--color-char-soft)' }}
              >
                <Icon name="eye" className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                setPassword(generatePassword())
                setShowPassword(true)
              }}
              className="mt-1.5 text-[11.5px] font-medium"
              style={{ color: 'var(--color-gold)' }}
            >
              Generate a strong password
            </button>
          </Field>
        }

        <div className="sm:col-span-2 mt-2 mb-1">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] mb-3" style={{ color: 'var(--color-gold)' }}>
            Role & scope
          </div>
        </div>

        <Field label="Role">
          <select
            className={inputClass}
            style={{ borderColor: 'var(--color-line)' }}
            value={role}
            onChange={(e) => handleRoleChange(e.target.value as Role)}
          >
            {allowedRoles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>

        {!institutionLocked && !isPlatformWideRole(role) && (
          <Field label="State">
            <select
              className={inputClass}
              style={{ borderColor: 'var(--color-line)' }}
              value={stateFilter}
              onChange={(e) => {
                const next = e.target.value
                setStateFilter(next)
                // Clear the institution pick once it no longer belongs to
                // the narrowed list, so the two fields never disagree.
                if (next !== '' && !institutions.some((i) => i.id === institutionId && i.state === next)) {
                  setInstitutionId('')
                  setDepartmentId('')
                  setAssignedHOD('')
                }
              }}
            >
              <option value="">All states</option>
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
        )}

        {!isPlatformWideRole(role) && (
          <Field label="Institution">
            <select
              className={inputClass}
              style={{ borderColor: 'var(--color-line)', opacity: institutionLocked ? 0.6 : 1 }}
              value={institutionId}
              disabled={institutionLocked}
              onChange={(e) => {
                setInstitutionId(e.target.value)
                setDepartmentId('')
                setAssignedHOD('')
              }}
            >
              {!institutionLocked && (
                <option value="">
                  {institutionOptions.length === 0 ? 'No institutions in this state' : 'Select an institution'}
                </option>
              )}
              {institutionOptions.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        {role === 'student' && (
          <Field label="MBBS year">
            <select
              className={inputClass}
              style={{ borderColor: 'var(--color-line)' }}
              value={mbbsYear}
              onChange={(e) => {
                setMbbsYear(Number(e.target.value) as MbbsYear)
                setDepartmentId('')
                setAssignedHOD('')
              }}
            >
              {MBBS_YEARS.map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
          </Field>
        )}

        {role === 'faculty' && (
          <div className="sm:col-span-2 mb-4">
            <span
              className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]"
              style={{ color: 'var(--color-char-soft)' }}
            >
              Associated MBBS years
            </span>
            <div className="flex flex-wrap gap-2">
              {MBBS_YEARS.map((y) => {
                const active = associatedMbbsYears.includes(y)
                return (
                  <button
                    type="button"
                    key={y}
                    onClick={() => {
                      toggleYear(y)
                      setDepartmentId('')
                    }}
                    className="px-3 py-1.5 text-[12.5px] font-medium border transition-colors"
                    style={{
                      borderColor: active ? 'var(--color-gold)' : 'var(--color-line)',
                      backgroundColor: active ? 'var(--color-gold-soft)' : 'transparent',
                      color: active ? 'var(--color-gold)' : 'var(--color-char-soft)',
                    }}
                  >
                    Year {y}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {needsSingleDepartment(role) && (
          <Field label="Department">
            <select
              className={inputClass}
              style={{ borderColor: 'var(--color-line)' }}
              value={departmentId}
              onChange={(e) => {
                setDepartmentId(e.target.value)
                setAssignedHOD('')
              }}
              disabled={institutionId === '' || (role === 'faculty' && associatedMbbsYears.length === 0)}
            >
              <option value="">
                {institutionId === ''
                  ? 'Select an institution first'
                  : role === 'faculty' && associatedMbbsYears.length === 0
                    ? 'Select at least one year first'
                    : 'Select a department'}
              </option>
              {departmentOptions.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — Year {d.mbbsYear}
                </option>
              ))}
            </select>
          </Field>
        )}

        {role === 'student' && (
          <div className="sm:col-span-2 mb-4">
            <span
              className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]"
              style={{ color: 'var(--color-char-soft)' }}
            >
              Departments — assigned automatically
            </span>
            {institutionId === '' ? (
              <p className="text-[12.5px]" style={{ color: 'var(--color-char-soft)' }}>
                Select an institution first.
              </p>
            ) : studentDepartments.length === 0 ? (
              <p className="text-[12.5px]" style={{ color: 'var(--color-clay)' }}>
                No departments are enabled for Year {mbbsYear} at this institution yet — this student won't be able to log activities until one is.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {studentDepartments.map((d) => (
                    <Badge key={d.id} tone="gold">
                      {d.name}
                    </Badge>
                  ))}
                </div>
                <p className="mt-2 text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
                  Every department enabled for this college in Year {mbbsYear}. Switching a department on or off for the college updates
                  this automatically — nothing to pick here.
                </p>
              </>
            )}
          </div>
        )}

        {role === 'student' && (
          <Field label="Registration number">
            <input
              className={inputClass}
              style={{ borderColor: rollTaken ? 'var(--color-clay)' : 'var(--color-line)' }}
              value={rollNumber}
              onChange={(e) => setRollNumber(e.target.value)}
              placeholder="e.g. MBBS2026-0142"
            />
            {rollTaken && <p className="mt-1 text-[11.5px]" style={{ color: 'var(--color-clay)' }}>Already assigned to another student.</p>}
          </Field>
        )}

        {role === 'student' && (
          <Field label="Assigned HOD (optional)">
            <select
              className={inputClass}
              style={{ borderColor: 'var(--color-line)' }}
              value={assignedHOD}
              onChange={(e) => setAssignedHOD(e.target.value)}
              disabled={institutionId === ''}
            >
              <option value="">None yet</option>
              {hodOptions.map((h) => (
                <option key={h.uid} value={h.uid}>
                  {h.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>

      {error && (
        <div className="mb-4">
          <Badge tone="clay">{error}</Badge>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-end gap-2 mt-2">
        {isEditing && (
          <div className="mr-auto flex items-center gap-2">
            {confirmDelete ? (
              <>
                <span className="text-[12px]" style={{ color: 'var(--color-clay)' }}>
                  Delete {editingUser.name}’s login and profile? Their activities stay.
                </span>
                <GhostButton tone="danger" onClick={handleDelete} disabled={deleting}>
                  {deleting ? 'Deleting…' : 'Yes, delete'}
                </GhostButton>
                <GhostButton onClick={() => setConfirmDelete(false)} disabled={deleting}>
                  Keep
                </GhostButton>
              </>
            ) : (
              <button type="button" onClick={() => setConfirmDelete(true)} className="text-[12.5px] font-medium" style={{ color: 'var(--color-clay)' }}>
                Delete user
              </button>
            )}
          </div>
        )}
        <GhostButton onClick={onClose}>Cancel</GhostButton>
        <PrimaryButton onClick={handleSubmit} disabled={!isValid || saving}>
          {saving ? 'Saving…' : isEditing ? 'Save changes' : 'Create user'}
        </PrimaryButton>
      </div>
    </Modal>
  )
}
