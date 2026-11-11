import { CertificateRequestsListPage } from '../../components/CertificateRequestsListPage'
import { SkillLabDirectorShell } from './shell/SkillLabDirectorShell'

export function SkillLabDirectorRequestsPage() {
  return <CertificateRequestsListPage Shell={SkillLabDirectorShell} basePath="/skill-lab-director/requests" title="Certificate Requests" />
}
