import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import type { Role } from '../types'

export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { firebaseUser, appUser, loading, profileError, signOut } = useAuth()

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">Loading…</div>
  }

  if (!firebaseUser) {
    return <Navigate to="/login" replace />
  }

  if (!appUser) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 text-center px-4">
        <p className="text-sm text-red-600 max-w-md">{profileError ?? 'Signed in, but no profile was found for this account.'}</p>
        <button onClick={() => signOut()} className="text-sm text-slate-500 underline">
          Sign out
        </button>
      </div>
    )
  }

  if (!appUser.active) {
    return <div className="min-h-screen flex items-center justify-center text-slate-500 text-sm">Your account has been deactivated. Contact your administrator.</div>
  }

  if (!roles.includes(appUser.role)) {
    return <Navigate to={roleHomePath(appUser.role)} replace />
  }

  return <>{children}</>
}

export function roleHomePath(role: Role): string {
  switch (role) {
    case 'primaryAdmin':
      return '/admin'
    case 'institutionAdmin':
      return '/institution-admin'
    case 'principal':
      return '/principal'
    case 'hod':
      return '/hod'
    case 'faculty':
      return '/faculty'
    case 'student':
      return '/student'
    case 'skillLabDirector':
      return '/skill-lab-director'
  }
}
