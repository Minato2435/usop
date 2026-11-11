import { CertificatePresetEditorPage } from '../../components/CertificatePresetEditorPage'
import { PrimaryAdminShell } from './shell/PrimaryAdminShell'

export function PrimaryAdminCertificatePresetEditorPage() {
  return <CertificatePresetEditorPage Shell={PrimaryAdminShell} backTo="/admin/certificates?tab=presets" />
}
