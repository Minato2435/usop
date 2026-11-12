import type { Role } from '../types'

// Every account has a registration number (AppUser.rollNumber, kept under
// its original field name so nothing stored needs migrating): a student's
// university registration no., a doctor's medical-council no., an admin's
// staff / employee no. Unique across the platform, checked by the server.

export function regNoHelp(role: Role | string): { placeholder: string; hint: string } {
  switch (role) {
    case 'student':
      return { placeholder: 'e.g. MBBS2026-0142', hint: 'University / college registration number.' }
    case 'faculty':
    case 'hod':
    case 'principal':
      return { placeholder: 'e.g. KMC-123456', hint: 'Medical council registration number (or staff ID).' }
    default:
      return { placeholder: 'e.g. EMP-1024', hint: 'Staff or employee ID number.' }
  }
}

export const sameRegNo = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()
