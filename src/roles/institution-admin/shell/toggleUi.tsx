import type { ReactNode } from 'react'
import { PrimaryButton } from '../../primary-admin/shell/ui'
import { ToggleSwitch } from '../../primary-admin/shell/VideoShared'

export const ROW_DIVIDER = '1px solid color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)'

// Appears whenever a toggle section has unsaved changes queued locally —
// nothing writes to Firestore until "Save changes" is clicked. Same
// draft-then-save pattern as the Primary Admin Institution Management
// portal's Departments/SSL Logs/Competencies/Videos tabs.
export function SaveChangesBar({
  pendingCount,
  saving,
  onSave,
  onDiscard,
}: {
  pendingCount: number
  saving: boolean
  onSave: () => void
  onDiscard: () => void
}) {
  if (pendingCount === 0) return null
  return (
    <div
      className="fade-up flex items-center gap-3 rounded-[8px] px-4 py-3 mb-4"
      style={{ backgroundColor: 'color-mix(in srgb, var(--color-gold) 10%, transparent)', border: '1px solid var(--color-gold-line)' }}
    >
      <span className="text-[12.5px] font-medium" style={{ color: 'var(--color-char)' }}>
        {pendingCount} unsaved change{pendingCount === 1 ? '' : 's'}
      </span>
      <div className="flex-1" />
      <button
        onClick={onDiscard}
        disabled={saving}
        className="text-[12.5px] font-medium hover:opacity-70 transition-opacity disabled:opacity-50"
        style={{ color: 'var(--color-char-soft)' }}
      >
        Discard
      </button>
      <PrimaryButton onClick={onSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save changes'}
      </PrimaryButton>
    </div>
  )
}

// One row in a toggle list — a title, optional description, the toggle
// itself, and a right-side slot for whatever context that content type
// needs (a competency count, an "Excluded" label, a delete button, ...).
export function ToggleRow({
  title,
  description,
  enabled,
  onToggle,
  right,
  isLast,
}: {
  title: string
  description?: string
  enabled: boolean
  onToggle: () => void
  right?: ReactNode
  isLast: boolean
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3" style={{ borderBottom: isLast ? undefined : ROW_DIVIDER }}>
      <ToggleSwitch on={enabled} onChange={onToggle} label={enabled ? 'Included — click to exclude' : 'Excluded — click to include'} />
      <div className="min-w-0 flex-1">
        <div
          className="font-display text-[16px] leading-snug truncate"
          style={{ color: enabled ? 'var(--color-char)' : 'var(--color-char-soft)' }}
        >
          {title}
        </div>
        {description && (
          <div className="text-[11.5px] mt-0.5 truncate" style={{ color: 'var(--color-char-soft)' }}>
            {description}
          </div>
        )}
      </div>
      {right}
    </div>
  )
}

export function SubTabBar<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (v: T) => void
  options: { v: T; label: string }[]
}) {
  return (
    <div className="inline-flex border rounded-[6px] overflow-hidden mb-6" style={{ borderColor: 'var(--color-line)' }}>
      {options.map((o, i) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className="px-4 py-2 text-[12.5px] font-medium transition-colors"
          style={{
            borderLeft: i > 0 ? '1px solid var(--color-line)' : undefined,
            backgroundColor: value === o.v ? 'var(--color-ink)' : 'transparent',
            color: value === o.v ? 'var(--color-frost)' : 'var(--color-char-soft)',
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
