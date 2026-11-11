import type { ReactNode } from 'react'

// Small shared pieces for the sign-in and registration pages (outside every
// role shell, so they don't use the admin ui kit).

export const inputCls =
  'w-full rounded-[8px] border px-3 py-2.5 text-[14px] outline-none transition-colors focus:border-[var(--color-gold)] disabled:opacity-60'
export const inputStyle = { borderColor: 'var(--color-line)', backgroundColor: 'var(--color-paper-raised)', color: 'var(--color-char)' }

export function AuthCard({ subtitle, wide, children }: { subtitle: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" style={{ backgroundColor: 'var(--color-paper)' }}>
      <div
        className={`w-full ${wide ? 'max-w-[560px]' : 'max-w-[400px]'} rounded-[14px] border p-7 sm:p-8 shadow-[0_24px_48px_-32px_rgba(11,18,32,0.45)]`}
        style={{ backgroundColor: 'var(--color-paper-raised)', borderColor: 'var(--color-line)' }}
      >
        <div className="flex items-center gap-3 mb-6">
          <div
            className="chamfer-sm h-10 w-10 flex items-center justify-center font-display text-[18px]"
            style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-gold)' }}
          >
            U
          </div>
          <div>
            <h1 className="font-display text-[22px] leading-tight" style={{ color: 'var(--color-char)' }}>
              USOP
            </h1>
            <p className="text-[12.5px]" style={{ color: 'var(--color-char-soft)' }}>
              {subtitle}
            </p>
          </div>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block font-display text-[14px] mb-1.5" style={{ color: 'var(--color-char)' }}>
        {label}
      </label>
      {children}
      {hint && (
        <p className="mt-1 text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}

export function MobileField({ value, onChange, disabled }: { value: string; onChange?: (v: string) => void; disabled?: boolean }) {
  return (
    <Field label="Mobile number" htmlFor="mobile">
      <div
        className="flex rounded-[8px] border overflow-hidden focus-within:border-[var(--color-gold)]"
        style={{ borderColor: 'var(--color-line)', opacity: disabled ? 0.7 : 1 }}
      >
        <span
          className="px-3 flex items-center font-mono text-[14px] border-r"
          style={{ backgroundColor: 'var(--color-paper)', borderColor: 'var(--color-line)', color: 'var(--color-char-soft)' }}
        >
          +91
        </span>
        <input
          id="mobile"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          maxLength={10}
          required
          disabled={disabled}
          placeholder="10-digit number"
          value={value}
          onChange={(e) => onChange?.(e.target.value.replace(/\D/g, '').slice(0, 10))}
          className="flex-1 min-w-0 px-3 py-2.5 text-[14px] font-mono outline-none"
          style={{ backgroundColor: 'var(--color-paper-raised)', color: 'var(--color-char)' }}
        />
      </div>
    </Field>
  )
}

export function ErrorLine({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p className="text-[12.5px] rounded-[8px] px-3 py-2" style={{ backgroundColor: 'var(--color-clay-soft)', color: 'var(--color-clay)' }}>
      {error}
    </p>
  )
}

export function SubmitButton({ busy, disabled, label, busyLabel }: { busy: boolean; disabled?: boolean; label: string; busyLabel: string }) {
  return (
    <button
      type="submit"
      disabled={busy || disabled}
      className="chamfer-sm w-full py-2.5 text-[13.5px] font-medium transition-opacity disabled:opacity-50"
      style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-frost)' }}
    >
      {busy ? busyLabel : label}
    </button>
  )
}

export function TextLink({ onClick, children, tone = 'gold' }: { onClick: () => void; children: ReactNode; tone?: 'gold' | 'soft' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="font-medium underline underline-offset-2"
      style={{ color: tone === 'gold' ? 'var(--color-gold)' : 'var(--color-char-soft)' }}
    >
      {children}
    </button>
  )
}
