import { SubmissionReviewPage } from '../../components/SubmissionReviewPage'
import { HodShell } from './shell/HodShell'

// The actual review flow lives in the shared SubmissionReviewPage — see
// that file. HOD gets the exact same Fill DOPS Form / decision experience
// Faculty does (per the build spec, HOD has "Full Faculty-level
// capabilities, plus department-wide scope"); firestore.rules is what
// actually authorizes the department-wide write, not this page.
export function HodReviewSubmissionPage() {
  return <SubmissionReviewPage Shell={HodShell} backTo="/hod/activities" backLabel="Department Activities" />
}
