import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase'
import type { Institution } from '../../types'

const institutionsRef = collection(db, 'institutions')

// Primary admin only — lists every institution platform-wide. Permitted
// without query filters because the security rule's isPrimaryAdmin() branch
// doesn't read resource.data, so it isn't subject to the filter-complete
// list-query constraint described in CLAUDE.md.
// Primary Admin and Skill Lab Director (both platform-wide). `onError` lets
// a caller degrade quietly if the read is refused.
export function watchInstitutions(
  onChange: (institutions: Institution[]) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    institutionsRef,
    (snap) => {
      onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Institution))
    },
    onError,
  )
}

export async function createInstitution(input: Omit<Institution, 'id' | 'createdAt'>): Promise<string> {
  const docRef = await addDoc(institutionsRef, { ...input, createdAt: Date.now() })
  return docRef.id
}

export async function updateInstitution(institutionId: string, patch: Partial<Omit<Institution, 'id' | 'createdAt'>>): Promise<void> {
  await updateDoc(institutionDocRef(institutionId), patch)
}

export function institutionDocRef(institutionId: string) {
  return doc(institutionsRef, institutionId)
}

export async function getInstitution(institutionId: string): Promise<Institution | null> {
  const snap = await getDoc(institutionDocRef(institutionId))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as Institution) : null
}

export function watchInstitution(
  institutionId: string,
  onChange: (institution: Institution | null) => void,
): Unsubscribe {
  return onSnapshot(institutionDocRef(institutionId), (snap) => {
    onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as Institution) : null)
  })
}
