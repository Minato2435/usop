import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { FacultyShell } from './shell/FacultyShell'
import { Card, Badge, GhostButton, Modal, PrimaryButton, Skeleton, inputClass } from './shell/ui'
import { StandardFormPreview } from '../../components/formEngine/StandardFormPreview'
import { watchActiveFormTemplates, watchFacultySentForms, createFacultyForm } from '../../lib/firestore/facultyForms'
import { watchDepartmentUsers } from '../../lib/firestore/users'
import { watchCatalogDepartments, watchInstitutionDepartments } from '../../lib/firestore/departments'
import { STUDENT_AUTOFILL_IDS, FACULTY_AUTOFILL_IDS } from '../../lib/facultyFormPresets'
import type { AppUser, Department, FacultyForm, FacultyFormTemplate, FieldAnswerValue } from '../../types'

// Module 05's "Forms Management Module (Faculty-Initiated Path)" —
// "Independent of the log-review flow — this is a second way for a Form
// to be created." Pick one of the form types Primary Admin has turned on
// for this institution, pick a student from the department roster, fill
// it out, send — no prior Submission involved at all.
export function FacultyFormsPage() {
  const { appUser } = useAuth()
  const institutionId = appUser?.institutionId ?? null
  const departmentId = appUser?.departmentId ?? null

  const [templates, setTemplates] = useState<FacultyFormTemplate[] | null>(null)
  useEffect(() => {
    if (!institutionId) return
    return watchActiveFormTemplates(institutionId, setTemplates)
  }, [institutionId])

  const [users, setUsers] = useState<AppUser[]>([])
  useEffect(() => {
    if (!institutionId || !departmentId) return
    return watchDepartmentUsers(institutionId, departmentId, setUsers)
  }, [institutionId, departmentId])
  const students = useMemo(() => users.filter((u) => u.role === 'student'), [users])

  const [catalogDepts, setCatalogDepts] = useState<Department[]>([])
  const [ownDepts, setOwnDepts] = useState<Department[]>([])
  useEffect(() => watchCatalogDepartments(setCatalogDepts), [])
  useEffect(() => {
    if (!institutionId) return
    return watchInstitutionDepartments(institutionId, setOwnDepts)
  }, [institutionId])
  const departmentName = useMemo(() => {
    const match = [...catalogDepts, ...ownDepts].find((d) => d.id === departmentId)
    return match?.name ?? ''
  }, [catalogDepts, ownDepts, departmentId])

  const [sent, setSent] = useState<FacultyForm[] | null>(null)
  useEffect(() => {
    if (!appUser) return
    return watchFacultySentForms(appUser.uid, setSent)
  }, [appUser])

  const [sending, setSending] = useState<FacultyFormTemplate | null>(null)
  const [studentId, setStudentId] = useState('')
  const [answers, setAnswers] = useState<Record<string, FieldAnswerValue>>({})
  const [saving, setSaving] = useState(false)

  function openSendModal(template: FacultyFormTemplate) {
    setSending(template)
    setStudentId('')
    setAnswers({})
  }

  // Auto-populates the student/faculty identity fields the moment a
  // student is picked — same "auto-populated identity fields" idea the
  // DOPS review flow already uses, applied to the field ids every one of
  // these presets actually has.
  useEffect(() => {
    if (!sending || !studentId || !appUser) return
    const student = students.find((s) => s.uid === studentId)
    if (!student) return
    setAnswers((prev) => {
      const next = { ...prev }
      for (const id of STUDENT_AUTOFILL_IDS) {
        if (next[id]) continue
        if (id === 'roll_number') next[id] = student.rollNumber ?? ''
        else if (id === 'department') next[id] = departmentName
        else next[id] = student.name
      }
      for (const id of FACULTY_AUTOFILL_IDS) {
        if (!next[id]) next[id] = appUser.name
      }
      return next
    })
    // Deliberately re-runs if departmentName resolves after this first
    // fires (it's a separate watcher, may still be loading) — the `if
    // (next[id]) continue` guard means it only ever fills a still-empty
    // field, never clobbers something already typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, studentId, departmentName])

  async function handleSend() {
    if (!sending || !studentId || !appUser || !institutionId || !departmentId) return
    setSaving(true)
    try {
      await createFacultyForm({
        formTemplateId: sending.id,
        formType: sending.formType,
        title: sending.title,
        institutionId,
        departmentId,
        facultyId: appUser.uid,
        studentId,
        answers,
      })
      setSending(null)
    } finally {
      setSaving(false)
    }
  }

  const loading = templates === null

  return (
    <FacultyShell eyebrow="Faculty-initiated" title="Forms">
      <p className="text-[13px] mb-6" style={{ color: 'var(--color-char-soft)' }}>
        Send a standard assessment form directly to a student — independent of their activity submissions.
      </p>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Skeleton className="h-28 rounded-[10px]" />
          <Skeleton className="h-28 rounded-[10px]" />
        </div>
      ) : templates.length === 0 ? (
        <Card elevated>
          <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            No forms have been turned on for your institution yet.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mb-8">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => openSendModal(t)}
              className="text-left rounded-[10px] border p-5 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-14px_rgba(11,18,32,0.35)] hover:border-[var(--color-gold-line)]"
              style={{ backgroundColor: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)', borderColor: 'var(--color-line)' }}
            >
              <Badge tone="gold">{t.formType}</Badge>
              <div className="font-display text-[17px] leading-snug mt-2.5 mb-1" style={{ color: 'var(--color-char)' }}>
                {t.title}
              </div>
              <div className="text-[12px]" style={{ color: 'var(--color-char-soft)' }}>
                {t.fields.length} fields — click to send
              </div>
            </button>
          ))}
        </div>
      )}

      <div className="font-display text-[15.5px] mb-3" style={{ color: 'var(--color-char)' }}>
        Recently sent
      </div>
      {sent === null ? (
        <Skeleton className="h-14 rounded-[10px]" />
      ) : sent.length === 0 ? (
        <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
          You haven't sent any forms yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {sent.slice(0, 10).map((s) => {
            const student = students.find((st) => st.uid === s.studentId)
            return (
              <div
                key={s.id}
                className="flex items-center gap-3.5 rounded-[10px] border px-4 py-3"
                style={{ backgroundColor: 'var(--color-paper-raised)', borderColor: 'var(--color-line)' }}
              >
                <Badge tone="gold">{s.formType}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] truncate" style={{ color: 'var(--color-char)' }}>
                    {s.title}
                  </div>
                  <div className="text-[11.5px] truncate mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
                    Sent to {student?.name ?? '…'}
                  </div>
                </div>
                <span className="text-[11px] font-mono shrink-0" style={{ color: 'var(--color-char-soft)' }}>
                  {new Date(s.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {sending && (
        <Modal title={`Send: ${sending.title}`} onClose={() => setSending(null)} wide>
          <label className="block mb-5">
            <span className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
              Student
            </span>
            <select value={studentId} onChange={(e) => setStudentId(e.target.value)} className={inputClass} style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}>
              <option value="" disabled>
                Choose a student…
              </option>
              {students.map((s) => (
                <option key={s.uid} value={s.uid}>
                  {s.name} {s.rollNumber ? `· ${s.rollNumber}` : ''}
                </option>
              ))}
            </select>
          </label>

          {studentId && <StandardFormPreview title={sending.title} fields={sending.fields} mode="fill" value={answers} onChange={setAnswers} />}

          <div className="flex justify-end gap-2 mt-5 pt-4 border-t" style={{ borderColor: 'var(--color-line)' }}>
            <GhostButton onClick={() => setSending(null)}>Cancel</GhostButton>
            <PrimaryButton onClick={handleSend} disabled={!studentId || saving}>
              {saving ? 'Sending…' : 'Send to student'}
            </PrimaryButton>
          </div>
        </Modal>
      )}
    </FacultyShell>
  )
}
