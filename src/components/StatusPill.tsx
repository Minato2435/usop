import type { SubmissionStatus } from '../types'
import { Icon, type IconName } from '../roles/primary-admin/shell/Icon'

// Single source of truth for how a SubmissionStatus renders — was defined
// three times over (Student, Faculty, and now HOD each had their own
// identical copy) as the Student/Faculty/HOD panels were built one at a
// time. Consolidated here once HOD needed the exact same mapping a third
// time; every role's shell/ui.tsx re-exports from this file instead of
// keeping its own copy.
const STATUS_META: Record<SubmissionStatus, { label: string; tone: 'gold' | 'teal' | 'clay' | 'neutral'; icon: IconName }> = {
  draft: { label: 'Draft', tone: 'neutral', icon: 'edit' },
  submitted: { label: 'Submitted', tone: 'gold', icon: 'inbox' },
  approved: { label: 'Approved', tone: 'teal', icon: 'checkCircle' },
  revisionRequested: { label: 'Revision requested', tone: 'clay', icon: 'flag' },
  rejected: { label: 'Rejected', tone: 'clay', icon: 'close' },
}

const TONE_COLOR: Record<'gold' | 'teal' | 'clay' | 'neutral', string> = {
  gold: 'var(--color-gold)',
  teal: 'var(--color-teal)',
  clay: 'var(--color-clay)',
  neutral: 'var(--color-char-soft)',
}
const TONE_BG: Record<'gold' | 'teal' | 'clay' | 'neutral', string> = {
  gold: 'var(--color-gold-soft)',
  teal: 'var(--color-teal-soft)',
  clay: 'var(--color-clay-soft)',
  neutral: 'color-mix(in srgb, var(--color-char-soft) 14%, transparent)',
}

// `resubmitted` — Submission.resubmittedAfterRevision — is a pure display
// override: a resubmitted item's real `status` goes straight back to
// 'submitted' (so it still re-enters every existing pending-queue filter/
// count unchanged), but a reviewer seeing a plain "Submitted" pill has no
// way to tell "first time" apart from "already came back once, just
// fixed" at a glance. While it's true, this renders the exact same
// Revision Requested look `status === 'revisionRequested'` gets, even
// though the underlying status is 'submitted' — right up until the next
// faculty/HOD decision clears the flag.
export function StatusPill({ status, resubmitted = false }: { status: SubmissionStatus; resubmitted?: boolean }) {
  const meta = status === 'submitted' && resubmitted ? STATUS_META.revisionRequested : STATUS_META[status]
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium"
      style={{ color: TONE_COLOR[meta.tone], backgroundColor: TONE_BG[meta.tone] }}
    >
      <Icon name={meta.icon} className="h-3 w-3" />
      {meta.label}
    </span>
  )
}

export function statusRailColor(status: SubmissionStatus): string {
  return TONE_COLOR[STATUS_META[status].tone]
}
