import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

const DARK_MODE_KEY = 'usop.darkModePreferred'

// A per-browser, per-user preference — never written to Firestore. This is
// the fix for the sun/moon toggle silently doing nothing for anyone but a
// primary admin: it used to write the *global* platformConfig theme
// (write-restricted to primaryAdmin), so every other role's click just
// failed with a permission error. "Dark mode" is now purely local: it
// always means Midnight, and switching it off falls back to whatever
// theme the primary admin has actually configured platform-wide (see
// ThemeSync, which combines this with platformConfig) — so every role can
// toggle their own light/dark preference without touching shared state.
function readStoredPreference(): boolean {
  try {
    return localStorage.getItem(DARK_MODE_KEY) === '1'
  } catch {
    return false
  }
}

interface DarkModeState {
  dark: boolean
  toggle: () => void
}

const DarkModeContext = createContext<DarkModeState | undefined>(undefined)

export function DarkModeProvider({ children }: { children: ReactNode }) {
  const [dark, setDark] = useState(readStoredPreference)

  useEffect(() => {
    try {
      localStorage.setItem(DARK_MODE_KEY, dark ? '1' : '0')
    } catch {
      // Private browsing / storage disabled — preference just won't persist
      // across reloads, still works for the current session.
    }
  }, [dark])

  return <DarkModeContext.Provider value={{ dark, toggle: () => setDark((d) => !d) }}>{children}</DarkModeContext.Provider>
}

export function useDarkMode(): DarkModeState {
  const ctx = useContext(DarkModeContext)
  if (!ctx) throw new Error('useDarkMode must be used within DarkModeProvider')
  return ctx
}
