import { PrimaryAdminCertificatePresetEditorPage } from '../roles/primary-admin/CertificatePresetEditorPage'
import { PrimaryAdminVideoEditorPage, PrimaryAdminInstitutionVideoEditorPage } from '../roles/primary-admin/VideoEditorPage'
import { InstitutionAdminVideoEditorPage } from '../roles/institution-admin/VideoEditorPage'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from '../auth/AuthContext'
import { LoginPage } from '../auth/LoginPage'
import { RegisterPage } from '../auth/RegisterPage'
import { InstitutionAdminRegistrationsPage, PrimaryAdminRegistrationsPage } from '../components/registrationRolePages'
import { RequireRole, roleHomePath } from './RequireRole'
import { ThemeSync } from './ThemeSync'
import { DarkModeProvider } from './DarkModeContext'
import { PrimaryAdminDashboard } from '../roles/primary-admin/Dashboard'
import { InstitutionAdminDashboard } from '../roles/institution-admin/Dashboard'
import { PrincipalDashboard } from '../roles/principal/Dashboard'
import { PrincipalActivityPage } from '../roles/principal/ActivityPage'
import { PrincipalDirectoryPage } from '../roles/principal/DirectoryPage'
import { HodDashboard } from '../roles/hod/Dashboard'
import { HodStudentsPage } from '../roles/hod/StudentsPage'
import { HodFacultyPage } from '../roles/hod/FacultyPage'
import { HodDepartmentActivitiesPage } from '../roles/hod/DepartmentActivitiesPage'
import { HodReviewSubmissionPage } from '../roles/hod/ReviewSubmissionPage'
import { HodVideosPage } from '../roles/hod/VideosPage'
import { FacultyDashboard } from '../roles/faculty/Dashboard'
import { FacultyInboxPage } from '../roles/faculty/InboxPage'
import { FacultyReviewSubmissionPage } from '../roles/faculty/ReviewSubmissionPage'
import { FacultyFormsPage } from '../roles/faculty/FormsPage'
import { FacultyVideosPage } from '../roles/faculty/VideosPage'
import { StudentDashboard } from '../roles/student/Dashboard'
import { StudentActivitiesPage } from '../roles/student/ActivitiesPage'
import { StudentMyActivityPage } from '../roles/student/MyActivityPage'
import { StudentFormsPage } from '../roles/student/FormsPage'
import { StudentVideosPage } from '../roles/student/VideosPage'
import { PrimaryAdminLogTemplatesPage } from '../roles/primary-admin/LogTemplatesPage'
import { PrimaryAdminTemplateDetail } from '../roles/primary-admin/TemplateDetail'
import { PrimaryAdminInstitutionsPage } from '../roles/primary-admin/InstitutionsPage'
import { PrimaryAdminInstitutionDetailPage } from '../roles/primary-admin/InstitutionDetailPage'
import { PrimaryAdminUsersPage } from '../roles/primary-admin/UsersPage'
import { PrimaryAdminDepartmentsPage } from '../roles/primary-admin/DepartmentsPage'
import { PrimaryAdminCompetenciesPage } from '../roles/primary-admin/CompetenciesPage'
import { PrimaryAdminCompetencyEditorPage } from '../roles/primary-admin/CompetencyEditorPage'
import { PrimaryAdminFormsPage } from '../roles/primary-admin/FormsPage'
import { PrimaryAdminFormEditorPage } from '../roles/primary-admin/FormEditorPage'
import { PrimaryAdminVideoTutorialsPage } from '../roles/primary-admin/VideoTutorialsPage'
import { PrimaryAdminVideoBatchCreatePage } from '../roles/primary-admin/VideoBatchCreatePage'
import { PrimaryAdminPlatformConfigPage } from '../roles/primary-admin/PlatformConfigPage'
import { InstitutionAdminLogTemplatesPage } from '../roles/institution-admin/LogTemplatesPage'
import { InstitutionAdminTemplateDetail } from '../roles/institution-admin/TemplateDetail'
import { InstitutionAdminDepartmentsPage } from '../roles/institution-admin/DepartmentsPage'
import { InstitutionAdminCompetenciesPage } from '../roles/institution-admin/CompetenciesPage'
import { InstitutionAdminCompetencyEditorPage } from '../roles/institution-admin/CompetencyEditorPage'
import { InstitutionAdminVideoTutorialsPage } from '../roles/institution-admin/VideoTutorialsPage'
import { InstitutionAdminUsersPage } from '../roles/institution-admin/UsersPage'
import { InstitutionAdminPromoteStudentsPage } from '../roles/institution-admin/PromoteStudentsPage'
import { PrimaryAdminPromoteStudentsPage } from '../roles/primary-admin/PromoteStudentsPage'
import {
  FacultyResourcesPage,
  HodResourcesPage,
  InstitutionAdminResourceEditorPage,
  InstitutionAdminResourcesPage,
  PrimaryAdminResourceEditorPage,
  PrimaryAdminResourcesPage,
  StudentResourcesPage,
} from '../components/resources/rolePages'
import { PrimaryAdminCertificateManagementPage } from '../roles/primary-admin/CertificateManagementPage'
import { PrimaryAdminShell } from '../roles/primary-admin/shell/PrimaryAdminShell'
import { StudentMyPortfolioPage } from '../roles/student/MyPortfolioPage'
import { SkillLabDirectorDashboard } from '../roles/skill-lab-director/Dashboard'
import { SkillLabDirectorSkillPresetsPage, SkillLabDirectorPresetEditorPage } from '../roles/skill-lab-director/SkillPresetsPage'
import { SkillLabDirectorRequestsPage } from '../roles/skill-lab-director/RequestsPage'
import { SkillLabDirectorReviewRequestPage } from '../roles/skill-lab-director/ReviewRequestPage'
import { CertificateRequestReviewPage } from '../components/CertificateRequestReviewPage'

