import { useParams } from 'react-router-dom'
import { VideoEditorPage } from '../../components/VideoEditorPage'
import { PrimaryAdminShell } from './shell/PrimaryAdminShell'

// Platform catalog video (institutionId '').
export function PrimaryAdminVideoEditorPage() {
  return <VideoEditorPage Shell={PrimaryAdminShell} institutionId="" backTo="/admin/video-tutorials" backLabel="All videos" />
}

// A college's own video, opened from Institutions → that college → Videos.
export function PrimaryAdminInstitutionVideoEditorPage() {
  const { institutionId = '' } = useParams<{ institutionId: string }>()
  return (
    <VideoEditorPage
      Shell={PrimaryAdminShell}
      institutionId={institutionId}
      backTo={`/admin/institutions/${institutionId}?tab=videos`}
      backLabel="Back to college videos"
    />
  )
}
