import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '../../../auth/AuthContext'
import { Icon, type IconName } from '../../primary-admin/shell/Icon'
import { ThemeToggle } from '../../primary-admin/shell/ThemeToggle'

// Deliberately reuses the Primary Admin panel's Icon set, ui.tsx kit, and
// ThemeToggle rather than duplicating them — they're genuinely role-agnostic
// (no primary-admin-specific behavior baked in), and duplicating a few
// hundred lines of SVG icons and shared primitives just to avoid an
// import across role folders isn't worth it. A future cleanup could move
// these to a true src/shell/, but that means touching every existing
// primary-admin import too — not worth the risk in the same pass as
// building this panel.
//
// Structurally byte-for-byte the same shell as PrimaryAdminShell (same
// brand mark, same fixed "Institution Administrator" kicker instead of a
// dynamic institution name, same nav/footer layout) — a first pass showed
// the institution's name there instead, and swapping in variable-length
// dynamic text in that exact slot was what made it look inconsistent next
// to Primary Admin's fixed label. The institution itself is identified in
// each page's own content instead, not in the shell chrome.

interface NavItem {
  label: string
  to: string
  icon: IconName
}

const NAV: NavItem[] = [
  { label: 'Dashboard', to: '/institution-admin', icon: 'overview' },
  { label: 'Departments', to: '/institution-admin/departments', icon: 'departments' },
  { label: 'Competencies', to: '/institution-admin/competencies', icon: 'competencies' },
  { label: 'Log templates', to: '/institution-admin/log-templates', icon: 'templates' },
  { label: 'Video tutorials', to: '/institution-admin/video-tutorials', icon: 'video' },
  { label: 'Users', to: '/institution-admin/users', icon: 'users' },
  { label: 'Promote students', to: '/institution-admin/promote-students', icon: 'promote' },
]

const STORAGE_KEY = 'usop.instAdmin.sidebarCollapsed'

