import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon, type IconName } from './Icon'
import { useCountUp } from './useCountUp'

export function StatTile({
  icon,
  label,
  value,
  sublabel,
  loading,
}: {
  icon: IconName
  label: string
  value: number
  sublabel?: string
  loading?: boolean
}) {
  const shown = useCountUp(value)
  return (
    // Same rounded-box + tinted-ground + hover-lift recipe as the
    // Departments/Users page cards, not the chamfer motif — stat tiles read
    // as data cards, not primary chrome, so they take the "content card"
    // shape instead.
    <div
      className="fade-up group relative rounded-[10px] border p-5 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-14px_rgba(11,18,32,0.35)] hover:border-[var(--color-gold-line)]"
      style={{
        backgroundColor: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)',
        borderColor: 'var(--color-line)',
      }}
    >
      <div className="flex items-center gap-2.5 mb-4">
        <div
          className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center"
          style={{ backgroundColor: 'var(--color-gold-soft)', color: 'var(--color-gold)' }}
        >
          <Icon name={icon} className="h-[15px] w-[15px]" />
        </div>
        <div className="text-[11.5px] leading-tight" style={{ color: 'var(--color-char-soft)' }}>
          {label}
        </div>
      </div>
      {loading ? (
        <div className="shimmer h-9 w-16 rounded-[4px]" />
      ) : (
        <div className="font-display text-[32px] leading-none tabular-nums" style={{ color: 'var(--color-char)' }}>
          {shown}
        </div>
      )}
      {sublabel && (
        <div className="mt-1.5 font-mono text-[10.5px]" style={{ color: 'var(--color-gold)' }}>
          {sublabel}
        </div>
      )}
    </div>
  )
}

export function Card({
  children,
  className = '',
  elevated = false,
}: {
  children: ReactNode
  className?: string
  // Opt-in: the rounded-box, tinted-ground, soft-shadow treatment shared
  // with Departments/Users page cards, instead of the plain sharp-cornered
  // white panel every other Card caller still gets by default.
  elevated?: boolean
}) {
  return (
    <div
      className={`border p-5 ${elevated ? 'rounded-[10px]' : ''} ${className}`}
      style={{
        backgroundColor: elevated
          ? 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)'
          : 'var(--color-paper-raised)',
        borderColor: 'var(--color-line)',
        boxShadow: elevated ? '0 10px 24px -18px rgba(11,18,32,0.22)' : undefined,
      }}
    >
      {children}
    </div>
  )
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] mb-3" style={{ color: 'var(--color-char-soft)' }}>
      {children}
    </div>
  )
}

export function PrimaryButton({
  children,
  onClick,
  type = 'button',
  disabled,
}: {
  children: ReactNode
  onClick?: () => void
  type?: 'button' | 'submit'
  disabled?: boolean
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="chamfer-sm inline-flex items-center gap-2 px-4 py-2 text-[13px] font-medium transition-transform duration-150 hover:-translate-y-[1px] disabled:opacity-50 disabled:pointer-events-none"
      style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-frost)' }}
    >
      {children}
    </button>
  )
}

export function GhostButton({
  children,
  onClick,
  tone = 'default',
  disabled,
}: {
  children: ReactNode
  onClick?: () => void
  // 'gold' added for the Faculty review flow's "Request revision" action —
  // additive, every existing caller passing 'default'/'danger' (or nothing)
  // is untouched.
  tone?: 'default' | 'danger' | 'gold'
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-medium border transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none"
      style={{
        borderColor: tone === 'danger' ? 'var(--color-clay)' : tone === 'gold' ? 'var(--color-gold-line)' : 'var(--color-line)',
        color: tone === 'danger' ? 'var(--color-clay)' : tone === 'gold' ? 'var(--color-gold)' : 'var(--color-char)',
        backgroundColor: 'transparent',
      }}
    >
      {children}
    </button>
  )
}

export function Badge({ tone, children }: { tone: 'gold' | 'teal' | 'clay' | 'neutral'; children: ReactNode }) {
  const map: Record<string, [string, string]> = {
    gold: ['var(--color-gold-soft)', 'var(--color-gold)'],
    teal: ['var(--color-teal-soft)', 'var(--color-teal)'],
    clay: ['var(--color-clay-soft)', 'var(--color-clay)'],
    neutral: ['var(--color-line)', 'var(--color-char-soft)'],
  }
  const [bg, fg] = map[tone]
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em]"
      style={{ backgroundColor: bg, color: fg }}
    >
      {children}
    </span>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`shimmer ${className}`} />
}

export function Modal({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string
  onClose: () => void
  children: ReactNode
  // Opt-in: a taller max-width + scrollable body for forms with too many
  // fields to fit the default max-w-md comfortably (e.g. the New User
  // form). Existing callers are unaffected.
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Rendered into <body>, not in place: a modal opened from the topbar (e.g. a
  // page's `actions` slot) would otherwise sit inside the header's
  // backdrop-filter, which makes `position: fixed` relative to the header
  // instead of the viewport — the popup got clipped to the top bar.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'color-mix(in srgb, var(--color-ink) 55%, transparent)' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        className={`chamfer w-full p-6 fade-up max-h-[90vh] overflow-y-auto ${wide ? 'max-w-2xl' : 'max-w-md'}`}
        style={{ backgroundColor: 'var(--color-paper-raised)' }}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-[19px]" style={{ color: 'var(--color-char)' }}>
            {title}
          </h2>
          <button onClick={onClose} className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
            Esc
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block mb-4">
      <span className="font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
        {label}
      </span>
      {children}
    </label>
  )
}

export const inputClass =
  'w-full px-3 py-2 text-[13.5px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]'

// Consistent "not yet built" state for modules that genuinely don't have a
// backend yet (per CLAUDE.md's phase status) — honest instead of faking data
// or a dead button.
export function RoadmapPanel({
  moduleTag,
  icon,
  title,
  description,
  phase,
}: {
  moduleTag: string
  icon: IconName
  title: string
  description: string
  phase: string
}) {
  return (
    <Card className="chamfer max-w-2xl">
      <div className="flex items-start gap-4">
        <div
          className="h-11 w-11 shrink-0 flex items-center justify-center"
          style={{ backgroundColor: 'var(--color-gold-soft)', color: 'var(--color-gold)' }}
        >
          <Icon name={icon} className="h-5 w-5" />
        </div>
        <div>
          <div className="font-mono text-[10.5px] tracking-[0.1em] mb-1" style={{ color: 'var(--color-gold)' }}>
            {moduleTag}
          </div>
          <h3 className="font-display text-[20px] mb-2" style={{ color: 'var(--color-char)' }}>
            {title}
          </h3>
          <p className="text-[13.5px] leading-relaxed mb-3" style={{ color: 'var(--color-char-soft)' }}>
            {description}
          </p>
          <Badge tone="neutral">{phase}</Badge>
        </div>
      </div>
    </Card>
  )
}
