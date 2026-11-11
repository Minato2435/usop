import { useSearchParams } from 'react-router-dom'
import { TemplateDetailPage } from '../../components/formEngine/TemplateDetailPage'

// Shared editor route — reused from both the global Log Templates list and
// an institution's own "Institution-specific logs" list (Institution
// Management portal). The back link needs to return wherever the user
// actually came from, not always the global list, so the institution
// portal passes its own id as a query param when it links here.
export function PrimaryAdminTemplateDetail() {
  const [searchParams] = useSearchParams()
  const institutionId = searchParams.get('institutionId')
  const backPath = institutionId ? `/admin/institutions/${institutionId}` : '/admin/log-templates'
  return <TemplateDetailPage backPath={backPath} />
}