export function InstitutionAdminShell({
  eyebrow,
  title,
  actions,
  children,
}: {
  eyebrow?: string
  title: string
  actions?: ReactNode
  children: ReactNode
}) {
  const { appUser, signOut } = useAuth()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(STORAGE_KEY) === '1')
  const [now, setNow] = useState(() => new Date())
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0')
  }, [collapsed])

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    setMobileOpen(false)
  }, [location.pathname])

  const initial = appUser?.name?.trim()?.[0]?.toUpperCase() ?? '·'
  const showLabels = mobileOpen || !collapsed

  return (
    <div className="h-screen flex overflow-hidden" style={{ backgroundColor: 'var(--color-paper)' }}>
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 60%, transparent)' }}
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex flex-col border-r overflow-hidden
          transition-transform duration-300 ease-out
          md:static md:z-auto md:transition-[width] md:duration-300 md:ease-out md:translate-x-0
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}
        style={{
          width: mobileOpen ? '272px' : collapsed ? '76px' : '272px',
          backgroundColor: 'var(--color-ink)',
          borderColor: 'var(--color-ink-line)',
        }}
      >
        <div
          className={`flex px-4 pt-5 pb-4 shrink-0 ${!showLabels ? 'flex-col items-center gap-3' : 'items-center justify-between gap-3'}`}
        >
          <div className={`flex items-center gap-3 min-w-0 ${!showLabels ? 'flex-col' : ''}`}>
            <div
              className="chamfer-sm shrink-0 h-9 w-9 flex items-center justify-center"
              style={{ backgroundColor: 'var(--color-gold)' }}
            >
              <Icon name="crest" className="h-5 w-5" />
              <span className="sr-only">USOP</span>
            </div>
            {showLabels && (
              <div className="min-w-0 fade-up">
                <div className="font-display text-[17px] leading-tight tracking-wide" style={{ color: 'var(--color-frost)' }}>
                  USOP
                </div>
                <div className="text-[10.5px] uppercase tracking-[0.12em]" style={{ color: 'var(--color-gold)' }}>
                  Institution Administrator
                </div>
              </div>
            )}
          </div>
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden md:flex shrink-0 h-7 w-7 items-center justify-center rounded-[3px] hover:bg-white/5 transition-colors"
            style={{ color: 'var(--color-mist)' }}
          >
            <Icon
              name="chevron"
              className={`h-3.5 w-3.5 transition-transform duration-300 ${collapsed ? '' : 'rotate-180'}`}
            />
          </button>
          <button
            onClick={() => setMobileOpen(false)}
            title="Close menu"
            className="md:hidden shrink-0 h-7 w-7 flex items-center justify-center rounded-[3px] hover:bg-white/5 transition-colors"
            style={{ color: 'var(--color-mist)' }}
          >
            <Icon name="close" className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3 border-t" style={{ borderColor: 'var(--color-ink-line)' }}>
          <ul className="flex flex-col gap-0.5">
            {NAV.map((item) => {
              const active = location.pathname === item.to || (item.to !== '/institution-admin' && location.pathname.startsWith(item.to))
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    title={!showLabels ? item.label : undefined}
                    className="group flex items-center gap-3 rounded-[3px] px-2 py-2 text-[13.5px] transition-colors duration-150"
                    style={{
                      backgroundColor: active ? 'var(--color-ink-soft)' : 'transparent',
                      color: active ? 'var(--color-frost)' : 'var(--color-mist)',
                    }}
                  >
                    <Icon name={item.icon} className="h-[18px] w-[18px] shrink-0" />
                    {showLabels && <span className="truncate">{item.label}</span>}
                    {active && (
                      <span className="ml-auto h-1.5 w-1.5 shrink-0" style={{ backgroundColor: 'var(--color-gold)' }} />
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="border-t px-3 py-3 shrink-0" style={{ borderColor: 'var(--color-ink-line)' }}>
          <div className={`flex px-1 ${!showLabels ? 'flex-col items-center gap-2' : 'items-center gap-2.5'}`}>
            <div
              className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center font-display text-[13px]"
              style={{ backgroundColor: 'var(--color-ink-soft)', color: 'var(--color-gold)' }}
            >
              {initial}
            </div>
            {showLabels && (
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] truncate" style={{ color: 'var(--color-frost)' }}>
                  {appUser?.name}
                </div>
                <div className="text-[10.5px] truncate" style={{ color: 'var(--color-mist)' }}>
                  {appUser?.email}
                </div>
              </div>
            )}
            <button
              onClick={() => signOut()}
              title="Sign out"
              className="shrink-0 h-7 w-7 flex items-center justify-center rounded-[3px] hover:bg-white/5 transition-colors"
              style={{ color: 'var(--color-mist)' }}
            >
              <Icon name="signOut" className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        <header
          className="shrink-0 z-10 h-[60px] md:h-[68px] border-b backdrop-blur-sm"
          style={{ backgroundColor: 'color-mix(in srgb, var(--color-paper) 92%, transparent)', borderColor: 'var(--color-line)' }}
        >
          <div className="h-full w-full flex items-center justify-between gap-3 px-4 md:px-8">
            <div className="flex items-center gap-3 min-w-0">
              <button
                onClick={() => setMobileOpen(true)}
                title="Open menu"
                className="md:hidden shrink-0 h-8 w-8 flex items-center justify-center rounded-[3px] hover:bg-black/5 transition-colors"
                style={{ color: 'var(--color-char)' }}
              >
                <Icon name="menu" className="h-5 w-5" />
              </button>
              <div className="min-w-0">
                {eyebrow && (
                  <div
                    className="text-[10px] md:text-[10.5px] font-semibold uppercase tracking-[0.14em]"
                    style={{ color: 'var(--color-gold)' }}
                  >
                    {eyebrow}
                  </div>
                )}
                <h1 className="font-display text-[17px] md:text-[21px] leading-tight truncate" style={{ color: 'var(--color-char)' }}>
                  {title}
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-3 md:gap-5 shrink-0">
              <div
                className="hidden lg:block font-mono text-[11.5px] tabular-nums"
                style={{ color: 'var(--color-char-soft)' }}
              >
                {now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                <span className="mx-1.5 opacity-40">·</span>
                {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              </div>
              <ThemeToggle />
              {actions}
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-6 md:px-8 md:py-10">
          <div className="max-w-[1180px] w-full mx-auto">{children}</div>
        </main>
      </div>
    </div>
  )
}
