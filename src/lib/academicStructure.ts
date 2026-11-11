import type { MbbsYear } from '../types'

// Base MBBS year -> department mapping (Section 4 of the architecture spec).
// Used as the reference list when a Primary Admin authors a *global*
// template, since global templates aren't tied to any one institution's
// custom department list.
export const BASE_DEPARTMENTS_BY_YEAR: Record<MbbsYear, string[]> = {
  1: ['Anatomy', 'Physiology', 'Biochemistry'],
  2: ['Pathology', 'Pharmacology', 'Microbiology'],
  3: ['Community Medicine', 'ENT', 'Ophthalmology'],
  4: ['General Medicine', 'Surgery', 'Pediatrics', 'OBG'],
}

export const MBBS_YEARS: MbbsYear[] = [1, 2, 3, 4]
