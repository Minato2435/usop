import { addDoc, collection, deleteDoc, doc, getDoc, onSnapshot, updateDoc, type Unsubscribe } from 'firebase/firestore'
import { db } from '../firebase'
import type { FormSchema } from '../../types'

const schemasRef = collection(db, 'formSchemas')

export async function createFormSchema(
  input: Omit<FormSchema, 'id' | 'createdAt'>,
): Promise<string> {
  const docRef = await addDoc(schemasRef, { ...input, createdAt: Date.now() })
  return docRef.id
}

export async function updateFormSchema(
  schemaId: string,
  patch: Partial<Omit<FormSchema, 'id'>>,
): Promise<void> {
  await updateDoc(doc(schemasRef, schemaId), patch)
}

export async function deleteFormSchema(schemaId: string): Promise<void> {
  await deleteDoc(doc(schemasRef, schemaId))
}

export async function getFormSchema(schemaId: string): Promise<FormSchema | null> {
  const snap = await getDoc(doc(schemasRef, schemaId))
  return snap.exists() ? ({ id: snap.id, ...snap.data() } as FormSchema) : null
}

export function watchFormSchema(
  schemaId: string,
  onChange: (schema: FormSchema | null) => void,
): Unsubscribe {
  return onSnapshot(doc(schemasRef, schemaId), (snap) => {
    onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as FormSchema) : null)
  })
}
