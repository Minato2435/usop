import { useEffect, useState, type ComponentType, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { VoiceInputButton } from './VoiceInputButton'
import { appendDictation } from '../lib/useSpeechToText'
import { useAuth } from '../auth/AuthContext'
import { Icon } from '../roles/primary-admin/shell/Icon'
import { DopsChecklistPreview } from '../roles/primary-admin/DopsChecklistPreview'
import { GhostButton, PrimaryButton, Skeleton } from '../roles/primary-admin/shell/ui'
import { StatusPill } from './StatusPill'
import { AttachmentGallery } from './AttachmentGallery'
import { watchSubmission, facultyDecideSubmission } from '../lib/firestore/submissions'
import { sanitizeRichText } from '../lib/sanitizeHtml'
import { watchFormSchema } from '../lib/firestore/formSchemas'
import { watchTemplate } from '../lib/firestore/logTemplates'
import { getAppUser } from '../lib/firestore/users'
import type { AppUser, CompetencyLevel, FieldAnswerValue, FormSchema, LogTemplate, Submission } from '../types'

// The faculty review flow (Fill DOPS Form, prefilled signatures, decision
// panel), extracted into a shared component once HOD needed the exact same
// page — HOD's spec capability is literally "Full Faculty-level
// capabilities, plus department-wide scope," so the review experience
// itself is identical; only the surrounding shell/back-link/eyebrow differ
// per role. Same "shared, role-agnostic component" pattern CLAUDE.md
// documents for TemplateDetailPage: the component takes the calling role's
// Shell and back-navigation as props rather than being duplicated per role.
// `firestore.rules` is what actually enforces who may write a decision
// (the submission's own facultyId for Faculty, department scope for HOD) —
// this component doesn't need to know which role is using it.
const ATTEMPT_LABELS: Record<string, string> = { first: 'First attempt', repeat: 'Repeat attempt', remedial: 'Remedial attempt' }
function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
function formatDateTime(ms: number): string {
  const d = new Date(ms)
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
}

const LEVELS: { key: CompetencyLevel; label: string }[] = [
  { key: 'O', label: 'Observed' },
  { key: 'A', label: 'Assisted' },
  { key: 'P', label: 'Performed under supervision' },
  { key: 'I', label: 'Independently performed' },
]

// The "DOPS Assessment.dc.html" reference's `.band` — a 160px kicker+
// subtext label column beside a content column, divided from the previous
// band by a hairline top border.
function Band({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  return (
    <div className="grid gap-8 py-6 border-t" style={{ gridTemplateColumns: '160px minmax(0,1fr)', borderColor: 'var(--color-line)' }}>
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.09em]" style={{ color: 'var(--color-char-soft)' }}>
          {label}
        </div>
        {sub && (
          <div className="text-[12px] mt-1.5 leading-relaxed" style={{ color: 'var(--color-char-soft)' }}>
            {sub}
          </div>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

type ShellProps = { eyebrow?: string; title: string; actions?: ReactNode; children: ReactNode }

export function SubmissionReviewPage({
  Shell,
  backTo,
  backLabel,
}: {
  Shell: ComponentType<ShellProps>
  backTo: string
  backLabel: string
}) {
  const { submissionId } = useParams<{ submissionId: string }>()
  const navigate = useNavigate()
  const { appUser } = useAuth()

  const [submission, setSubmission] = useState<Submission | null | undefined>(undefined)
  useEffect(() => {
    if (!submissionId) return
    return watchSubmission(submissionId, setSubmission)
  }, [submissionId])

  const [schema, setSchema] = useState<FormSchema | null | undefined>(undefined)
  useEffect(() => {
    if (!submission) return
    return watchFormSchema(submission.formSchemaId, setSchema)
  }, [submission])

  const [template, setTemplate] = useState<LogTemplate | null | undefined>(undefined)
  useEffect(() => {
    if (!submission) return
    return watchTemplate(submission.templateId, setTemplate)
  }, [submission])

  const [student, setStudent] = useState<AppUser | null | undefined>(undefined)
  useEffect(() => {
    if (!submission) return
    let cancelled = false
    getAppUser(submission.studentId).then((u) => {
      if (!cancelled) setStudent(u)
    })
    return () => {
      cancelled = true
    }
  }, [submission])

  const [feedback, setFeedback] = useState('')
  const [remarks, setRemarks] = useState('')
  const [rating, setRating] = useState<number | null>(null)
  const [level, setLevel] = useState<CompetencyLevel | null>(null)
  const [answers, setAnswers] = useState<Record<string, FieldAnswerValue>>({})
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    if (!submission || hydrated) return
    setFeedback(submission.facultyFeedback ?? '')
    setRemarks(submission.facultyRemarks ?? '')
    setRating(submission.facultyRating)
    setLevel(submission.competencyLevel)
    setAnswers(submission.answers ?? {})
    setHydrated(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submission])

  // The checklist stays collapsed behind a "Fill DOPS Form"/"View checklist"
  // prompt by default — open already for an already-decided submission,
  // closed by default for a pending one. Only the *initial* state though: a
  // "Hide checklist" toggle lets the reviewer collapse it back afterward
  // without losing any in-progress `answers` — those live in separate state.
  const [fillOpen, setFillOpen] = useState(false)
  const [openInitialized, setOpenInitialized] = useState(false)
  useEffect(() => {
    if (!submission || openInitialized) return
    setFillOpen(submission.status !== 'submitted')
    setOpenInitialized(true)
  }, [submission, openInitialized])

  // Auto-populates the two signature fields the moment the form is opened
  // to fill — the student's own name for their acknowledgement line, the
  // signed-in reviewer's name for the assessor line. Only fills fields
  // that are still empty, and only ever runs once, so it never clobbers
  // something already typed.
  const [signaturesPrefilled, setSignaturesPrefilled] = useState(false)
  useEffect(() => {
    if (!fillOpen || signaturesPrefilled || !schema || !student || !appUser) return
    setAnswers((prev) => {
      const next = { ...prev }
      for (const f of schema.fields) {
        if (f.id === 'student-ack' && !next[f.id]) next[f.id] = student.name
        if (f.id === 'assessor-sign' && !next[f.id]) next[f.id] = appUser.name
      }
      return next
    })
    setSignaturesPrefilled(true)
  }, [fillOpen, signaturesPrefilled, schema, student, appUser])

  const [deciding, setDeciding] = useState<'approved' | 'revisionRequested' | 'rejected' | null>(null)

  async function decide(status: 'approved' | 'revisionRequested' | 'rejected') {
    if (!submissionId) return
    setDeciding(status)
    try {
      await facultyDecideSubmission(submissionId, {
        status,
        facultyFeedback: feedback.trim() || null,
        facultyRemarks: remarks.trim() || null,
        facultyRating: rating,
        competencyLevel: level,
        answers,
        reviewedById: appUser?.uid ?? null,
        reviewedByName: appUser?.name ?? null,
        reviewedByRole: appUser?.role === 'hod' ? 'hod' : 'faculty',
      })
      navigate(backTo)
    } finally {
      setDeciding(null)
    }
  }

  const loading = submission === undefined || (!!submission && schema === undefined) || student === undefined
  const notFound = submission === null || !submissionId
  const pending = submission?.status === 'submitted'

  return (
    <Shell eyebrow={student ? student.name : 'Review'} title={loading ? 'Loading…' : notFound ? 'Not found' : submission!.nodeTitle}>
      <button
        onClick={() => navigate(backTo)}
        className="inline-flex items-center gap-1.5 text-[12.5px] font-medium mb-5 hover:opacity-70 transition-opacity"
        style={{ color: 'var(--color-char-soft)' }}
      >
        <Icon name="chevron" className="h-3 w-3 rotate-180" />
        {backLabel}
      </button>

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 rounded-[10px]" />
          <Skeleton className="h-64 rounded-[10px]" />
        </div>
      ) : notFound ? (
        <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
          This submission doesn't exist or isn't visible to you.
        </p>
      ) : (
        <div>
          <div className="flex items-start justify-between gap-6 flex-wrap pb-6" style={{ borderBottom: '1px solid var(--color-line)' }}>
            <div className="flex items-center gap-4 min-w-0">
              <div
                className="h-12 w-12 shrink-0 rounded-full flex items-center justify-center font-display text-[18px] border"
                style={{ borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)' }}
              >
                {(student?.name.trim()[0] ?? '?').toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="font-display text-[22px] leading-tight" style={{ color: 'var(--color-char)' }}>
                  {student?.name}
                </div>
                <div className="text-[12px] mt-1" style={{ color: 'var(--color-char-soft)' }}>
                  {[
                    student?.rollNumber,
                    submission!.mbbsYear ? `Year ${submission!.mbbsYear}` : null,
                    submission!.activityDate ? formatDate(submission!.activityDate) : null,
                    submission!.attemptType ? ATTEMPT_LABELS[submission!.attemptType] : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            </div>
            <StatusPill status={submission!.status} resubmitted={submission!.resubmittedAfterRevision} />
          </div>

          {submission!.description && (
            <Band label="Description" sub={submission!.submittedAt ? `Submitted ${formatDateTime(submission!.submittedAt)}` : undefined}>
              <div
                className="text-[13.5px] leading-relaxed"
                style={{ color: 'var(--color-char)' }}
                dangerouslySetInnerHTML={{ __html: sanitizeRichText(submission!.description) }}
              />
            </Band>
          )}

          {submission!.images && submission!.images.length > 0 && (
            <Band label="Attachments" sub={`${submission!.images.length} file${submission!.images.length === 1 ? '' : 's'}`}>
              <AttachmentGallery images={submission!.images} />
            </Band>
          )}

          <div className="pt-6 border-t" style={{ borderColor: 'var(--color-line)' }}>
            {!schema ? (
              pending && (
                <p className="text-[12.5px]" style={{ color: 'var(--color-char-soft)' }}>
                  No review checklist is configured for this skill — you can still record a decision below.
                </p>
              )
            ) : !fillOpen ? (
              <button
                onClick={() => setFillOpen(true)}
                className="fade-up flex items-center gap-3.5 rounded-[10px] border-2 border-dashed px-5 py-4 text-left w-full transition-colors hover:border-solid"
                style={{ borderColor: 'var(--color-gold-line)', backgroundColor: 'color-mix(in srgb, var(--color-gold) 5%, var(--color-paper-raised) 95%)' }}
              >
                <span
                  className="h-10 w-10 shrink-0 rounded-full flex items-center justify-center"
                  style={{ backgroundColor: 'var(--color-gold)', color: 'var(--color-frost)' }}
                >
                  <Icon name="checkCircle" className="h-[18px] w-[18px]" />
                </span>
                <span>
                  <span className="block font-display text-[15px]" style={{ color: 'var(--color-char)' }}>
                    {pending ? 'Fill DOPS Form' : 'View checklist'}
                  </span>
                  <span className="block text-[12px] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
                    {pending
                      ? `Opens ${schema.title} — pre-filled with ${student?.name ?? 'the student'}'s details.`
                      : `See the filled ${schema.title} for this review.`}
                  </span>
                </span>
              </button>
            ) : (
              <div>
                <button
                  onClick={() => setFillOpen(false)}
                  className="text-[11.5px] font-medium mb-3 hover:opacity-70 transition-opacity"
                  style={{ color: 'var(--color-gold)' }}
                >
                  Hide checklist
                </button>
                <DopsChecklistPreview
                  title={submission!.nodeTitle}
                  department={template?.department}
                  code={schema.code}
                  setting={schema.setting}
                  level={schema.level}
                  domains={schema.domains}
                  fields={schema.fields}
                  mode={pending ? 'fill' : 'review'}
                  value={answers}
                  onChange={setAnswers}
                />
              </div>
            )}
          </div>

          <Band label="Evaluation" sub={pending ? undefined : "Already sent — can't be changed here."}>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] font-medium mb-1.5" style={{ color: 'var(--color-char-soft)' }}>
                  Feedback
                </label>
                <div className="relative">
                <textarea
                  className="w-full pl-3 pr-12 py-2.5 text-[13.5px] rounded-[8px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)] disabled:opacity-60"
                  style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)', backgroundColor: 'var(--color-paper)' }}
                  rows={3}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="Comments on performance, safety, and next steps…"
                  disabled={!pending}
                />
                  {pending && (
                    <VoiceInputButton
                      className="absolute right-2 bottom-2"
                      onText={(t) => setFeedback((prev) => appendDictation(prev, t))}
                      label="Speak your feedback"
                    />
                  )}
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-medium mb-1.5" style={{ color: 'var(--color-char-soft)' }}>
                  Remarks
                </label>
                <div className="relative">
                <textarea
                  className="w-full pl-3 pr-12 py-2.5 text-[13.5px] rounded-[8px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)] disabled:opacity-60"
                  style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)', backgroundColor: 'var(--color-paper)' }}
                  rows={3}
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Anything else worth noting…"
                  disabled={!pending}
                />
                  {pending && (
                    <VoiceInputButton
                      className="absolute right-2 bottom-2"
                      onText={(t) => setRemarks((prev) => appendDictation(prev, t))}
                      label="Speak your remarks"
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-[11px] font-medium mb-1.5" style={{ color: 'var(--color-char-soft)' }}>
                  Rating
                </label>
                <div className="flex gap-1.5">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      onClick={() => pending && setRating(rating === n ? null : n)}
                      disabled={!pending}
                      className="h-8 w-8 rounded-full text-[12px] font-semibold border transition-colors disabled:opacity-60"
                      style={{
                        borderColor: 'var(--color-gold-line)',
                        backgroundColor: rating === n ? 'var(--color-gold)' : 'transparent',
                        color: rating === n ? 'var(--color-frost)' : 'var(--color-gold)',
                      }}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium mb-1.5" style={{ color: 'var(--color-char-soft)' }}>
                  Competency level
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {LEVELS.map((l) => {
                    const active = level === l.key
                    return (
                      <button
                        key={l.key}
                        onClick={() => pending && setLevel(active ? null : l.key)}
                        disabled={!pending}
                        title={l.label}
                        className="flex items-center gap-1.5 text-left px-2.5 py-1.5 border rounded-[6px] transition-colors duration-150 disabled:opacity-60"
                        style={{
                          borderColor: active ? 'var(--color-teal)' : 'var(--color-line)',
                          backgroundColor: active ? 'var(--color-teal-soft)' : 'transparent',
                        }}
                      >
                        <span
                          className="shrink-0 h-5 w-5 rounded-full flex items-center justify-center font-display text-[10.5px]"
                          style={{
                            backgroundColor: active ? 'var(--color-teal)' : 'transparent',
                            border: `1px solid ${active ? 'var(--color-teal)' : 'var(--color-line)'}`,
                            color: active ? 'var(--color-frost)' : 'var(--color-char-soft)',
                          }}
                        >
                          {l.key}
                        </span>
                        <span className="text-[11.5px]" style={{ color: 'var(--color-char)' }}>
                          {l.label}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {pending && (
              <div className="mt-5 pt-4 border-t flex items-center gap-2.5 flex-wrap" style={{ borderColor: 'var(--color-line)' }}>
                <PrimaryButton onClick={() => decide('approved')} disabled={!!deciding}>
                  {deciding === 'approved' ? 'Sending…' : 'Approve & send'}
                </PrimaryButton>
                <GhostButton tone="gold" onClick={() => decide('revisionRequested')} disabled={!!deciding}>
                  {deciding === 'revisionRequested' ? 'Sending…' : 'Request revision'}
                </GhostButton>
                <GhostButton tone="danger" onClick={() => decide('rejected')} disabled={!!deciding}>
                  {deciding === 'rejected' ? 'Sending…' : 'Reject'}
                </GhostButton>
              </div>
            )}
          </Band>
        </div>
      )}
    </Shell>
  )
}
