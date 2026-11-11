import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const ROLE_LABELS: Record<string, string> = {
  primaryAdmin: 'Primary Administrator',
  institutionAdmin: 'Institution Administrator',
  principal: 'Principal',
  hod: 'HOD',
  faculty: 'Faculty',
  student: 'Student',
}

export function AppShell({
  title,
  children,
  navLinks,
}: {
  title: string
  children: ReactNode
  navLinks?: { label: string; to: string }[]
}) {
  const { appUser, signOut } = useAuth()

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="font-semibold text-slate-900">USOP</div>
            {navLinks && (
              <nav className="flex items-center gap-4">
                {navLinks.map((link) => (
                  <Link key={link.to} to={link.to} className="text-sm text-slate-600 hover:text-slate-900">
                    {link.label}
                  </Link>
                ))}
              </nav>
            )}
          </div>
          {appUser && (
            <div className="flex items-center gap-4 text-sm">
              <span className="text-slate-500">
                {appUser.name} · {ROLE_LABELS[appUser.role]}
              </span>
              <button
                onClick={() => signOut()}
                className="text-slate-500 hover:text-slate-900"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        <h1 className="text-lg font-semibold text-slate-900 mb-6">{title}</h1>
        {children}
      </main>
    </div>
  )
}
