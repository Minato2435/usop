import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useDarkMode } from './DarkModeContext'
import { watchPlatformConfig } from '../lib/firestore/platformConfig'
import type { PlatformTheme } from '../types'

// Applies the effective color theme to <html> as soon as it's known, and
// keeps it in sync live. Two independent inputs combine here:
//  - the platform-wide theme the primary admin configured (Platform
//    Configuration → PlatformConfigPage.tsx), read from Firestore, shared
//    by everyone — this is "light mode."
//  - each user's own local dark-mode preference (DarkModeContext,
//    per-browser, never written to Firestore) — when on, this always wins
//    and forces Midnight, regardless of the configured platform theme;
//    when off, the platform theme applies as normal.
// Renders nothing. Only subscribes to platformConfig once signed in and
// active (its read rule requires isActive()); before that, the login page
// just shows the default 'inkGold' palette (no data-theme attribute at
// all) regardless of the local dark-mode preference.
export function ThemeSync() {
  const { appUser } = useAuth()
  const { dark } = useDarkMode()
  const [configTheme, setConfigTheme] = useState<PlatformTheme>('inkGold')

  useEffect(() => {
    if (!appUser) return
    return watchPlatformConfig((config) => setConfigTheme(config?.theme ?? 'inkGold'))
  }, [appUser])

  useEffect(() => {
    if (!appUser) {
      document.documentElement.removeAttribute('data-theme')
      return
    }
    const effective = dark ? 'midnight' : configTheme
    if (effective !== 'inkGold') {
      document.documentElement.setAttribute('data-theme', effective)
    } else {
      document.documentElement.removeAttribute('data-theme')
    }
  }, [appUser, dark, configTheme])

  return null
}
