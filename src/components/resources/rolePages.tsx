import { useAuth } from '../../auth/AuthContext'
import { PrimaryAdminShell } from '../../roles/primary-admin/shell/PrimaryAdminShell'
import { InstitutionAdminShell } from '../../roles/institution-admin/shell/InstitutionAdminShell'
import { StudentShell } from '../../roles/student/shell/StudentShell'
import { FacultyShell } from '../../roles/faculty/shell/FacultyShell'
import { HodShell } from '../../roles/hod/shell/HodShell'
import { ResourcesManagePage } from './ResourcesManagePage'
import { ResourceEditorPage } from './ResourceEditorPage'
import { ResourceLibraryPage } from './ResourceLibraryPage'

// Thin per-role wrappers for the shared Resources pages — each just picks
// its shell and paths (same pattern as SubmissionReviewPage's wrappers).

export function PrimaryAdminResourcesPage() {
  return <ResourcesManagePage Shell={PrimaryAdminShell} basePath="/admin/resources" />
}
export function PrimaryAdminResourceEditorPage() {
  return <ResourceEditorPage Shell={PrimaryAdminShell} backTo="/admin/resources" backLabel="All resources" />
}

export function InstitutionAdminResourcesPage() {
  const { appUser } = useAuth()
  return <ResourcesManagePage Shell={InstitutionAdminShell} institutionId={appUser?.institutionId ?? null} basePath="/institution-admin/resources" />
}
export function InstitutionAdminResourceEditorPage() {
  const { appUser } = useAuth()
  return (
    <ResourceEditorPage
      Shell={InstitutionAdminShell}
      lockedInstitutionId={appUser?.institutionId ?? ''}
      backTo="/institution-admin/resources"
      backLabel="All resources"
    />
  )
}

export function StudentResourcesPage() {
  return <ResourceLibraryPage Shell={StudentShell} audience="student" />
}
export function FacultyResourcesPage() {
  return <ResourceLibraryPage Shell={FacultyShell} audience="faculty" />
}
export function HodResourcesPage() {
  return <ResourceLibraryPage Shell={HodShell} audience="faculty" />
}
