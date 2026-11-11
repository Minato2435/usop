import { PrimaryAdminCompetencyEditorPage } from '../primary-admin/CompetencyEditorPage'
import { InstitutionAdminShell } from './shell/InstitutionAdminShell'

// Reuses the full Primary Admin competency-checklist editor, just swapping
// in this panel's shell and keeping every back-nav inside /institution-admin.
//  - mode="global": editing our institution's forked copy of a *global*
//    competency's checklist (the fork is created on first edit; the global
//    one and every other institution are untouched).
//  - mode="own": editing a competency inside one of our own
//    institution-specific SSL logs, directly.
export function InstitutionAdminCompetencyEditorPage({ mode }: { mode: 'global' | 'own' }) {
  return (
    <PrimaryAdminCompetencyEditorPage
      variant="institutionAdmin"
      ShellComponent={InstitutionAdminShell}
      forkForInstitution={mode === 'global'}
    />
  )
}
