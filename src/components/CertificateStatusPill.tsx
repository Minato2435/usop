import type { CertificateRequestStatus } from '../types'
import { Icon, type IconName } from '../roles/primary-admin/shell/Icon'

// Same consolidation reasoning as StatusPill.tsx (components/StatusPill.tsx)
// — one mapping, re-exported from every relevant role's shell/ui.tsx
// (Primary Admin, Skill Lab Director, Student) rather than duplicated.
const STATUS_META: Record<CertificateRequestStatus, { label: string; tone: 'gold' | 'teal' | 'clay' | 'neutral'; icon: IconName }> = {
  pending: { label: 'Pending', tone: 'gold', icon: 'inbox' },
  issued: { label: 'Issued', tone: 'teal', icon: 'checkCircle' },
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

export function CertificateStatusPill({ status }: { status: CertificateRequestStatus }) {
  const meta = STATUS_META[status]
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

// A single approver's own decision — shown read-only inside the review
// page's "other approver" card. 'pending' reads neutral rather than gold
// here (gold is reserved for the overall request's own "awaiting review"
// state above), since this is one half of a dual review, not the whole
// story on its own.
const DECISION_META: Record<'pending' | 'approved' | 'rejected', { label: string; tone: 'teal' | 'clay' | 'neutral'; icon: IconName }> = {
  pending: { label: 'Pending', tone: 'neutral', icon: 'clock' },
  approved: { label: 'Approved', tone: 'teal', icon: 'checkCircle' },
  rejected: { label: 'Rejected', tone: 'clay', icon: 'close' },
}

export function CertificateDecisionPill({ decision }: { decision: 'pending' | 'approved' | 'rejected' }) {
  const meta = DECISION_META[decision]
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
