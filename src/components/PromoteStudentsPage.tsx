import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { useAuth } from '../auth/AuthContext'
import { Card, GhostButton, PrimaryButton, Skeleton, inputClass } from '../roles/primary-admin/shell/ui'
import { Icon } from '../roles/primary-admin/shell/Icon'
import { promoteStudents, undoPromotion, watchInstitutionUsers } from '../lib/firestore/users'
import { watchInstitutionSubmissions } from '../lib/firestore/submissions'
import { watchInstitutions } from '../lib/firestore/institutions'
import type { AppUser, Institution, MbbsYear, Submission } from '../types'

// "Promote students": moves a college's students from one MBBS year to the
// next in one action. Shared by Institution Admin (locked to their own
// college) and Primary Admin (picks a college). Nothing about the
// students' activities changes — each activity keeps the year it was
// logged in, so Year N work stays with Year N reviewers and in the
// student's Year N history. Every promotion is recorded on the student
// (yearHistory) and can be undone as a batch.

type ShellProps = { eyebrow?: string; title: string; actions?: ReactNode; children: ReactNode }

const BORDER = 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)'
const FROM_YEARS: MbbsYear[] = [1, 2, 3]
const OPEN: Submission['status'][] = ['submitted', 'revisionRequested', 'draft']

function StepHeader({ n, title, hint }: { n: string; title: string; hint?: string }) {
  return (
    <div className="mb-4">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em]" style={{ color: 'var(--color-gold)' }}>
        Step {n}
      </div>
      <h2 className="font-display text-[21px] leading-tight mt-0.5" style={{ color: 'var(--color-char)' }}>
        {title}
      </h2>
      {hint && (
        <p className="text-[12.5px] mt-1" style={{ color: 'var(--color-char-soft)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}

function Section({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-[12px] border p-5 md:p-6 mb-5" style={{ borderColor: BORDER, backgroundColor: 'var(--color-paper)' }}>
      {children}
    </section>
  )
}

function fmtDateTime(ms: number) {
  return new Date(ms).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function PromoteStudentsPage({ Shell, lockedInstitutionId }: { Shell: ComponentType<ShellProps>; lockedInstitutionId?: string | null }) {
  const { appUser } = useAuth()
  const locked = lockedInstitutionId !== undefined

  // --- college ---------------------------------------------------------------
  const [institutions, setInstitutions] = useState<Institution[]>([])
  useEffect(() => {
    if (locked) return
    return watchInstitutions((list) => setInstitutions([...list].sort((a, b) => a.name.localeCompare(b.name))))
  }, [locked])
  const [pickedCollege, setPickedCollege] = useState('')
  const collegeId = locked ? (lockedInstitutionId ?? '') : pickedCollege

  // --- students + their activities in this college ------------------------------
  const [users, setUsers] = useState<AppUser[] | null>(null)
  useEffect(() => {
    setUsers(null)
    if (!collegeId) return
    return watchInstitutionUsers(collegeId, setUsers)
  }, [collegeId])

  const [submissions, setSubmissions] = useState<Submission[] | null>(null)
  const [submissionsError, setSubmissionsError] = useState(false)
  useEffect(() => {
    setSubmissions(null)
    setSubmissionsError(false)
    if (!collegeId) return
    return watchInstitutionSubmissions(collegeId, setSubmissions, () => setSubmissionsError(true))
  }, [collegeId])

  const [fromYear, setFromYear] = useState<MbbsYear>(1)
  const toYear = (fromYear + 1) as MbbsYear

  const candidates = useMemo(
    () =>
      (users ?? [])
        .filter((u) => u.role === 'student' && u.mbbsYear === fromYear)
        .sort((a, b) => (a.rollNumber ?? a.name).localeCompare(b.rollNumber ?? b.name, undefined, { numeric: true })),
    [users, fromYear],
  )

  // Open Year-N work per student (waiting for review / sent back / draft).
  const openWork = useMemo(() => {
    const map = new Map<string, { submitted: number; revisionRequested: number; draft: number }>()
    for (const s of submissions ?? []) {
      if (s.mbbsYear !== fromYear || !OPEN.includes(s.status)) continue
      const row = map.get(s.studentId) ?? { submitted: 0, revisionRequested: 0, draft: 0 }
      row[s.status as 'submitted' | 'revisionRequested' | 'draft']++
      map.set(s.studentId, row)
    }
    return map
  }, [submissions, fromYear])

  // --- selection ---------------------------------------------------------------
  // Everyone is ticked when a college + year is first loaded; the admin
  // unticks anyone who isn't moving up. Later roster changes (e.g. right
  // after a promotion) never re-tick people the admin left out.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const initKey = useRef('')
  useEffect(() => {
    if (users === null) return
    const key = `${collegeId}:${fromYear}`
    if (initKey.current !== key) {
      initKey.current = key
      setSelected(new Set(candidates.map((c) => c.uid)))
      return
    }
    setSelected((prev) => {
      const ids = new Set(candidates.map((c) => c.uid))
      const next = new Set([...prev].filter((id) => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [users, candidates, collegeId, fromYear])

  const [search, setSearch] = useState('')
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return candidates
    return candidates.filter((c) => c.name.toLowerCase().includes(term) || (c.rollNumber ?? '').toLowerCase().includes(term) || c.email.toLowerCase().includes(term))
  }, [candidates, search])

  function toggle(uid: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
  }

  const chosen = candidates.filter((c) => selected.has(c.uid))
  const heldBack = candidates.length - chosen.length
  const openTotals = chosen.reduce(
    (acc, c) => {
      const w = openWork.get(c.uid)
      if (w) {
        acc.submitted += w.submitted
        acc.revisionRequested += w.revisionRequested
        acc.draft += w.draft
      }
      return acc
    },
    { submitted: 0, revisionRequested: 0, draft: 0 },
  )
  const openSum = openTotals.submitted + openTotals.revisionRequested + openTotals.draft

  // --- promote -------------------------------------------------------------------
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  useEffect(() => setConfirming(false), [collegeId, fromYear, selected])

  async function handlePromote() {
    if (!appUser || chosen.length === 0) return
    setBusy(true)
    setMessage(null)
    try {
      await promoteStudents(chosen, fromYear, toYear, { uid: appUser.uid, name: appUser.name })
      setMessage({ tone: 'ok', text: `${chosen.length} student${chosen.length === 1 ? '' : 's'} moved to Year ${toYear}.` })
      setSearch('')
    } catch (e) {
      console.error('Promotion failed', e)
      setMessage({ tone: 'error', text: 'Couldn’t promote the students — nothing was changed for the ones that failed. Please try again.' })
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  // --- history + undo --------------------------------------------------------------
  const batches = useMemo(() => {
    const map = new Map<string, { batchId: string; from: MbbsYear; to: MbbsYear; at: number; byName: string; count: number; undoable: number }>()
    for (const u of users ?? []) {
      if (u.role !== 'student') continue
      const history = u.yearHistory ?? []
      history.forEach((h, i) => {
        const row = map.get(h.batchId) ?? { batchId: h.batchId, from: h.from, to: h.to, at: h.at, byName: h.byName, count: 0, undoable: 0 }
        row.count++
        if (i === history.length - 1 && u.mbbsYear === h.to) row.undoable++
        map.set(h.batchId, row)
      })
    }
    return [...map.values()].sort((a, b) => b.at - a.at).slice(0, 8)
  }, [users])

  const [undoTarget, setUndoTarget] = useState<string | null>(null)
  async function handleUndo(batchId: string) {
    if (!users) return
    setBusy(true)
    setMessage(null)
    try {
      const n = await undoPromotion(users, batchId)
      setMessage({ tone: 'ok', text: `${n} student${n === 1 ? '' : 's'} moved back.` })
    } catch (e) {
      console.error('Undo failed', e)
      setMessage({ tone: 'error', text: 'Couldn’t undo the promotion — please try again.' })
    } finally {
      setBusy(false)
      setUndoTarget(null)
    }
  }

  const collegeName = locked ? null : institutions.find((i) => i.id === collegeId)?.name

  return (
    <Shell eyebrow={collegeName ?? 'Academic year'} title="Promote students">
      <div className="max-w-3xl mx-auto">
        <p className="text-[13.5px] mb-6" style={{ color: 'var(--color-char-soft)' }}>
          Move students up to the next MBBS year once they have passed. Their activities stay exactly as they are: each one keeps the year it was logged in, stays
          with that year’s reviewers, and remains visible in the student’s My Activity and My Portfolio.
        </p>

        {message && (
          <div
            className="mb-5 rounded-[10px] border px-4 py-3 text-[13px] flex items-center gap-2.5"
            style={{
              borderColor: message.tone === 'ok' ? 'var(--color-teal)' : 'var(--color-clay)',
              color: message.tone === 'ok' ? 'var(--color-teal)' : 'var(--color-clay)',
              backgroundColor: 'var(--color-paper-raised)',
            }}
          >
            <Icon name={message.tone === 'ok' ? 'checkCircle' : 'flag'} className="h-4 w-4 shrink-0" />
            {message.text}
          </div>
        )}

        <Section>
          <StepHeader n="01" title="Which students?" hint="Final-year (Year 4) students don’t move up a year, so only Years 1–3 are listed." />
          <div className="grid gap-4 sm:grid-cols-2">
            {!locked && (
              <label className="block sm:col-span-2">
                <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] mb-1.5" style={{ color: 'var(--color-char-soft)' }}>
                  College
                </span>
                <select
                  className={inputClass}
                  style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)', backgroundColor: 'var(--color-paper-raised)' }}
                  value={pickedCollege}
                  onChange={(e) => setPickedCollege(e.target.value)}
                >
                  <option value="">Choose a college…</option>
                  {institutions.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="sm:col-span-2">
              <span className="block text-[11px] font-semibold uppercase tracking-[0.08em] mb-1.5" style={{ color: 'var(--color-char-soft)' }}>
                Move from
              </span>
              <div className="flex flex-wrap gap-2">
                {FROM_YEARS.map((y) => {
                  const active = fromYear === y
                  return (
                    <button
                      key={y}
                      onClick={() => setFromYear(y)}
                      className="flex items-center gap-2 rounded-[10px] border px-4 py-2.5 text-[13px] font-medium transition-colors"
                      style={{
                        borderColor: active ? 'var(--color-gold)' : 'var(--color-line)',
                        backgroundColor: active ? 'color-mix(in srgb, var(--color-gold) 8%, var(--color-paper-raised) 92%)' : 'var(--color-paper-raised)',
                        color: 'var(--color-char)',
                      }}
                    >
                      Year {y}
                      <Icon name="arrowLeft" className="h-3.5 w-3.5 rotate-180" style={{ color: 'var(--color-char-soft)' }} />
                      Year {y + 1}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </Section>

        <Section>
          <StepHeader
            n="02"
            title={`Year ${fromYear} students`}
            hint="Everyone is ticked. Untick anyone who isn’t moving up (for example, a student who has to repeat the year)."
          />
          {!collegeId ? (
            <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
              Choose a college first.
            </p>
          ) : users === null ? (
            <div className="space-y-2">
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
              <Skeleton className="h-10" />
            </div>
          ) : candidates.length === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
              There are no Year {fromYear} students in this college.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <div className="relative flex-1 min-w-[200px]">
                  <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: 'var(--color-char-soft)' }} />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name, register no. or email"
                    className={`${inputClass} pl-8`}
                    style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)', backgroundColor: 'var(--color-paper-raised)' }}
                  />
                </div>
                <GhostButton onClick={() => setSelected(new Set(candidates.map((c) => c.uid)))}>Select all</GhostButton>
                <GhostButton onClick={() => setSelected(new Set())}>Clear all</GhostButton>
              </div>
              <div className="text-[12px] mb-2" style={{ color: 'var(--color-char-soft)' }}>
                <strong style={{ color: 'var(--color-char)' }}>{chosen.length}</strong> of {candidates.length} selected
                {heldBack > 0 && ` · ${heldBack} staying in Year ${fromYear}`}
              </div>
              <div className="rounded-[10px] border max-h-[420px] overflow-y-auto" style={{ borderColor: BORDER, backgroundColor: 'var(--color-paper-raised)' }}>
                {shown.length === 0 ? (
                  <p className="px-4 py-6 text-center text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
                    Nobody matches “{search}”.
                  </p>
                ) : (
                  shown.map((c) => {
                    const w = openWork.get(c.uid)
                    const open = w ? w.submitted + w.revisionRequested + w.draft : 0
                    const on = selected.has(c.uid)
                    return (
                      <label
                        key={c.uid}
                        className="flex items-center gap-3 px-4 py-2.5 border-b last:border-0 cursor-pointer hover:bg-black/[0.02]"
                        style={{ borderColor: 'var(--color-line)' }}
                      >
                        <input type="checkbox" checked={on} onChange={() => toggle(c.uid)} className="h-4 w-4 accent-[var(--color-gold)]" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13.5px] truncate" style={{ color: 'var(--color-char)' }}>
                            {c.name}
                          </span>
                          <span className="block font-mono text-[11px] truncate" style={{ color: 'var(--color-char-soft)' }}>
                            {[c.rollNumber, c.email].filter(Boolean).join(' · ')}
                          </span>
                        </span>
                        {open > 0 && (
                          <span className="shrink-0 text-[11.5px]" style={{ color: 'var(--color-gold)' }}>
                            {open} open
                          </span>
                        )}
                        {!on && (
                          <span className="shrink-0 text-[11px] font-medium" style={{ color: 'var(--color-clay)' }}>
                            Stays in Year {fromYear}
                          </span>
                        )}
                      </label>
                    )
                  })
                )}
              </div>
            </>
          )}
        </Section>

        <Section>
          <StepHeader n="03" title="Confirm" />
          {chosen.length === 0 ? (
            <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
              Select at least one student to promote.
            </p>
          ) : (
            <>
              <p className="text-[14px] mb-3" style={{ color: 'var(--color-char)' }}>
                <strong>{chosen.length}</strong> student{chosen.length === 1 ? '' : 's'} will move from <strong>Year {fromYear}</strong> to <strong>Year {toYear}</strong>
                {heldBack > 0 ? `, and ${heldBack} will stay in Year ${fromYear}.` : '.'}
              </p>
              {submissionsError ? (
                <p className="text-[12.5px] mb-4" style={{ color: 'var(--color-char-soft)' }}>
                  Couldn’t check for unfinished activities (no access yet). Promoting is still safe: unfinished work stays with its Year {fromYear} reviewers.
                </p>
              ) : openSum > 0 ? (
                <div
                  className="rounded-[10px] border px-4 py-3 mb-4 text-[13px]"
                  style={{ borderColor: 'var(--color-gold-line)', backgroundColor: 'var(--color-gold-soft)', color: 'var(--color-char)' }}
                >
                  <strong>
                    {openSum} Year {fromYear} activit{openSum === 1 ? 'y is' : 'ies are'} still open
                  </strong>{' '}
                  ({openTotals.submitted} waiting for review · {openTotals.revisionRequested} sent back for revision · {openTotals.draft} drafts). That’s fine:
                  they stay with the Year {fromYear} faculty and HOD, who can still review them, and students can still finish and resubmit them.
                </div>
              ) : submissions !== null ? (
                <p className="text-[12.5px] mb-4" style={{ color: 'var(--color-teal)' }}>
                  No unfinished Year {fromYear} activities for these students.
                </p>
              ) : null}
              <ul className="text-[12.5px] mb-5 space-y-1 list-disc pl-5" style={{ color: 'var(--color-char-soft)' }}>
                <li>New activities they log will use their Year {toYear} departments and skills.</li>
                <li>Their Year {fromYear} activities and certificates stay visible to them, by year.</li>
                <li>You can undo this from “Recent promotions” below.</li>
              </ul>
              {confirming ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] mr-1" style={{ color: 'var(--color-char)' }}>
                    Promote {chosen.length} student{chosen.length === 1 ? '' : 's'} to Year {toYear}?
                  </span>
                  <PrimaryButton onClick={handlePromote} disabled={busy}>
                    {busy ? 'Promoting…' : 'Yes, promote'}
                  </PrimaryButton>
                  <GhostButton onClick={() => setConfirming(false)} disabled={busy}>
                    Cancel
                  </GhostButton>
                </div>
              ) : (
                <PrimaryButton onClick={() => setConfirming(true)} disabled={busy}>
                  <Icon name="promote" className="h-4 w-4" />
                  Promote {chosen.length} to Year {toYear}
                </PrimaryButton>
              )}
            </>
          )}
        </Section>

        {collegeId && batches.length > 0 && (
          <Card elevated className="mb-10">
            <div className="flex items-center gap-2 mb-3">
              <Icon name="clock" className="h-4 w-4" style={{ color: 'var(--color-gold)' }} />
              <h3 className="font-display text-[18px]" style={{ color: 'var(--color-char)' }}>
                Recent promotions
              </h3>
            </div>
            <div className="flex flex-col">
              {batches.map((b) => (
                <div key={b.batchId} className="flex flex-wrap items-center gap-3 py-3 border-t first:border-t-0" style={{ borderColor: 'var(--color-line)' }}>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px]" style={{ color: 'var(--color-char)' }}>
                      Year {b.from} → Year {b.to} · {b.count} student{b.count === 1 ? '' : 's'}
                    </div>
                    <div className="text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
                      {fmtDateTime(b.at)} · by {b.byName}
                      {b.undoable < b.count && b.undoable > 0 && ` · ${b.count - b.undoable} already moved again`}
                    </div>
                  </div>
                  {b.undoable === 0 ? (
                    <span className="text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
                      Can’t be undone (students have moved since)
                    </span>
                  ) : undoTarget === b.batchId ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[12px]" style={{ color: 'var(--color-char)' }}>
                        Move {b.undoable} back to Year {b.from}?
                      </span>
                      <GhostButton tone="danger" onClick={() => handleUndo(b.batchId)} disabled={busy}>
                        {busy ? 'Undoing…' : 'Yes, undo'}
                      </GhostButton>
                      <GhostButton onClick={() => setUndoTarget(null)} disabled={busy}>
                        Cancel
                      </GhostButton>
                    </div>
                  ) : (
                    <GhostButton onClick={() => setUndoTarget(b.batchId)} disabled={busy}>
                      <Icon name="undo" className="h-3.5 w-3.5" />
                      Undo
                    </GhostButton>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </Shell>
  )
}
