import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { StudentShell } from './shell/StudentShell'
import { Card, GhostButton, PrimaryButton, Skeleton, StatusPill } from './shell/ui'
import { Icon } from '../primary-admin/shell/Icon'
import { useCountUp } from '../primary-admin/shell/useCountUp'
import { DopsChecklistPreview } from '../primary-admin/DopsChecklistPreview'
import { AttachmentGallery } from '../../components/AttachmentGallery'
import { watchStudentSubmissions, deleteDraftSubmission } from '../../lib/firestore/submissions'
import { watchFormSchema } from '../../lib/firestore/formSchemas'
import { watchTemplate } from '../../lib/firestore/logTemplates'
import { getAppUser } from '../../lib/firestore/users'
import { sanitizeRichText } from '../../lib/sanitizeHtml'
import { ExportActivitiesButton } from './ExportActivities'
import type { CompetencyLevel, FormSchema, MbbsYear, Submission, SubmissionStatus } from '../../types'

// Adapted from the "My Activity.dc.html" design reference — its month-
// grouped, expand-in-place accordion of entries (date stamp, skill title,
// a breadcrumb-ish "trail", reviewer line, status chip) replaces this
// page's old shape (a flat list that navigated to a separate full-page
// detail view on click). Colors/fonts/shell/card tokens stay ours
// throughout — same "borrow the structure, keep our own system" treatment
// already applied to Departments.dc.html/Institution Management.html/
// New Activity.dc.html elsewhere in this app. The reference's static
// "steps observed / competence / supervision / complexity" figures and
// "self-rating" field don't correspond to anything in our data model
// (there's no student self-rating, and the real per-step scoring already
// lives in the DOPS checklist itself) — dropped in favor of what we
// actually have: the checklist (`DopsChecklistPreview mode="review"`),
// the attempt type badge, and real faculty feedback/remarks/rating.
const ATTEMPT_LABELS: Record<string, string> = { first: 'First attempt', repeat: 'Repeat attempt', remedial: 'Remedial attempt' }
const LEVEL_LABELS: Record<CompetencyLevel, string> = {
  O: 'Observed',
  A: 'Assisted',
  P: 'Performed under supervision',
  I: 'Independently performed',
}

