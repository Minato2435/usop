import type { CSSProperties } from 'react'
import { useSpeechToText, speechToTextSupported } from '../lib/useSpeechToText'

// A round mic button that turns speech into text. Tap to start, tap again to
// stop. While listening it pulses and shows the words being recognised in a
// small bubble; each finished phrase is passed to `onText`. Renders nothing
// in browsers without speech recognition (e.g. Firefox).
export function VoiceInputButton({
  onText,
  disabled,
  className = '',
  style,
  label = 'Voice typing',
}: {
  onText: (text: string) => void
  disabled?: boolean
  className?: string
  style?: CSSProperties
  label?: string
}) {
  const { listening, interim, error, toggle } = useSpeechToText(onText)
  if (!speechToTextSupported()) return null

  return (
    <div className={`z-[2] flex flex-col items-end gap-1.5 ${className}`} style={style}>
      {(listening || error) && (
        <div
          className="fade-up max-w-[280px] px-3 py-2 text-[12px] leading-snug rounded-[8px] shadow-[0_8px_20px_-10px_rgba(11,18,32,0.45)]"
          style={{
            backgroundColor: error ? 'var(--color-clay-soft)' : 'var(--color-ink)',
            color: error ? 'var(--color-clay)' : 'var(--color-frost)',
          }}
          role="status"
          aria-live="polite"
        >
          {error ? (
            error
          ) : interim ? (
            <span className="italic opacity-90">{interim}…</span>
          ) : (
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--color-gold)' }} />
              Listening — speak now. Tap the mic to stop.
            </span>
          )}
        </div>
      )}
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()} // keep focus/cursor in the field
        onClick={toggle}
        disabled={disabled}
        title={listening ? 'Stop voice typing' : label}
        aria-label={listening ? 'Stop voice typing' : label}
        aria-pressed={listening}
        className="relative h-8 w-8 rounded-full flex items-center justify-center transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed hover:scale-105"
        style={{
          backgroundColor: listening ? 'var(--color-clay)' : 'var(--color-paper-raised)',
          color: listening ? 'var(--color-frost)' : 'var(--color-gold)',
          border: `1px solid ${listening ? 'var(--color-clay)' : 'var(--color-gold-line)'}`,
          boxShadow: '0 4px 12px -6px rgba(11,18,32,0.35)',
        }}
      >
        {listening && <span className="absolute inset-0 rounded-full animate-ping opacity-40" style={{ backgroundColor: 'var(--color-clay)' }} />}
        {listening ? (
          <svg width="12" height="12" viewBox="0 0 24 24" className="relative">
            <rect x="6" y="6" width="12" height="12" fill="currentColor" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" className="relative">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" />
          </svg>
        )}
      </button>
    </div>
  )
}
