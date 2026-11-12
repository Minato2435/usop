import { useAuth } from '../auth/AuthContext'
import { PrimaryAdminShell } from '../roles/primary-admin/shell/PrimaryAdminShell'
import { InstitutionAdminShell } from '../roles/institution-admin/shell/InstitutionAdminShell'
import { BulkUserImportPage } from './BulkUserImportPage'

// Thin per-role wrappers for the shared Bulk add page.
export function PrimaryAdminBulkImportPage() {
  return <BulkUserImportPage Shell={PrimaryAdminShell} backTo="/admin/users" />
}
export function InstitutionAdminBulkImportPage() {
  const { appUser } = useAuth()
  return <BulkUserImportPage Shell={InstitutionAdminShell} lockedInstitutionId={appUser?.institutionId ?? ''} backTo="/institution-admin/users" />
}
