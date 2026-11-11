import { collection, doc, getDoc, onSnapshot, query, setDoc, updateDoc, where, type Unsubscribe } from 'firebase/firestore'
import { deleteApp, initializeApp } from 'firebase/app'
import { createUserWithEmailAndPassword, getAuth, signOut } from 'firebase/auth'
import { db, firebaseConfig } from '../firebase'
import { watchDepartment } from './departments'
import type { AppUser } from '../../types'

const usersRef = collection(db, 'users')

// Primary admin only — lists every user platform-wide (same no-filter
// list-query reasoning as watchInstitutions in institutions.ts).
export function watchUsers(onChange: (users: AppUser[]) => void): Unsubscribe {
  return onSnapshot(usersRef, (snap) => {
    onChange(snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as AppUser))
  })
}

// Institution admin — the users read rule depends on resource.data.institutionId,
// so (unlike watchUsers above) this needs an explicit filter to satisfy
// Firestore's filter-completeness check for list queries.
export function watchInstitutionUsers(institutionId: string, onChange: (users: AppUser[]) => void): Unsubscribe {
  const q = query(usersRef, where('institutionId', '==', institutionId))
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as AppUser))
  })
}

// A student choosing who to submit an activity to — every active faculty
// member in their own department + institution. institutionId+departmentId
// are exactly the fields the users/{uid} read rule's same-department branch
// checks, so this satisfies Firestore's filter-completeness requirement;
// role/active are extra convenience filters on top.
export function watchFacultyForDepartment(
  institutionId: string,
  departmentId: string,
  onChange: (faculty: AppUser[]) => void,
): Unsubscribe {
  const q = query(
    usersRef,
    where('institutionId', '==', institutionId),
    where('departmentId', '==', departmentId),
    where('role', '==', 'faculty'),
    where('active', '==', true),
  )
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as AppUser))
  })
}

// A department's roster — its faculty and HOD (who carry that departmentId)
// plus its students — for HOD's Dashboard/Students/Faculty/Activities pages
// and Faculty's Forms student picker. Students have no department field:
// they're bound by year only, and every department enabled for their
// college in their year applies to them, so a department's students are
// simply the college's students in that department's own MBBS year. The
// department doc itself is watched to learn that year, then the two user
// queries are merged — every call site still gets one AppUser[], same as
// before.
export function watchDepartmentUsers(
  institutionId: string,
  departmentId: string,
  onChange: (users: AppUser[]) => void,
): Unsubscribe {
  let staff: AppUser[] = []
  let students: AppUser[] = []
  let staffLoaded = false
  let studentsLoaded = false
  let unsubStudents: Unsubscribe = () => {}
  let currentYear: number | null = null

  function emit() {
    if (!staffLoaded || !studentsLoaded) return
    onChange([...staff, ...students])
  }

  const unsubStaff = onSnapshot(
    query(usersRef, where('institutionId', '==', institutionId), where('departmentId', '==', departmentId)),
    (snap) => {
      staff = snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as AppUser)
      staffLoaded = true
      emit()
    },
  )

  const unsubDept = watchDepartment(departmentId, (department) => {
    const year = department?.mbbsYear ?? null
    if (year === currentYear && studentsLoaded) return
    currentYear = year
    unsubStudents()
    if (year === null) {
      students = []
      studentsLoaded = true
      emit()
      return
    }
    unsubStudents = onSnapshot(
      query(usersRef, where('institutionId', '==', institutionId), where('role', '==', 'student'), where('mbbsYear', '==', year)),
      (snap) => {
        students = snap.docs.map((d) => ({ uid: d.id, ...d.data() }) as AppUser)
        studentsLoaded = true
        emit()
      },
    )
  })

  return () => {
    unsubStaff()
    unsubDept()
    unsubStudents()
  }
}

export type UserStatus = 'active' | 'paused' | 'rejected'

// The one place `active`/`rejected` get written together, so the two
// fields can never drift into a nonsensical combination (e.g. rejected but
// still active). Paused and Rejected are both active:false — Resume always
// clears rejected too, since "resume" is the one way back to Active
// regardless of which inactive state a user was in.
export async function setUserStatus(uid: string, status: UserStatus): Promise<void> {
  await updateDoc(userDocRef(uid), {
    active: status === 'active',
    rejected: status === 'rejected',
  })
}

export function userDocRef(uid: string) {
  return doc(usersRef, uid)
}

export async function getAppUser(uid: string): Promise<AppUser | null> {
  const snap = await getDoc(userDocRef(uid))
  return snap.exists() ? ({ uid: snap.id, ...snap.data() } as AppUser) : null
}

// Provisioning a user for someone else means creating THEIR Firebase Auth
// account — but createUserWithEmailAndPassword signs in as whoever it just
// created, which would kick the admin out of their own session if run on
// the app's shared `auth` instance. A second, separately-named Firebase App
// (its own isolated Auth instance, same project config) sidesteps that:
// create the account there, capture the uid, sign that instance back out,
// then tear the temporary app down — the admin's real session never moves.
// No Cloud Function needed for this specific step.
export async function createUserAccount(
  input: Omit<AppUser, 'uid' | 'active' | 'rejected'>,
  password: string,
): Promise<string> {
  const secondaryApp = initializeApp(firebaseConfig, `user-provisioning-${Date.now()}`)
  try {
    const secondaryAuth = getAuth(secondaryApp)
    const credential = await createUserWithEmailAndPassword(secondaryAuth, input.email, password)
    const uid = credential.user.uid
    await signOut(secondaryAuth)

    const profile: Omit<AppUser, 'uid'> = { ...input, active: true, rejected: false }
    await setDoc(userDocRef(uid), profile)
    return uid
  } finally {
    await deleteApp(secondaryApp)
  }
}

// Edits the Firestore profile only — email and password aren't editable
// here. Changing a Firebase Auth account's email/password from an admin
// session (for a DIFFERENT user) needs either that user's own re-auth or
// the Admin SDK/a Cloud Function, neither of which this app has; faking
// either client-side would silently desync Auth from the profile doc.
export async function updateUserProfile(
  uid: string,
  updates: Partial<Omit<AppUser, 'uid' | 'email' | 'active' | 'rejected'>>,
): Promise<void> {
  await updateDoc(userDocRef(uid), updates)
}

export function watchAppUser(
  uid: string,
  onChange: (user: AppUser | null) => void,
  onError?: (error: unknown) => void,
): Unsubscribe {
  return onSnapshot(
    userDocRef(uid),
    (snap) => {
      onChange(snap.exists() ? ({ uid: snap.id, ...snap.data() } as AppUser) : null)
    },
    (error) => {
      onChange(null)
      onError?.(error)
    },
  )
}
