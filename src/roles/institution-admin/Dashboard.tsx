import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { InstitutionAdminShell } from './shell/InstitutionAdminShell'
import { StatTile, Card, SectionLabel } from '../primary-admin/shell/ui'
import { Icon, type IconName } from '../primary-admin/shell/Icon'
import { watchInstitutionUsers } from '../../lib/firestore/users'
import {
  watchCatalogDepartments,
  watchInstitutionDepartments,
  watchInstitutionDepartmentOverrides,
} from '../../lib/firestore/departments'
import {
  watchGlobalTemplates,
  watchInstitutionTemplates,
  watchInstitutionOverrides,
} from '../../lib/firestore/logTemplates'
import { watchAllVideoTutorials, watchInstitutionVideoOverrides } from '../../lib/firestore/videoTutorials'
import type {
  AppUser,
  Department,
  InstitutionDepartmentOverride,
  InstitutionTemplateOverride,
  InstitutionVideoOverride,
  LogTemplate,
  Role,
  VideoTutorial,
} from '../../types'

const ROLE_LABELS: Record<Role, string> = {
  primaryAdmin: 'Primary Admin',
  institutionAdmin: 'Institution Admin',
  principal: 'Principal',
  hod: 'HOD',
  faculty: 'Faculty',
  student: 'Student',
  skillLabDirector: 'Skill Lab Director',
}
const ROLE_ORDER: Role[] = ['principal', 'hod', 'faculty', 'student']