function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
function formatDateTime(ms: number): string {
  const d = new Date(ms)
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
}
function dayMonth(iso: string): { day: string; mon: string } {
  const d = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(d.getTime())) return { day: '—', mon: '' }
  return { day: String(d.getDate()).padStart(2, '0'), mon: d.toLocaleDateString(undefined, { month: 'short' }) }
}
function monthKey(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return `${d.getFullYear()}-${d.getMonth()}`
}
function monthLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`)
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

const FILTERS: { key: SubmissionStatus | 'all'; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'submitted', label: 'Awaiting review' },
  { key: 'approved', label: 'Approved' },
  { key: 'revisionRequested', label: 'Revision requested' },
  { key: 'rejected', label: 'Rejected' },
]

export function StudentMyActivityPage() {
  const { appUser } = useAuth()
  const navigate = useNavigate()
  const [submissions, setSubmissions] = useState<Submission[] | null>(null)
  const [filter, setFilter] = useState<SubmissionStatus | 'all'>('all')
  // Year view: every year the student has activities in, plus their current
  // year. Opens on the current year once there is more than one; null =
  // not chosen yet (follow that default).
  const [yearChoice, setYearChoice] = useState<MbbsYear | 'all' | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    if (!appUser) return
    return watchStudentSubmissions(appUser.uid, setSubmissions)
  }, [appUser])

  // Faculty display names and log-template titles are resolved lazily and
  // cached by id — a submission only stores facultyId/templateId, and the
  // entry row + expanded panel both want the human-readable name/title.
  const [facultyNames, setFacultyNames] = useState<Record<string, string>>({})
  useEffect(() => {
    const ids = Array.from(new Set((submissions ?? []).map((s) => s.facultyId).filter(Boolean)))
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
  }, [submissions])

  const [templateTitles, setTemplateTitles] = useState<Record<string, string>>({})
  useEffect(() => {
    const ids = Array.from(new Set((submissions ?? []).map((s) => s.templateId)))
    const missing = ids.filter((id) => !(id in templateTitles))
    if (missing.length === 0) return
    const unsubs = missing.map((id) =>
      watchTemplate(id, (t) => {
        if (t) setTemplateTitles((prev) => ({ ...prev, [id]: t.title }))
      }),
    )
    return () => unsubs.forEach((u) => u())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submissions])

  const currentYear = appUser?.mbbsYear ?? null
  const years = useMemo(() => {
    const set = new Set<MbbsYear>((submissions ?? []).map((s) => s.mbbsYear).filter(Boolean))
    if (currentYear) set.add(currentYear)
    return [...set].sort((a, b) => a - b)
  }, [submissions, currentYear])
  const multiYear = years.length > 1
  const yearView: MbbsYear | 'all' = multiYear ? (yearChoice ?? currentYear ?? 'all') : 'all'
  const scoped = useMemo(() => (submissions ?? []).filter((s) => yearView === 'all' || s.mbbsYear === yearView), [submissions, yearView])

  const counts = useMemo(() => {
    const c: Record<SubmissionStatus | 'all', number> = { all: 0, draft: 0, submitted: 0, approved: 0, revisionRequested: 0, rejected: 0 }
    for (const s of scoped) {
      c.all++
      c[s.status]++
    }
    return c
  }, [scoped])

  const filtered = useMemo(() => scoped.filter((s) => filter === 'all' || s.status === filter), [scoped, filter])
  const groups = useMemo(() => {
    const sorted = [...filtered].sort((a, b) => (b.activityDate || '').localeCompare(a.activityDate || '') || b.updatedAt - a.updatedAt)
    const order: string[] = []
    const map = new Map<string, { label: string; items: Submission[] }>()
    for (const s of sorted) {
      const key = s.activityDate ? monthKey(s.activityDate) : 'undated'
      if (!map.has(key)) {
        map.set(key, { label: s.activityDate ? monthLabel(s.activityDate) : 'Undated', items: [] })
        order.push(key)
      }
      map.get(key)!.items.push(s)
    }
    return order.map((key) => map.get(key)!)
  }, [filtered])

  const openSubmission = (submissions ?? []).find((s) => s.id === openId) ?? null
  const [schema, setSchema] = useState<FormSchema | null | undefined>(undefined)
  useEffect(() => {
    if (!openSubmission) {
      setSchema(undefined)
      return
    }
    return watchFormSchema(openSubmission.formSchemaId, setSchema)
  }, [openSubmission?.formSchemaId])

  async function handleDelete(id: string) {
    const target = (submissions ?? []).find((x) => x.id === id)
    if (!target) return
    await deleteDraftSubmission(target)
    setConfirmDeleteId(null)
    if (openId === id) setOpenId(null)
  }

  const needsAction = counts.draft + counts.revisionRequested + counts.rejected

  return (
    <StudentShell
      eyebrow={appUser?.rollNumber ? `${appUser.rollNumber}${appUser.mbbsYear ? ` · Year ${appUser.mbbsYear}` : ''}` : 'Track your submissions'}
      title="My Activity"
      actions={
        <div className="flex items-center gap-2">
          <ExportActivitiesButton submissions={submissions} facultyNames={facultyNames} templateTitles={templateTitles} />
          <PrimaryButton onClick={() => navigate('/student/activities')}>+ New activity</PrimaryButton>
        </div>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6 -mt-2">
        <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
          Everything you have logged, and what your reviewers sent back.
        </p>
        {multiYear && (
          <div className="inline-flex rounded-full border p-0.5" style={{ borderColor: 'var(--color-line)', backgroundColor: 'var(--color-paper-raised)' }}>
            {[...years.map((y) => ({ key: y as MbbsYear | 'all', label: `Year ${y}${y === currentYear ? ' · now' : ''}` })), { key: 'all' as const, label: 'All years' }].map((opt) => {
              const active = yearView === opt.key
              return (
                <button
                  key={opt.key}
                  onClick={() => setYearChoice(opt.key)}
                  className="px-3 py-1.5 rounded-full text-[12px] font-medium transition-colors"
                  style={{ backgroundColor: active ? 'var(--color-ink)' : 'transparent', color: active ? 'var(--color-frost)' : 'var(--color-char-soft)' }}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div
        className="grid grid-cols-2 sm:grid-cols-4 border rounded-[6px] overflow-hidden mb-7 divide-x divide-y sm:divide-y-0 divide-[var(--color-line)]"
        style={{ borderColor: 'var(--color-line)' }}
      >
        <SummaryStat label="Activities logged" value={counts.all} color="var(--color-char)" loading={!submissions} />
        <SummaryStat label="Approved" value={counts.approved} color="var(--color-char)" loading={!submissions} />
        <SummaryStat label="Awaiting review" value={counts.submitted} color="var(--color-char)" loading={!submissions} />
        <SummaryStat label="Needs your action" value={needsAction} color="var(--color-gold)" loading={!submissions} />
      </div>

      <div className="flex items-center gap-1 mb-6 overflow-x-auto" style={{ borderBottom: '1px solid var(--color-line)' }}>
        {FILTERS.map((f) => {
          const active = filter === f.key
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="shrink-0 whitespace-nowrap px-3.5 py-2.5 text-[12.5px] font-medium border-b-2 transition-colors duration-150"
              style={{
                borderColor: active ? 'var(--color-gold)' : 'transparent',
                color: active ? 'var(--color-char)' : 'var(--color-char-soft)',
              }}
            >
              {f.label}
              <span className="ml-1.5 text-[11px] tabular-nums" style={{ color: 'var(--color-char-soft)' }}>
                {counts[f.key]}
              </span>
            </button>
          )
        })}
      </div>

      {!submissions ? (
        <div className="space-y-2.5">
          <Skeleton className="h-16 rounded-[14px]" />
          <Skeleton className="h-16 rounded-[14px]" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="text-center py-10">
          <p className="text-[13.5px] mb-1" style={{ color: 'var(--color-char)' }}>
            {submissions.length === 0 ? "You haven't logged any activities yet." : 'Nothing here yet'}
          </p>
          <p className="text-[12.5px]" style={{ color: 'var(--color-char-soft)' }}>
            {submissions.length === 0 ? "Start with a skill from your department's log." : 'No activities match this filter.'}
          </p>
          {submissions.length === 0 && (
            <button
              onClick={() => navigate('/student/activities')}
              className="inline-block mt-4 text-[12.5px] font-semibold"
              style={{ color: 'var(--color-gold)' }}
            >
              Browse your department's skills →
            </button>
          )}
        </Card>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((group) => (
            <section key={group.label}>
              <div className="flex items-baseline gap-3.5 mb-3">
                <span className="font-display text-[13px] font-semibold uppercase tracking-[0.06em]" style={{ color: 'var(--color-char)' }}>
                  {group.label}
                </span>
                <span className="flex-1 h-px" style={{ backgroundColor: 'var(--color-line)' }} />
                <span className="text-[11.5px] tabular-nums" style={{ color: 'var(--color-char-soft)' }}>
                  {group.items.length} {group.items.length === 1 ? 'entry' : 'entries'}
                </span>
              </div>

              <div className="flex flex-col gap-2.5">
                {group.items.map((s) => (
                  <EntryCard
                    key={s.id}
                    submission={s}
                    open={openId === s.id}
                    onToggle={() => setOpenId(openId === s.id ? null : s.id)}
                    facultyName={s.facultyId ? facultyNames[s.facultyId] : undefined}
                    templateTitle={templateTitles[s.templateId]}
                    schema={openId === s.id ? schema : undefined}
                    confirmDelete={confirmDeleteId === s.id}
                    onRequestDelete={() => setConfirmDeleteId(s.id)}
                    onCancelDelete={() => setConfirmDeleteId(null)}
                    onConfirmDelete={() => handleDelete(s.id)}
                    onEdit={() => navigate(`/student/activities?submissionId=${s.id}`)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </StudentShell>
  )
}

function EntryCard({
  submission: s,
  open,
  onToggle,
  facultyName,
  templateTitle,
  schema,
  confirmDelete,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onEdit,
}: {
  submission: Submission
  open: boolean
  onToggle: () => void
  facultyName?: string
  templateTitle?: string
  schema: FormSchema | null | undefined
  confirmDelete: boolean
  onRequestDelete: () => void
  onCancelDelete: () => void
  onConfirmDelete: () => void
  onEdit: () => void
}) {
  const [checklistOpen, setChecklistOpen] = useState(false)
  const { day, mon } = s.activityDate ? dayMonth(s.activityDate) : { day: '—', mon: '' }
  const reviewerLine =
    s.status === 'draft'
      ? 'Not sent yet'
      : s.status === 'submitted'
        ? `Sent to ${facultyName ?? '…'}`
        : `Reviewed by ${facultyName ?? '…'}`
  const isReviewed = s.status === 'approved' || s.status === 'rejected' || s.status === 'revisionRequested'
  const isActionable = s.status === 'draft' || s.status === 'revisionRequested'
  const pendingText =
    s.status === 'draft'
      ? 'This activity has not been sent. Finish the entry and choose a reviewer to submit it.'
      : `Waiting on ${facultyName ?? 'your reviewer'}. You'll be notified here as soon as it's reviewed.`

  return (
    <div
      className="fade-up rounded-[14px] border transition-all duration-200 ease-out"
      style={{
        backgroundColor: open
          ? 'color-mix(in srgb, var(--color-gold) 5%, var(--color-paper-raised) 95%)'
          : 'var(--color-paper-raised)',
        borderColor: open ? 'var(--color-gold-line)' : 'var(--color-line)',
        boxShadow: open ? '0 14px 30px -22px rgba(11,18,32,0.3)' : 'none',
      }}
    >
      <button onClick={onToggle} className="w-full text-left grid gap-4 px-5 py-4 items-center" style={{ gridTemplateColumns: '52px minmax(0,1fr) auto' }}>
        <div className="text-center pr-4" style={{ borderRight: '1px solid var(--color-line)' }}>
          <div className="font-display text-[20px] leading-none tabular-nums" style={{ color: 'var(--color-char)' }}>
            {day}
          </div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.06em] mt-1.5" style={{ color: 'var(--color-char-soft)' }}>
            {mon}
          </div>
        </div>

        <div className="min-w-0">
          <div className="font-display text-[16.5px] leading-snug truncate" style={{ color: 'var(--color-char)' }}>
            {s.nodeTitle}
          </div>
          {templateTitle && (
            <div className="text-[12px] mt-0.5 truncate" style={{ color: 'var(--color-char-soft)' }}>
              {templateTitle}
            </div>
          )}
          <div className="text-[11.5px] mt-1.5 flex items-center gap-1.5 flex-wrap" style={{ color: 'var(--color-char-soft)' }}>
            {reviewerLine}
            {s.attemptType && (
              <span className="px-1.5 py-[1px] rounded-full text-[10px] font-medium" style={{ backgroundColor: 'var(--color-gold-soft)', color: 'var(--color-gold)' }}>
                {ATTEMPT_LABELS[s.attemptType]}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3.5 pl-2 shrink-0">
          <StatusPill status={s.status} />
          <Icon
            name="chevron"
            className="h-4 w-4 transition-transform duration-200"
            style={{ color: 'var(--color-char-soft)', transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
        </div>
      </button>

      {open && (
        <div className="fade-up border-t px-5 py-5 flex flex-col gap-5" style={{ borderColor: 'var(--color-line)' }}>
          {isReviewed ? (
            <div
              className="rounded-[10px] p-4"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--color-gold) 7%, var(--color-paper-raised) 93%)',
                border: '1px solid var(--color-gold-line)',
              }}
            >
              <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
                <div>
                  <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em]" style={{ color: 'var(--color-char-soft)' }}>
                    Review
                  </div>
                  <div className="text-[12px] mt-1" style={{ color: 'var(--color-char-soft)' }}>
                    {facultyName ?? 'Your reviewer'}
                    {s.reviewedAt && ` · ${formatDateTime(s.reviewedAt)}`}
                  </div>
                </div>
                {(s.competencyLevel || s.facultyRating != null) && (
                  <div className="flex items-center gap-5">
                    {s.competencyLevel && (
                      <div>
                        <div className="font-display text-[15px]" style={{ color: 'var(--color-char)' }}>
                          {LEVEL_LABELS[s.competencyLevel]}
                        </div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
                          Competency
                        </div>
                      </div>
                    )}
                    {s.facultyRating != null && (
                      <div>
                        <div className="font-display text-[15px] tabular-nums" style={{ color: 'var(--color-char)' }}>
                          {s.facultyRating}/5
                        </div>
                        <div className="text-[10px] font-semibold uppercase tracking-[0.08em] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
                          Rating
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {(s.facultyFeedback || s.facultyRemarks) && (
                <div className="grid sm:grid-cols-2 gap-3">
                  {s.facultyFeedback && <FeedbackCard label="Feedback" text={s.facultyFeedback} />}
                  {s.facultyRemarks && <FeedbackCard label="Remarks" text={s.facultyRemarks} />}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-[10px] p-4 border" style={{ borderColor: 'var(--color-line)', backgroundColor: 'var(--color-paper)' }}>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] mb-1.5" style={{ color: 'var(--color-char-soft)' }}>
                Review
              </div>
              <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--color-char-soft)' }}>
                {pendingText}
              </p>
            </div>
          )}

          {isReviewed &&
            (schema === undefined ? (
              <Skeleton className="h-11 rounded-[10px]" />
            ) : schema ? (
              checklistOpen ? (
                <div>
                  <button
                    onClick={() => setChecklistOpen(false)}
                    className="text-[11.5px] font-medium mb-2 hover:opacity-70 transition-opacity"
                    style={{ color: 'var(--color-gold)' }}
                  >
                    Hide checklist
                  </button>
                  <div className="rounded-[10px] border" style={{ borderColor: 'var(--color-line)' }}>
                    <DopsChecklistPreview title={s.nodeTitle} fields={schema.fields} mode="review" value={s.answers} />
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setChecklistOpen(true)}
                  className="flex items-center gap-2.5 rounded-[10px] border px-4 py-3 text-left transition-colors hover:border-[var(--color-gold-line)]"
                  style={{ borderColor: 'var(--color-line)', backgroundColor: 'var(--color-paper)' }}
                >
                  <Icon name="checkCircle" className="h-4 w-4" style={{ color: 'var(--color-gold)' }} />
                  <span className="text-[12.5px] font-medium" style={{ color: 'var(--color-char)' }}>
                    View checklist
                  </span>
                </button>
              )
            ) : null)}

          {s.description && (
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] mb-2" style={{ color: 'var(--color-char-soft)' }}>
                Your entry
              </div>
              <div
                className="text-[13px] leading-relaxed"
                style={{ color: 'var(--color-char)' }}
                dangerouslySetInnerHTML={{ __html: sanitizeRichText(s.description) }}
              />
            </div>
          )}

          {s.images && s.images.length > 0 && (
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] mb-2" style={{ color: 'var(--color-char-soft)' }}>
                Attachments
              </div>
              <AttachmentGallery images={s.images} />
            </div>
          )}

          <div className="flex items-center justify-between gap-3 flex-wrap pt-1">
            <span className="text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
              {s.activityDate && `Performed ${formatDate(s.activityDate)}`}
              {s.submittedAt && ` · Submitted ${formatDateTime(s.submittedAt)}`}
            </span>
            {isActionable && (
              <div className="flex items-center gap-2">
                {s.status === 'draft' &&
                  (confirmDelete ? (
                    <>
                      <GhostButton tone="danger" onClick={onConfirmDelete}>
                        Confirm delete
                      </GhostButton>
                      <GhostButton onClick={onCancelDelete}>Cancel</GhostButton>
                    </>
                  ) : (
                    <GhostButton tone="danger" onClick={onRequestDelete}>
                      Delete draft
                    </GhostButton>
                  ))}
                <button
                  onClick={onEdit}
                  className="inline-flex items-center justify-center gap-2 rounded-[8px] px-3.5 py-2 text-[12.5px] font-semibold"
                  style={{ backgroundColor: 'var(--color-gold)', color: 'var(--color-frost)' }}
                >
                  {s.status === 'draft' ? 'Continue this draft' : 'Revise and resubmit'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// Not a bordered StatTile-per-cell — this matches the Primary Admin
// Departments/Log Templates pages' own stat-strip convention instead: one
// shared bordered container with internal divide-x/divide-y hairlines, a
// font-display text-[28px] numeral (gold reserved for the one headline
// stat, char for the rest) above a small uppercase label. Copied verbatim
// from DepartmentsPage.tsx/LogTemplatesPage.tsx's own inline cell markup
// (duplicated there too, not a shared component) rather than reinvented.
function SummaryStat({ label, value, color, loading }: { label: string; value: number; color: string; loading?: boolean }) {
  const shown = useCountUp(value)
  return (
    <div className="px-5 py-4">
      <div className="font-display text-[28px] leading-none tabular-nums" style={{ color: loading ? 'var(--color-char-soft)' : color }}>
        {loading ? '–' : shown}
      </div>
      <div className="mt-2 text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
        {label}
      </div>
    </div>
  )
}

function FeedbackCard({ label, text }: { label: string; text: string }) {
  return (
    <div className="rounded-[8px] border p-3.5" style={{ borderColor: 'var(--color-line)', backgroundColor: 'var(--color-paper)' }}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] mb-1.5" style={{ color: 'var(--color-gold)' }}>
        {label}
      </div>
      <p className="text-[12.5px] leading-relaxed" style={{ color: 'var(--color-char)' }}>
        {text}
      </p>
    </div>
  )
}
