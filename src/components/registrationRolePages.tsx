import { useAuth } from '../auth/AuthContext'
import { PrimaryAdminShell } from '../roles/primary-admin/shell/PrimaryAdminShell'
import { InstitutionAdminShell } from '../roles/institution-admin/shell/InstitutionAdminShell'
import { RegistrationRequestsPage } from './RegistrationRequestsPage'

export function PrimaryAdminRegistrationsPage() {
  return <RegistrationRequestsPage Shell={PrimaryAdminShell} />
}

export function InstitutionAdminRegistrationsPage() {
  const { appUser } = useAuth()
  return <RegistrationRequestsPage Shell={InstitutionAdminShell} institutionId={appUser?.institutionId ?? null} />
}
