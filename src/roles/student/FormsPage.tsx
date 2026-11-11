import { useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { StudentShell } from './shell/StudentShell'
import { Card, Badge, Skeleton } from './shell/ui'
import { Icon } from '../primary-admin/shell/Icon'
import { StandardFormPreview } from '../../components/formEngine/StandardFormPreview'
import { watchStudentForms, watchFormTemplate } from '../../lib/firestore/facultyForms'
import { getAppUser } from '../../lib/firestore/users'
import type { FacultyForm, FormField } from '../../types'

// Student side of Module 05's faculty-initiated Forms path — every CBD/
// Mini-CEX/OSCE a faculty member has sent them, read-only, same
// expand-in-place accordion shape MyActivityPage already established.
export function StudentFormsPage() {
  const { appUser } = useAuth()
  const [forms, setForms] = useState<FacultyForm[] | null>(null)
  useEffect(() => {
    if (!appUser) return
    return watchStudentForms(appUser.uid, setForms)
  }, [appUser])

  const [openId, setOpenId] = useState<string | null>(null)

  const [facultyNames, setFacultyNames] = useState<Record<string, string>>({})
  useEffect(() => {
    const ids = Array.from(new Set((forms ?? []).map((f) => f.facultyId)))
    const missing = ids.filter((id) => !(id in facultyNames))
    if (missing.length === 0) return
    let cancelled = false
    Promise.all(missing.map((id) => getAppUser(id).then((u) => [id, u?.name ?? 'Faculty'] as const))).then((pairs) => {
      if (!cancelled) setFacultyNames((prev) => ({ ...prev, ...Object.fromEntries(pairs) }))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forms])

  const loading = forms === null

  return (
    <StudentShell eyebrow="Sent by faculty" title="Forms">
      {loading ? (
        <div className="space-y-2.5">
          <Skeleton className="h-16 rounded-[14px]" />
          <Skeleton className="h-16 rounded-[14px]" />
        </div>
      ) : forms.length === 0 ? (
        <Card elevated className="text-center py-10">
          <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
            No forms have been sent to you yet.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          {forms.map((form, i) => {
            const open = openId === form.id
            return (
              <div
                key={form.id}
                className="fade-up rounded-[14px] border transition-all duration-200 ease-out"
                style={{
                  backgroundColor: open ? 'color-mix(in srgb, var(--color-gold) 5%, var(--color-paper-raised) 95%)' : 'var(--color-paper-raised)',
                  borderColor: open ? 'var(--color-gold-line)' : 'var(--color-line)',
                  boxShadow: open ? '0 14px 30px -22px rgba(11,18,32,0.3)' : 'none',
                  animationDelay: `${i * 30}ms`,
                }}
              >
                <button
                  onClick={() => setOpenId(open ? null : form.id)}
                  className="w-full text-left grid gap-4 px-5 py-4 items-center"
                  style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }}
                >
                  <div className="min-w-0">
                    <div className="font-display text-[15.5px] leading-snug truncate" style={{ color: 'var(--color-char)' }}>
                      {form.title}
                    </div>
                    <div className="text-[12px] mt-1" style={{ color: 'var(--color-char-soft)' }}>
                      Sent by {facultyNames[form.facultyId] ?? '…'} ·{' '}
                      {new Date(form.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                  </div>
                  <div className="flex items-center gap-3.5 shrink-0">
                    <Badge tone="gold">{form.formType}</Badge>
                    <Icon
                      name="chevron"
                      className="h-4 w-4 transition-transform duration-200"
                      style={{ color: 'var(--color-char-soft)', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
                    />
                  </div>
                </button>

                {open && (
                  <div className="fade-up border-t px-5 py-5" style={{ borderColor: 'var(--color-line)' }}>
                    <FormAnswersPreview form={form} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </StudentShell>
  )
}

// A FacultyForm only stores `formTemplateId` + the filled `answers` — the
// actual field structure (labels/types/sections) still lives on the
// template, fetched lazily only once a card is expanded rather than for
// every form up front.
function FormAnswersPreview({ form }: { form: FacultyForm }) {
  const [fields, setFields] = useState<FormField[] | null | undefined>(undefined)
  useEffect(() => watchFormTemplate(form.formTemplateId, (t) => setFields(t ? t.fields : null)), [form.formTemplateId])

  if (fields === undefined) return <Skeleton className="h-40 rounded-[10px]" />
  if (fields === null) {
    return (
      <p className="text-[12.5px]" style={{ color: 'var(--color-char-soft)' }}>
        This form's structure is no longer available.
      </p>
    )
  }
  return <StandardFormPreview title={form.title} fields={fields} mode="review" value={form.answers} />
}
