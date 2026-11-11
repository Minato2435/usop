import type { CSSProperties } from 'react'

// Small hand-drawn icon set local to the form engine's shared components
// (not primary-admin's shell/Icon.tsx — that's role-specific chrome, and
// TemplateDetailPage/TreeBuilder are reused by Institution Admin too).
// Same visual spec as the admin icon set for consistency: 24x24, 1.6px
// stroke, square linecap/miter linejoin.
export type FormEngineIconName = 'chevron' | 'arrowUp' | 'arrowDown' | 'corner' | 'copy' | 'trash' | 'plus'

export function FormEngineIcon({
  name,
  className,
  style,
}: {
  name: FormEngineIconName
  className?: string
  style?: CSSProperties
}) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'square' as const,
    strokeLinejoin: 'miter' as const,
    className,
    style,
  }

  switch (name) {
    case 'chevron':
      return (
        <svg {...common}>
          <path d="M9 5.5 15.5 12 9 18.5" />
        </svg>
      )
    case 'arrowUp':
      return (
        <svg {...common}>
          <path d="M12 19V6" />
          <path d="M6.5 11.5 12 6l5.5 5.5" />
        </svg>
      )
    case 'arrowDown':
      return (
        <svg {...common}>
          <path d="M12 5v13" />
          <path d="M17.5 12.5 12 18l-5.5-5.5" />
        </svg>
      )
    case 'corner':
      return (
        <svg {...common}>
          <path d="M5 4v7a3 3 0 0 0 3 3h9" />
          <path d="M13 10.5 17.5 14l-4.5 3.5" />
        </svg>
      )
    case 'copy':
      return (
        <svg {...common}>
          <rect x="9" y="9" width="12" height="12" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )
    case 'trash':
      return (
        <svg {...common}>
          <path d="M4.5 7h15" />
          <path d="M9 7V4.5h6V7" />
          <path d="M7 7l1 13h8l1-13" />
        </svg>
      )
    case 'plus':
      return (
        <svg {...common}>
          <path d="M12 4.5v15M4.5 12h15" />
        </svg>
      )
  }
}
