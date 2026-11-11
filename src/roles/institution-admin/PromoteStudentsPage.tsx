import { useAuth } from '../../auth/AuthContext'
import { InstitutionAdminShell } from './shell/InstitutionAdminShell'
import { PromoteStudentsPage } from '../../components/PromoteStudentsPage'

export function InstitutionAdminPromoteStudentsPage() {
  const { appUser } = useAuth()
  return <PromoteStudentsPage Shell={InstitutionAdminShell} lockedInstitutionId={appUser?.institutionId ?? null} />
}
