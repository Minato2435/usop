import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { PrimaryAdminShell } from './shell/PrimaryAdminShell'
import { Card, SectionLabel, GhostButton, Skeleton } from './shell/ui'
import { Icon, type IconName } from './shell/Icon'
import { useCountUp } from './shell/useCountUp'
import { watchInstitutions } from '../../lib/firestore/institutions'
import { watchUsers } from '../../lib/firestore/users'
import { watchAllDepartments } from '../../lib/firestore/departments'
import { watchGlobalTemplates } from '../../lib/firestore/logTemplates'
import { watchAllVideoTutorials } from '../../lib/firestore/videoTutorials'
import type { AppUser, Department, Institution, LogTemplate, Role, VideoTutorial } from '../../types'

const ROLE_LABELS: Record<Role, string> = {
  primaryAdmin: 'Primary Admin',
  institutionAdmin: 'Institution Admin',
  principal: 'Principal',
  hod: 'HOD',
  faculty: 'Faculty',
  student: 'Student',
  skillLabDirector: 'Skill Lab Director',
}
// skillLabDirector is deliberately left out of ROLE_ORDER (this dashboard's
// "workforce by role" breakdown) — same reasoning primaryAdmin itself is
// already excluded for: a platform-level administrative role, not part of
// the per-institution workforce this chart is summarizing.
const ROLE_ORDER: Role[] = ['institutionAdmin', 'principal', 'hod', 'faculty', 'student']

// Deliberately not a rainbow of arbitrary hues — a graduated scale between
// the panel's own two signal colors (gold → teal), senior roles closer to
// gold and the largest, most junior cohort (students) settling into a
// muted neutral. Stays inside the established "one accent + one secondary
// signal" palette instead of inventing five new ones just for this chart.
const ROLE_COLOR: Record<Role, string> = {
  primaryAdmin: 'var(--color-gold)',
  institutionAdmin: 'var(--color-gold)',
  principal: 'color-mix(in srgb, var(--color-gold) 65%, var(--color-teal) 35%)',
  hod: 'color-mix(in srgb, var(--color-teal) 65%, var(--color-gold) 35%)',
  faculty: 'var(--color-teal)',
  student: 'color-mix(in srgb, var(--color-teal) 55%, var(--color-char-soft) 45%)',
  skillLabDirector: 'var(--color-gold)',
}
const ROLE_ICONS: Record<Role, IconName> = {
  primaryAdmin: 'crest',
  institutionAdmin: 'institutions',
  principal: 'eye',
  hod: 'departments',
  faculty: 'edit',
  student: 'cap',
  skillLabDirector: 'certificate',
}

const QUICK_ACTIONS: { to: string; icon: IconName; label: string }[] = [
  { to: '/admin/institutions', icon: 'institutions', label: 'Institutions' },
  { to: '/admin/users', icon: 'users', label: 'Users' },
  { to: '/admin/departments', icon: 'departments', label: 'Departments' },
  { to: '/admin/log-templates', icon: 'templates', label: 'Log templates' },
  { to: '/admin/video-tutorials', icon: 'video', label: 'Video tutorials' },
  { to: '/admin/settings', icon: 'settings', label: 'Platform config' },
]

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

