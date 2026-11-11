import { SubmissionReviewPage } from '../../components/SubmissionReviewPage'
import { FacultyShell } from './shell/FacultyShell'

// The actual review flow (Fill DOPS Form, prefilled signatures, decision
// panel) lives in the shared SubmissionReviewPage — see that file. This is
// just the Faculty-specific wiring (shell + back-nav), same pattern HOD's
// own ReviewSubmissionPage.tsx uses.
export function FacultyReviewSubmissionPage() {
  return <SubmissionReviewPage Shell={FacultyShell} backTo="/faculty/inbox" backLabel="Student Activities" />
}
