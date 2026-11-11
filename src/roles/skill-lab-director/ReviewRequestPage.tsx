import { CertificateRequestReviewPage } from '../../components/CertificateRequestReviewPage'
import { SkillLabDirectorShell } from './shell/SkillLabDirectorShell'

// The actual review flow lives in the shared CertificateRequestReviewPage
// — see that file. firestore.rules is what actually authorizes this
// role's own decision write, not this page.
export function SkillLabDirectorReviewRequestPage() {
  return (
    <CertificateRequestReviewPage
      Shell={SkillLabDirectorShell}
      backTo="/skill-lab-director/requests"
      backLabel="Certificate Requests"
      approver="skillLabDirector"
    />
  )
}
