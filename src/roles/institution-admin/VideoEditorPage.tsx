import { useAuth } from '../../auth/AuthContext'
import { VideoEditorPage } from '../../components/VideoEditorPage'
import { InstitutionAdminShell } from './shell/InstitutionAdminShell'

export function InstitutionAdminVideoEditorPage() {
  const { appUser } = useAuth()
  if (!appUser?.institutionId) return null
  return (
    <VideoEditorPage
      Shell={InstitutionAdminShell}
      institutionId={appUser.institutionId}
      backTo="/institution-admin/video-tutorials"
      backLabel="All videos"
    />
  )
}
