import { useEffect, useMemo, useState } from 'react'
import { watchCatalogDepartments, watchInstitutionDepartments, watchInstitutionDepartmentOverrides } from './firestore/departments'
import type { Department, InstitutionDepartmentOverride, MbbsYear } from '../types'

// A student is bound by year only: their departments are never picked by
// hand — they're every department that applies to their college for their
// MBBS year, derived live. "Applies" = a shared-catalog department or one
// of the college's own, minus anything Primary Admin / Institution Admin
// has switched off for that college (institutionDepartmentOverrides — an
// absent override means enabled, same rule DepartmentsPage.tsx and
// InstitutionDetailPage.tsx already use). Derived rather than stored, so
// toggling a department on/off reaches every student of that year
// immediately with nothing to re-save.
export function enabledDepartmentsForYear(
  departments: Department[],
  overrides: InstitutionDepartmentOverride[],
  institutionId: string,
  mbbsYear: MbbsYear,
): Department[] {
  const disabled = new Set(overrides.filter((o) => !o.enabled).map((o) => o.departmentId))
  return departments
    .filter((d) => (d.institutionId === '' || d.institutionId === institutionId) && d.mbbsYear === mbbsYear && !disabled.has(d.id))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// Student-side hook: the student's own departments (enabled for their
// college + year), plus every department of their college regardless of
// toggle — the latter only so an older submission whose department has
// since been switched off can still be shown/resumed by name.
export function useStudentDepartments(institutionId: string | null, mbbsYear: MbbsYear | null) {
  const [catalog, setCatalog] = useState<Department[] | null>(null)
  const [own, setOwn] = useState<Department[] | null>(null)
  const [overrides, setOverrides] = useState<InstitutionDepartmentOverride[] | null>(null)

  useEffect(() => watchCatalogDepartments(setCatalog), [])
  useEffect(() => {
    if (!institutionId) return
    const unsubOwn = watchInstitutionDepartments(institutionId, setOwn)
    const unsubOverrides = watchInstitutionDepartmentOverrides(institutionId, setOverrides)
    return () => {
      unsubOwn()
      unsubOverrides()
    }
  }, [institutionId])

  const allDepartments = useMemo(() => [...(catalog ?? []), ...(own ?? [])], [catalog, own])
  const departments = useMemo(
    () => (institutionId && mbbsYear ? enabledDepartmentsForYear(allDepartments, overrides ?? [], institutionId, mbbsYear) : []),
    [allDepartments, overrides, institutionId, mbbsYear],
  )
  const loading = catalog === null || own === null || overrides === null

  return { departments, allDepartments, loading }
}