function timeAgo(ts: number): string {
  const min = Math.floor((Date.now() - ts) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  const mo = Math.floor(day / 30)
  if (mo < 12) return `${mo}mo ago`
  return `${Math.floor(mo / 12)}y ago`
}

interface ActivityItem {
  id: string
  icon: IconName
  text: string
  sub: string
  createdAt: number
}

export function PrimaryAdminDashboard() {
  const { appUser } = useAuth()
  const [institutions, setInstitutions] = useState<Institution[] | null>(null)
  const [users, setUsers] = useState<AppUser[] | null>(null)
  const [departments, setDepartments] = useState<Department[] | null>(null)
  const [templates, setTemplates] = useState<LogTemplate[] | null>(null)
  const [videos, setVideos] = useState<VideoTutorial[] | null>(null)

  useEffect(() => watchInstitutions(setInstitutions), [])
  useEffect(() => watchUsers(setUsers), [])
  useEffect(() => watchAllDepartments(setDepartments), [])
  useEffect(() => watchGlobalTemplates({}, setTemplates), [])
  useEffect(() => watchAllVideoTutorials(setVideos), [])

  const loading = !institutions || !users || !departments || !templates || !videos
  const sslCount = templates?.filter((t) => t.logType === 'SSL').length ?? 0
  const sdlCount = templates?.filter((t) => t.logType === 'SDL').length ?? 0
  // Shared-catalog only, same institutionId === '' convention the Video
  // Tutorials page itself filters on.
  const catalogVideos = (videos ?? []).filter((v) => v.institutionId === '')

  const roleCounts = ROLE_ORDER.map((role) => ({
    role,
    count: users?.filter((u) => u.role === role).length ?? 0,
  }))
  const maxRoleCount = Math.max(1, ...roleCounts.map((r) => r.count))
  const workforceTotal = roleCounts.reduce((sum, r) => sum + r.count, 0)

  const activity: ActivityItem[] = loading
    ? []
    : [
        ...institutions!.map((inst) => ({
          id: `inst-${inst.id}`,
          icon: 'institutions' as IconName,
          text: `New institution — ${inst.name}`,
          sub: [inst.city, inst.state].filter(Boolean).join(', ') || inst.type,
          createdAt: inst.createdAt,
        })),
        ...templates!.map((t) => ({
          id: `tpl-${t.id}`,
          icon: 'templates' as IconName,
          text: `New global log template — ${t.title}`,
          sub: `${t.logType} · ${t.department} · Year ${t.mbbsYear}`,
          createdAt: t.createdAt,
        })),
        ...catalogVideos.map((v) => ({
          id: `vid-${v.id}`,
          icon: 'video' as IconName,
          text: `New video tutorial — ${v.title}`,
          sub: v.audience === 'student' ? 'For students' : 'For faculty',
          createdAt: v.createdAt,
        })),
      ]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 6)

  const firstName = appUser?.name?.trim().split(' ')[0] ?? ''
  const today = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })

  return (
    <PrimaryAdminShell
      eyebrow="Platform overview"
      title="Dashboard"
      actions={
        <Link to="/admin/institutions">
          <GhostButton>
            <Icon name="plus" className="h-3.5 w-3.5" />
            New institution
          </GhostButton>
        </Link>
      }
    >
      <div className="mb-8 fade-up flex items-start gap-4">
        <div
          className="chamfer-sm hidden sm:flex h-14 w-14 shrink-0 items-center justify-center"
          style={{ backgroundColor: 'var(--color-gold-soft)', color: 'var(--color-gold)' }}
        >
          <Icon name="crest" className="h-7 w-7" />
        </div>
        <div className="min-w-0">
          <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] mb-1" style={{ color: 'var(--color-gold)' }}>
            {today}
          </div>
          <h2 className="font-display text-[28px] leading-tight" style={{ color: 'var(--color-char)' }}>
            {greeting(new Date().getHours())}
            {firstName ? `, ${firstName}` : ''}.
          </h2>
          <p className="mt-1.5 text-[13.5px] max-w-xl" style={{ color: 'var(--color-char-soft)' }}>
            You have unrestricted access across every institution on USOP — nothing in the system is scoped away from this account.
          </p>
        </div>
      </div>

      {/* Individual elevated cards — the same rounded, tinted-ground,
          hover-lift recipe as the Departments/Users page cards, each with
          its own gold border, rather than cells in one flat divided
          strip. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-10">
        <StatCard
          icon="institutions"
          label="Institutions"
          value={institutions?.length ?? 0}
          loading={loading}
          tone="gold"
          index={0}
        />
        <StatCard
          icon="users"
          label="Users, platform-wide"
          value={users?.length ?? 0}
          sublabel={loading ? undefined : `${roleCounts.find((r) => r.role === 'student')?.count ?? 0} students`}
          loading={loading}
          index={1}
        />
        <StatCard
          icon="templates"
          label="Global log templates"
          value={templates?.length ?? 0}
          sublabel={loading ? undefined : `${sslCount} SSL · ${sdlCount} SDL`}
          loading={loading}
          index={2}
        />
        <StatCard
          icon="departments"
          label="Departments configured"
          value={departments?.length ?? 0}
          loading={loading}
          index={3}
        />
      </div>

      {/* Quick actions — one-click shortcuts to every built admin page,
          in the same rounded-card + hover-lift language as the stat tiles
          and Departments/Users cards, sized down for a toolbar role. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-10">
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

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 mb-5">
        <Card elevated className="lg:col-span-3">
          <div className="flex items-center justify-between mb-1">
            <SectionLabel>Institutions</SectionLabel>
            <Link to="/admin/institutions" className="text-[12px] font-medium" style={{ color: 'var(--color-gold)' }}>
              View all →
            </Link>
          </div>
          {loading ? (
            <div className="space-y-2 mt-3">
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
              <Skeleton className="h-11" />
            </div>
          ) : institutions!.length === 0 ? (
            <EmptyRow text="No institutions yet. Create the first one to start onboarding an admin." />
          ) : (
            <ul className="divide-y mt-2" style={{ borderColor: 'var(--color-line)' }}>
              {institutions!.slice(0, 6).map((inst) => {
                const userCount = users!.filter((u) => u.institutionId === inst.id).length
                return (
                  <li key={inst.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-medium truncate" style={{ color: 'var(--color-char)' }}>
                        {inst.name}
                      </div>
                      <div className="text-[11.5px] font-mono" style={{ color: 'var(--color-char-soft)' }}>
                        {new Date(inst.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="shrink-0 text-[11.5px] text-right" style={{ color: 'var(--color-char-soft)' }}>
                      {userCount} user{userCount === 1 ? '' : 's'}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <Card elevated className="lg:col-span-2">
          <SectionLabel>Workforce by role</SectionLabel>
          {loading ? (
            <div className="space-y-3 mt-3">
              <Skeleton className="h-24 rounded-full mx-auto w-24" />
              <Skeleton className="h-4" />
              <Skeleton className="h-4" />
            </div>
          ) : (
            <>
              <div className="flex justify-center my-2">
                <RoleDonut roleCounts={roleCounts} total={workforceTotal} />
              </div>
              <ul className="space-y-3 mt-4">
                {roleCounts.map(({ role, count }) => {
                  const color = ROLE_COLOR[role]
                  return (
                    <li key={role}>
                      <div className="flex items-center justify-between mb-1 text-[12px]">
                        <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--color-char)' }}>
                          <span
                            className="h-4 w-4 rounded-full flex items-center justify-center shrink-0"
                            style={{ backgroundColor: `color-mix(in srgb, ${color} 18%, transparent)`, color }}
                          >
                            <Icon name={ROLE_ICONS[role]} className="h-2.5 w-2.5" />
                          </span>
                          {ROLE_LABELS[role]}
                        </span>
                        <span className="font-mono" style={{ color: 'var(--color-char-soft)' }}>
                          {count}
                        </span>
                      </div>
                      <div className="h-[6px] rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-line)' }}>
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${(count / maxRoleCount) * 100}%`,
                            backgroundColor: color,
                          }}
                        />
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </Card>
      </div>

      <Card elevated>
        <SectionLabel>Recent activity</SectionLabel>
        {loading ? (
          <div className="space-y-3 mt-3">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : activity.length === 0 ? (
          <EmptyRow text="Nothing has been added yet. New institutions, templates, and videos will show up here." />
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 mt-2 divide-y sm:divide-y-0" style={{ borderColor: 'var(--color-line)' }}>
            {activity.map((item) => (
              <li key={item.id} className="flex items-center gap-3 py-2.5">
                <div
                  className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: 'var(--color-gold-soft)', color: 'var(--color-gold)' }}
                >
                  <Icon name={item.icon} className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] font-medium truncate" style={{ color: 'var(--color-char)' }}>
                    {item.text}
                  </div>
                  <div className="text-[11px] truncate" style={{ color: 'var(--color-char-soft)' }}>
                    {item.sub}
                  </div>
                </div>
                <div className="shrink-0 text-[10.5px] font-mono" style={{ color: 'var(--color-char-soft)' }}>
                  {timeAgo(item.createdAt)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </PrimaryAdminShell>
  )
}

// A CSS conic-gradient donut (no SVG needed) — the "elevated" focal visual
// for the Workforce card, paired with the colored pill bars below it so the
// same per-role palette reads two ways: proportion at a glance (donut) and
// exact count per role (bars).
function RoleDonut({ roleCounts, total }: { roleCounts: { role: Role; count: number }[]; total: number }) {
  const size = 104
  const thickness = 15
  let acc = 0
  const stops = roleCounts
    .filter((r) => r.count > 0)
    .map(({ role, count }) => {
      const start = (acc / Math.max(total, 1)) * 360
      acc += count
      const end = (acc / Math.max(total, 1)) * 360
      return `${ROLE_COLOR[role]} ${start}deg ${end}deg`
    })
  const gradient = stops.length > 0 ? `conic-gradient(${stops.join(', ')})` : `conic-gradient(var(--color-line) 0deg 360deg)`

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <div className="absolute inset-0 rounded-full" style={{ background: gradient }} />
      <div
        className="absolute rounded-full flex flex-col items-center justify-center"
        style={{ inset: thickness, backgroundColor: 'var(--color-paper-raised)' }}
      >
        <span className="font-display text-[22px] leading-none tabular-nums" style={{ color: 'var(--color-char)' }}>
          {total}
        </span>
        <span className="mt-0.5 text-[9px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
          People
        </span>
      </div>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  sublabel,
  loading,
  tone = 'char',
  index = 0,
}: {
  icon: IconName
  label: string
  value: number
  sublabel?: string
  loading?: boolean
  tone?: 'char' | 'gold'
  index?: number
}) {
  const shown = useCountUp(value)
  return (
    <div
      className="fade-up group relative rounded-[10px] p-6 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_28px_-16px_color-mix(in_srgb,var(--color-stat-highlight)_45%,transparent)]"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)',
        border: '2px solid var(--color-stat-highlight)',
        boxShadow: '0 8px 18px -16px color-mix(in srgb, var(--color-stat-highlight) 45%, transparent)',
        animationDelay: `${index * 45}ms`,
      }}
    >
      <div
        className="h-9 w-9 rounded-full flex items-center justify-center mb-4 transition-transform duration-200 ease-out group-hover:scale-110"
        style={{ backgroundColor: 'var(--color-gold-soft)', color: 'var(--color-gold)' }}
      >
        <Icon name={icon} className="h-[17px] w-[17px]" />
      </div>
      {loading ? (
        <div className="shimmer h-10 w-16 rounded-[4px]" />
      ) : (
        <div
          className="font-display text-[40px] leading-none tabular-nums"
          style={{ color: tone === 'gold' ? 'var(--color-gold)' : 'var(--color-char)' }}
        >
          {shown}
        </div>
      )}
      <div className="mt-2.5 text-[11px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
        {label}
      </div>
      {sublabel && (
        <div className="mt-1 font-mono text-[10.5px]" style={{ color: 'var(--color-gold)' }}>
          {sublabel}
        </div>
      )}
    </div>
  )
}

function EmptyRow({ text }: { text: string }) {
  return (
    <p className="py-6 text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
      {text}
    </p>
  )
}
