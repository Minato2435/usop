import { Icon } from './Icon'
import { useDarkMode } from '../../../app/DarkModeContext'

// A quick bright/dark toggle for the header, next to the clock — purely a
// local, per-browser preference (DarkModeContext), not a write to the
// shared platformConfig doc. It used to write the platform-wide theme
// directly, which only ever worked for a primary admin (the only role
// with write access to that doc) — every other role's click silently
// failed. Dark always means Midnight; switching it off falls back to
// whatever theme the primary admin has actually configured platform-wide
// (Module 09's Platform Configuration page — still the only place to
// change *that*, and still primary-admin-only).
export function ThemeToggle() {
  const { dark, toggle } = useDarkMode()

  return (
    <button
      onClick={toggle}
      title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      className="shrink-0 h-8 w-8 flex items-center justify-center rounded-[3px] hover:bg-black/5 transition-colors"
      style={{ color: 'var(--color-char-soft)' }}
    >
      <Icon name={dark ? 'moon' : 'sun'} className="h-4 w-4" />
    </button>
  )
}
