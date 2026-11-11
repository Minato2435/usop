import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { onAuthStateChanged, signOut as firebaseSignOut, type User as FirebaseUser } from 'firebase/auth'
import { auth } from '../lib/firebase'
import { watchAppUser } from '../lib/firestore/users'
import type { AppUser } from '../types'

interface AuthState {
  firebaseUser: FirebaseUser | null
  appUser: AppUser | null
  loading: boolean
  profileError: string | null
  // Signed in, but no users/{uid} profile — a self-registration that isn't
  // approved yet (or was never sent). RequireRole sends them to /register.
  profileMissing: boolean
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null)
  const [appUser, setAppUser] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileMissing, setProfileMissing] = useState(false)

  useEffect(() => {
    return onAuthStateChanged(auth, (user) => {
      setFirebaseUser(user)
      setProfileError(null)
      setProfileMissing(false)
      if (!user) {
        setAppUser(null)
        setLoading(false)
      }
    })
  }, [])

  useEffect(() => {
    if (!firebaseUser) return
    setLoading(true)
    return watchAppUser(
      firebaseUser.uid,
      (user) => {
        setAppUser(user)
        setProfileMissing(!user)
        setLoading(false)
        if (!user) {
          setProfileError(
            `Signed in, but no user profile exists for this account (uid: ${firebaseUser.uid}). Ask an administrator to create your profile.`,
          )
        }
      },
      (err) => {
        setLoading(false)
        setProfileError(
          `Signed in, but couldn't load your user profile (${err instanceof Error ? err.message : String(err)}).`,
        )
      },
    )
  }, [firebaseUser])

  const value: AuthState = {
    firebaseUser,
    appUser,
    loading,
    profileError,
    profileMissing,
    signOut: () => firebaseSignOut(auth),
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
