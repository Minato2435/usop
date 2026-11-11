import { doc, onSnapshot, setDoc, type Unsubscribe } from 'firebase/firestore'
import { db } from '../firebase'
import type { PlatformConfig, PlatformTheme } from '../../types'

// A fixed singleton doc, not a collection — there is only ever one
// platform-wide config, so it lives at a known id rather than being
// queried.
const configRef = doc(db, 'platformConfig', 'settings')

export function watchPlatformConfig(onChange: (config: PlatformConfig | null) => void): Unsubscribe {
  return onSnapshot(configRef, (snap) => {
    onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as PlatformConfig) : null)
  })
}

export async function setPlatformTheme(theme: PlatformTheme, updatedBy: string): Promise<void> {
  await setDoc(configRef, { theme, updatedAt: Date.now(), updatedBy }, { merge: true })
}