function RootRedirect() {
  const { appUser, firebaseUser, loading, profileMissing } = useAuth()
  if (loading) return null
  if (!firebaseUser) return <Navigate to="/login" replace />
  // Signed in with no resolvable profile yet: send to any role-guarded route
  // so RequireRole can surface the actual profile error instead of bouncing
  // silently back to /login.
  if (!appUser && profileMissing) return <Navigate to="/register" replace />
  if (!appUser) return <Navigate to="/admin" replace />
  return <Navigate to={roleHomePath(appUser.role)} replace />
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <DarkModeProvider>
        <ThemeSync />
        <Routes>
          <Route path="/" element={<RootRedirect />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />

          <Route
            path="/admin"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminDashboard />
              </RequireRole>
            }
          />
          <Route
            path="/admin/registrations"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminRegistrationsPage />
              </RequireRole>
            }
          />
          <Route
            path="/institution-admin/registrations"
            element={
              <RequireRole roles={['institutionAdmin']}>
                <InstitutionAdminRegistrationsPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/log-templates"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminLogTemplatesPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/log-templates/:templateId"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminTemplateDetail />
              </RequireRole>
            }
          />
          <Route
            path="/admin/institutions"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminInstitutionsPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/institutions/:institutionId"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminInstitutionDetailPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/users"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminUsersPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/promote-students"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminPromoteStudentsPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/departments"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminDepartmentsPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/competencies"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminCompetenciesPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/competencies/:templateId/:nodeId"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminCompetencyEditorPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/forms"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminFormsPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/forms/:templateId"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminFormEditorPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/video-tutorials"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminVideoTutorialsPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/video-tutorials/new"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminVideoEditorPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/video-tutorials/:videoId/edit"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminVideoEditorPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/institutions/:institutionId/videos/new"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminInstitutionVideoEditorPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/institutions/:institutionId/videos/:videoId/edit"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminInstitutionVideoEditorPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/video-tutorials/batches/new"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminVideoBatchCreatePage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/video-tutorials/batches/:batchId/edit"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminVideoBatchCreatePage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/certificates"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminCertificateManagementPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/certificates/presets/:departmentId"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminCertificatePresetEditorPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/certificates/requests/:requestId"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <CertificateRequestReviewPage approver="primaryAdmin" backTo="/admin/certificates" backLabel="Certificate Management" Shell={PrimaryAdminShell} />
              </RequireRole>
            }
          />
          <Route
            path="/admin/settings"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminPlatformConfigPage />
              </RequireRole>
            }
          />
          <Route
            path="/institution-admin"
            element={
              <RequireRole roles={['institutionAdmin']}>
                <InstitutionAdminDashboard />
              </RequireRole>
            }
          />
          <Route
            path="/institution-admin/log-templates"
            element={
              <RequireRole roles={['institutionAdmin']}>
                <InstitutionAdminLogTemplatesPage />
              </RequireRole>
            }
          />
          <Route
            path="/institution-admin/log-templates/:templateId"
            element={
              <RequireRole roles={['institutionAdmin']}>
                <InstitutionAdminTemplateDetail />
              </RequireRole>
            }
          />
          <Route
            path="/institution-admin/departments"
            element={
              <RequireRole roles={['institutionAdmin']}>
                <InstitutionAdminDepartmentsPage />
              </RequireRole>
            }
          />
          <Route
            path="/institution-admin/competencies"
            element={
              <RequireRole roles={['institutionAdmin']}>
                <InstitutionAdminCompetenciesPage />
              </RequireRole>
            }
          />
          <Route
            path="/institution-admin/competencies/global/:templateId/:nodeId"
            element={
              <RequireRole roles={['institutionAdmin']}>
                <InstitutionAdminCompetencyEditorPage mode="global" />
              </RequireRole>
            }
          />
          <Route
            path="/institution-admin/competencies/own/:templateId/:nodeId"
            element={
              <RequireRole roles={['institutionAdmin']}>
                <InstitutionAdminCompetencyEditorPage mode="own" />
              </RequireRole>
            }
          />
          <Route
            path="/institution-admin/video-tutorials"
            element={
              <RequireRole roles={['institutionAdmin']}>
                <InstitutionAdminVideoTutorialsPage />
              </RequireRole>
            }
          />
          <Route
            path="/institution-admin/video-tutorials/new"
            element={
              <RequireRole roles={['institutionAdmin']}>
                <InstitutionAdminVideoEditorPage />
              </RequireRole>
            }
          />
          <Route
            path="/institution-admin/video-tutorials/:videoId/edit"
            element={
              <RequireRole roles={['institutionAdmin']}>
                <InstitutionAdminVideoEditorPage />
              </RequireRole>
            }
          />
          <Route
            path="/institution-admin/users"
            element={
              <RequireRole roles={['institutionAdmin']}>
                <InstitutionAdminUsersPage />
              </RequireRole>
            }
          />
          <Route
            path="/institution-admin/promote-students"
            element={
              <RequireRole roles={['institutionAdmin']}>
                <InstitutionAdminPromoteStudentsPage />
              </RequireRole>
            }
          />
          <Route
            path="/principal"
            element={
              <RequireRole roles={['principal']}>
                <PrincipalDashboard />
              </RequireRole>
            }
          />
          <Route
            path="/principal/directory"
            element={
              <RequireRole roles={['principal']}>
                <PrincipalDirectoryPage />
              </RequireRole>
            }
          />
          <Route
            path="/principal/activity"
            element={
              <RequireRole roles={['principal']}>
                <PrincipalActivityPage />
              </RequireRole>
            }
          />
          <Route
            path="/hod"
            element={
              <RequireRole roles={['hod']}>
                <HodDashboard />
              </RequireRole>
            }
          />
          <Route
            path="/hod/students"
            element={
              <RequireRole roles={['hod']}>
                <HodStudentsPage />
              </RequireRole>
            }
          />
          <Route
            path="/hod/faculty"
            element={
              <RequireRole roles={['hod']}>
                <HodFacultyPage />
              </RequireRole>
            }
          />
          <Route
            path="/hod/activities"
            element={
              <RequireRole roles={['hod']}>
                <HodDepartmentActivitiesPage />
              </RequireRole>
            }
          />
          <Route
            path="/hod/activities/:submissionId"
            element={
              <RequireRole roles={['hod']}>
                <HodReviewSubmissionPage />
              </RequireRole>
            }
          />
          <Route
            path="/hod/videos"
            element={
              <RequireRole roles={['hod']}>
                <HodVideosPage />
              </RequireRole>
            }
          />
          <Route
            path="/faculty"
            element={
              <RequireRole roles={['faculty']}>
                <FacultyDashboard />
              </RequireRole>
            }
          />
          <Route
            path="/faculty/inbox"
            element={
              <RequireRole roles={['faculty']}>
                <FacultyInboxPage />
              </RequireRole>
            }
          />
          <Route
            path="/faculty/inbox/:submissionId"
            element={
              <RequireRole roles={['faculty']}>
                <FacultyReviewSubmissionPage />
              </RequireRole>
            }
          />
          <Route
            path="/faculty/forms"
            element={
              <RequireRole roles={['faculty']}>
                <FacultyFormsPage />
              </RequireRole>
            }
          />
          <Route
            path="/faculty/videos"
            element={
              <RequireRole roles={['faculty']}>
                <FacultyVideosPage />
              </RequireRole>
            }
          />
          <Route
            path="/student"
            element={
              <RequireRole roles={['student']}>
                <StudentDashboard />
              </RequireRole>
            }
          />
          <Route
            path="/student/activities"
            element={
              <RequireRole roles={['student']}>
                <StudentActivitiesPage />
              </RequireRole>
            }
          />
          <Route
            path="/student/my-activity"
            element={
              <RequireRole roles={['student']}>
                <StudentMyActivityPage />
              </RequireRole>
            }
          />
          <Route
            path="/student/portfolio"
            element={
              <RequireRole roles={['student']}>
                <StudentMyPortfolioPage />
              </RequireRole>
            }
          />
          <Route
            path="/student/forms"
            element={
              <RequireRole roles={['student']}>
                <StudentFormsPage />
              </RequireRole>
            }
          />
          <Route
            path="/student/videos"
            element={
              <RequireRole roles={['student']}>
                <StudentVideosPage />
              </RequireRole>
            }
          />

          <Route
            path="/skill-lab-director"
            element={
              <RequireRole roles={['skillLabDirector']}>
                <SkillLabDirectorDashboard />
              </RequireRole>
            }
          />
          <Route
            path="/skill-lab-director/presets"
            element={
              <RequireRole roles={['skillLabDirector']}>
                <SkillLabDirectorSkillPresetsPage />
              </RequireRole>
            }
          />
          <Route
            path="/skill-lab-director/presets/:departmentId"
            element={
              <RequireRole roles={['skillLabDirector']}>
                <SkillLabDirectorPresetEditorPage />
              </RequireRole>
            }
          />
          <Route
            path="/skill-lab-director/requests"
            element={
              <RequireRole roles={['skillLabDirector']}>
                <SkillLabDirectorRequestsPage />
              </RequireRole>
            }
          />
          <Route
            path="/skill-lab-director/requests/:requestId"
            element={
              <RequireRole roles={['skillLabDirector']}>
                <SkillLabDirectorReviewRequestPage />
              </RequireRole>
            }
          />

          {/* Resources (study material) */}
          <Route
            path="/admin/resources"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminResourcesPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/resources/new"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminResourceEditorPage />
              </RequireRole>
            }
          />
          <Route
            path="/admin/resources/:resourceId/edit"
            element={
              <RequireRole roles={['primaryAdmin']}>
                <PrimaryAdminResourceEditorPage />
              </RequireRole>
            }
          />
          <Route
            path="/institution-admin/resources"
            element={
              <RequireRole roles={['institutionAdmin']}>
                <InstitutionAdminResourcesPage />
              </RequireRole>
            }
          />
          <Route
            path="/institution-admin/resources/new"
            element={
              <RequireRole roles={['institutionAdmin']}>
                <InstitutionAdminResourceEditorPage />
              </RequireRole>
            }
          />
          <Route
            path="/institution-admin/resources/:resourceId/edit"
            element={
              <RequireRole roles={['institutionAdmin']}>
                <InstitutionAdminResourceEditorPage />
              </RequireRole>
            }
          />
          <Route
            path="/student/resources"
            element={
              <RequireRole roles={['student']}>
                <StudentResourcesPage />
              </RequireRole>
            }
          />
          <Route
            path="/faculty/resources"
            element={
              <RequireRole roles={['faculty']}>
                <FacultyResourcesPage />
              </RequireRole>
            }
          />
          <Route
            path="/hod/resources"
            element={
              <RequireRole roles={['hod']}>
                <HodResourcesPage />
              </RequireRole>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </DarkModeProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}
