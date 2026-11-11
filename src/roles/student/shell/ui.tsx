import { useCountUp } from '../../primary-admin/shell/useCountUp'

// Same interface configuration as the admin panels — reuse their exact
// primitives rather than a parallel Student-only kit, per the explicit
// direction to follow the Primary/Institution Admin design system here.
export { Card, StatTile, SectionLabel, PrimaryButton, GhostButton, Badge, Skeleton, Modal, Field, inputClass } from '../../primary-admin/shell/ui'
// StatusPill/statusRailColor used to be defined locally here (and,
// separately, in Faculty's and HOD's own shell/ui.tsx) — consolidated into
// one shared definition once three roles needed the exact same
// SubmissionStatus→color/icon mapping.
export { StatusPill, statusRailColor } from '../../../components/StatusPill'
export { CertificateStatusPill } from '../../../components/CertificateStatusPill'

export function ProgressRing({ value, size = 64, strokeWidth = 6 }: { value: number; size?: number; strokeWidth?: number }) {
  const animated = useCountUp(Math.round(value))
  const r = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - animated / 100)
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={strokeWidth} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-gold)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.7s cubic-bezier(0.16,1,0.3,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center font-display text-[15px]" style={{ color: 'var(--color-char)' }}>
        {animated}%
      </div>
    </div>
  )
}
