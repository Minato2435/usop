import { useEffect, useState } from 'react'
import { SkillLabDirectorShell } from './shell/SkillLabDirectorShell'
import { PresetsTab } from '../primary-admin/CertificateManagementPage'
import { CertificatePresetEditorPage } from '../../components/CertificatePresetEditorPage'
import { watchAllDepartments } from '../../lib/firestore/departments'
import { watchInstitutions } from '../../lib/firestore/institutions'
import { watchAllCertificateSkillPresets } from '../../lib/firestore/certificates'
import type { CertificateSkillPreset, Department, Institution } from '../../types'

// The same Skill presets view Primary Admin has on Certificate Management —
// the Skill Lab Director manages presets for every college too.
export function SkillLabDirectorSkillPresetsPage() {
  const [departments, setDepartments] = useState<Department[] | null>(null)
  useEffect(() => watchAllDepartments(setDepartments), [])
  const [institutions, setInstitutions] = useState<Institution[]>([])
  useEffect(() => watchInstitutions(setInstitutions, () => setInstitutions([])), [])
  const [presets, setPresets] = useState<CertificateSkillPreset[]>([])
  useEffect(() => watchAllCertificateSkillPresets(setPresets), [])

  return (
    <SkillLabDirectorShell eyebrow="Certificates" title="Skill presets">
      <p className="text-[13.5px] leading-relaxed max-w-[600px] mb-6" style={{ color: 'var(--color-char-soft)' }}>
        Set the skills each department requires for its certificate — globally, or for a single college.
      </p>
      <PresetsTab departments={departments} institutions={institutions} presets={presets} editorBasePath="/skill-lab-director/presets" />
    </SkillLabDirectorShell>
  )
}

export function SkillLabDirectorPresetEditorPage() {
  return <CertificatePresetEditorPage Shell={SkillLabDirectorShell} backTo="/skill-lab-director/presets" />
}