const QUICK_ACTIONS: { to: string; icon: IconName; label: string }[] = [
  { to: '/institution-admin/departments', icon: 'departments', label: 'Departments' },
  { to: '/institution-admin/competencies', icon: 'competencies', label: 'Competencies' },
  { to: '/institution-admin/log-templates', icon: 'templates', label: 'Log templates' },
  { to: '/institution-admin/video-tutorials', icon: 'video', label: 'Video tutorials' },
  { to: '/institution-admin/users', icon: 'users', label: 'Users' },
]

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function InstitutionAdminDashboard() {
  const { appUser } = useAuth()
  const institutionId = appUser?.institutionId ?? null

  const [users, setUsers] = useState<AppUser[] | null>(null)
  const [catalogDepartments, setCatalogDepartments] = useState<Department[] | null>(null)
  const [ownDepartments, setOwnDepartments] = useState<Department[] | null>(null)
  const [departmentOverrides, setDepartmentOverrides] = useState<InstitutionDepartmentOverride[] | null>(null)
  const [globalTemplates, setGlobalTemplates] = useState<LogTemplate[] | null>(null)
  const [ownTemplates, setOwnTemplates] = useState<LogTemplate[] | null>(null)
  const [templateOverrides, setTemplateOverrides] = useState<InstitutionTemplateOverride[] | null>(null)
  const [allVideos, setAllVideos] = useState<VideoTutorial[] | null>(null)
  const [videoOverrides, setVideoOverrides] = useState<InstitutionVideoOverride[] | null>(null)

  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionUsers(institutionId, setUsers)
  }, [institutionId])
  useEffect(() => watchCatalogDepartments(setCatalogDepartments), [])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionDepartments(institutionId, setOwnDepartments)
  }, [institutionId])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionDepartmentOverrides(institutionId, setDepartmentOverrides)
  }, [institutionId])
  useEffect(() => watchGlobalTemplates({}, setGlobalTemplates), [])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionTemplates(institutionId, {}, setOwnTemplates)
  }, [institutionId])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionOverrides(institutionId, setTemplateOverrides)
  }, [institutionId])
  useEffect(() => watchAllVideoTutorials(setAllVideos), [])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionVideoOverrides(institutionId, setVideoOverrides)
  }, [institutionId])

  const loading =
    !users ||
    !catalogDepartments ||
    !ownDepartments ||
    !departmentOverrides ||
    !globalTemplates ||
    !ownTemplates ||
    !templateOverrides ||
    !allVideos ||
    !videoOverrides

  const catalogVideos = (allVideos ?? []).filter((v) => v.institutionId === '')
  const ownVideos = (allVideos ?? []).filter((v) => v.institutionId === institutionId)

  function isEnabled<T extends { enabled: boolean }>(overrides: T[] | null, idField: keyof T, id: string): boolean {
    const override = overrides?.find((o) => o[idField] === id)
    return override ? override.enabled : true
  }

  const availableDepartments = loading
    ? 0
    : (catalogDepartments ?? []).filter((d) => isEnabled(departmentOverrides, 'departmentId', d.id)).length +
      (ownDepartments?.length ?? 0)

  const activeTemplates = loading
    ? 0
    : (globalTemplates ?? []).filter((t) => isEnabled(templateOverrides, 'templateId', t.id)).length +
      (ownTemplates?.length ?? 0)

  const availableVideos = loading
    ? 0
    : catalogVideos.filter((v) => isEnabled(videoOverrides, 'videoId', v.id)).length + ownVideos.length

  const roleCounts = ROLE_ORDER.map((role) => ({
    role,
    count: users?.filter((u) => u.role === role).length ?? 0,
  }))
  const maxRoleCount = Math.max(1, ...roleCounts.map((r) => r.count))

  const firstName = appUser?.name?.trim().split(' ')[0] ?? ''

  return (
    <InstitutionAdminShell eyebrow="Institution overview" title="Dashboard">
      <div className="mb-8 fade-up">
        <h2 className="font-display text-[28px] leading-tight" style={{ color: 'var(--color-char)' }}>
          {greeting(new Date().getHours())}
          {firstName ? `, ${firstName}` : ''}.
        </h2>
        <p className="mt-1.5 text-[13.5px] max-w-xl" style={{ color: 'var(--color-char-soft)' }}>
          Everything here is scoped to your own institution — global catalog content is included
          unless you've excluded it below.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        <StatTile
          icon="users"
          label="Users in your institution"
          value={users?.length ?? 0}
          sublabel={loading ? undefined : `${roleCounts.find((r) => r.role === 'student')?.count ?? 0} students`}
          loading={loading}
        />
        <StatTile icon="departments" label="Departments available" value={availableDepartments} loading={loading} />
        <StatTile
          icon="templates"
          label="Active log templates"
          value={activeTemplates}
          sublabel={loading ? undefined : `${ownTemplates?.length ?? 0} institution-owned`}
          loading={loading}
        />
        <StatTile icon="video" label="Video tutorials available" value={availableVideos} loading={loading} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-10">
        {QUICK_ACTIONS.map((action, i) => (
          <Link
            key={action.to}
            to={action.to}
            className="fade-up group flex flex-col items-center gap-2 rounded-[10px] border p-4 text-center transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-14px_rgba(11,18,32,0.35)] border-[var(--color-line)] hover:border-[var(--color-gold-line)]"
            style={{
              backgroundColor: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)',
              animationDelay: `${i * 35}ms`,
            }}
          >
            <div
              className="h-9 w-9 rounded-full flex items-center justify-center"
              style={{ backgroundColor: 'var(--color-gold-soft)', color: 'var(--color-gold)' }}
            >
              <Icon name={action.icon} className="h-4 w-4" />
            </div>
            <span className="text-[11.5px] font-medium leading-tight" style={{ color: 'var(--color-char)' }}>
              {action.label}
            </span>
          </Link>
        ))}
      </div>

      <Card elevated className="max-w-2xl">
        <SectionLabel>Workforce by role</SectionLabel>
        <ul className="space-y-3 mt-3">
          {roleCounts.map(({ role, count }) => (
            <li key={role}>
              <div className="flex items-center justify-between mb-1 text-[12px]">
                <span style={{ color: 'var(--color-char)' }}>{ROLE_LABELS[role]}</span>
                <span className="font-mono" style={{ color: 'var(--color-char-soft)' }}>
                  {count}
                </span>
              </div>
              <div className="h-[6px] rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-line)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${(count / maxRoleCount) * 100}%`, backgroundColor: 'var(--color-teal)' }}
                />
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </InstitutionAdminShell>
  )
}
