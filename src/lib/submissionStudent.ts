import type { AppUser, Submission } from '../types'

// Who logged an activity, for reviewer-facing lists. Prefers the live
// profile; falls back to the name/register number copied onto the activity
// (a promoted student's profile is no longer readable by their old year's
// staff). Null while neither is known yet.
export function submissionStudent(
  s: Pick<Submission, 'studentName' | 'studentRollNumber'>,
  profile?: Pick<AppUser, 'name' | 'rollNumber'> | null,
): { name: string; rollNumber: string | null } | null {
  if (profile) return { name: profile.name, rollNumber: profile.rollNumber ?? null }
  if (s.studentName) return { name: s.studentName, rollNumber: s.studentRollNumber ?? null }
  return null
}
