import type { CSSProperties } from 'react'

export type IconName =
  | 'overview'
  | 'institutions'
  | 'users'
  | 'departments'
  | 'competencies'
  | 'templates'
  | 'video'
  | 'settings'
  | 'chevron'
  | 'signOut'
  | 'plus'
  | 'crest'
  | 'menu'
  | 'close'
  | 'edit'
  | 'trash'
  | 'search'
  | 'filter'
  | 'copy'
  | 'archive'
  | 'pause'
  | 'play'
  | 'eye'
  | 'cap'
  | 'arrowLeft'
  | 'expand'
  | 'compress'
  | 'grid'
  | 'list'
  | 'upload'
  | 'sun'
  | 'moon'
  | 'folder'
  | 'target'
  | 'inbox'
  | 'checkCircle'
  | 'flag'
  | 'link'
  | 'undo'
  | 'redo'
  | 'forms'
  | 'clock'
  | 'certificate'
  | 'download'
  | 'promote'
  | 'resources'

// Hand-drawn line icon set — 1.6px stroke, 24x24, deliberately squared
// (not the rounded-everything default) to match the panel's chamfer motif.
export function Icon({
  name,
  className,
  style,
}: {
  name: IconName
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
    case 'overview':
      return (
        <svg {...common}>
          <path d="M4 13.5h6.5V4H4z" />
          <path d="M13.5 20h6.5v-9.5h-6.5z" />
          <path d="M4 20h6.5v-3.5H4z" />
          <path d="M13.5 7.5H20V4h-6.5z" />
        </svg>
      )
    case 'institutions':
      return (
        <svg {...common}>
          <path d="M5 20V6.5L12 3l7 3.5V20" />
          <path d="M3 20h18" />
          <path d="M9.5 20v-5h5v5" />
          <path d="M9.5 11h.01M14.5 11h.01M9.5 8h.01M14.5 8h.01" strokeWidth="2.1" />
        </svg>
      )
    case 'users':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 20c0-3.31 2.46-6 6-6s6 2.69 6 6" />
          <path d="M15.5 4.5c1.6.4 2.8 1.87 2.8 3.5s-1.2 3.1-2.8 3.5" />
          <path d="M17.5 14.2c2.1.6 3.5 2.6 3.5 4.8" />
        </svg>
      )
    case 'departments':
      return (
        <svg {...common}>
          <path d="M12 3v6" />
          <path d="M5 15v-3.5a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3V15" />
          <rect x="9" y="15" width="6" height="6" />
          <rect x="1.5" y="15" width="4.5" height="6" />
          <rect x="18" y="15" width="4.5" height="6" />
        </svg>
      )
    case 'competencies':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
        </svg>
      )
    case 'templates':
      return (
        <svg {...common}>
          <path d="M12 3.5 20.5 8 12 12.5 3.5 8z" />
          <path d="M3.5 12 12 16.5 20.5 12" />
          <path d="M3.5 16 12 20.5 20.5 16" />
        </svg>
      )
    case 'video':
      return (
        <svg {...common}>
          <rect x="3" y="5.5" width="13" height="13" />
          <path d="M16 9.5 21 6.5v11L16 14.5" />
        </svg>
      )
    case 'settings':
      return (
        <svg {...common}>
          <path d="M4 6h9.5M17.5 6H20M4 12h2.5M10.5 12H20M4 18h13.5M20 18h.01" strokeWidth="1.6" />
          <circle cx="15.5" cy="6" r="2.3" />
          <circle cx="8.5" cy="12" r="2.3" />
          <circle cx="16" cy="18" r="2.3" />
        </svg>
      )
    case 'chevron':
      return (
        <svg {...common}>
          <path d="M9 5.5 15.5 12 9 18.5" />
        </svg>
      )
    case 'signOut':
      return (
        <svg {...common}>
          <path d="M9 20H5.5A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4H9" />
          <path d="M14 16.5 19 12l-5-4.5" />
          <path d="M19 12H9" />
        </svg>
      )
    case 'plus':
      return (
        <svg {...common}>
          <path d="M12 4.5v15M4.5 12h15" />
        </svg>
      )
    case 'menu':
      return (
        <svg {...common}>
          <path d="M4 6.5h16M4 12h16M4 17.5h16" />
        </svg>
      )
    case 'close':
      return (
        <svg {...common}>
          <path d="M5.5 5.5 18.5 18.5M18.5 5.5 5.5 18.5" />
        </svg>
      )
    case 'edit':
      return (
        <svg {...common}>
          <path d="M14.5 4.5 19.5 9.5 8.5 20.5H3.5V15.5z" />
          <path d="M12 6.5 17.5 12" />
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
    case 'search':
      return (
        <svg {...common}>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.3 15.3 20 20" />
        </svg>
      )
    case 'filter':
      return (
        <svg {...common}>
          <path d="M4 5h16l-6.5 7.5V19l-3 1.5v-8z" />
        </svg>
      )
    case 'copy':
      return (
        <svg {...common}>
          <rect x="9" y="9" width="12" height="12" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )
    case 'archive':
      return (
        <svg {...common}>
          <rect x="2.5" y="4" width="19" height="4.5" />
          <path d="M4.5 8.5V19a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5V8.5" />
          <path d="M10 13.5h4" />
        </svg>
      )
    case 'pause':
      return (
        <svg {...common}>
          <rect x="7" y="5" width="4" height="14" />
          <rect x="13" y="5" width="4" height="14" />
        </svg>
      )
    case 'play':
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M8 4.5 19 12 8 19.5Z" />
        </svg>
      )
    case 'eye':
      return (
        <svg {...common}>
          <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      )
    case 'resources':
      return (
        <svg {...common}>
          <path d="M7 3h8l4 4v11H7Z" />
          <path d="M15 3v4h4" />
          <path d="M4 7v14h11" />
          <path d="M10 11h6M10 14h6" />
        </svg>
      )
    case 'promote':
      return (
        <svg {...common}>
          <path d="M3 20h5v-5h5v-5h5V5h3" />
          <path d="M8 12 15 5" />
          <path d="M10.5 5H15v4.5" />
        </svg>
      )
    case 'cap':
      return (
        <svg {...common}>
          <path d="M12 4 2.5 9 12 14 21.5 9Z" />
          <path d="M6.5 11.3V16c0 1.4 2.5 2.8 5.5 2.8s5.5-1.4 5.5-2.8v-4.7" />
          <path d="M21.5 9v6" />
        </svg>
      )
    case 'crest':
      return (
        <svg {...common} strokeWidth="1.4">
          <path d="M12 3 4 6.5V12c0 4.6 3.2 8 8 9 4.8-1 8-4.4 8-9V6.5z" />
          <path d="M8.5 12.2l2.4 2.4 4.6-5" />
        </svg>
      )
    case 'arrowLeft':
      return (
        <svg {...common}>
          <path d="M11 5 4.5 12 11 19" />
          <path d="M4.5 12h15" />
        </svg>
      )
    case 'expand':
      return (
        <svg {...common}>
          <path d="M9 4H4v5" />
          <path d="M15 4h5v5" />
          <path d="M9 20H4v-5" />
          <path d="M15 20h5v-5" />
        </svg>
      )
    case 'compress':
      return (
        <svg {...common}>
          <path d="M4 9h5V4" />
          <path d="M20 9h-5V4" />
          <path d="M4 15h5v5" />
          <path d="M20 15h-5v5" />
        </svg>
      )
    case 'grid':
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="7.5" height="7.5" />
          <rect x="13" y="3.5" width="7.5" height="7.5" />
          <rect x="3.5" y="13" width="7.5" height="7.5" />
          <rect x="13" y="13" width="7.5" height="7.5" />
        </svg>
      )
    case 'list':
      return (
        <svg {...common}>
          <path d="M8.5 6h12M8.5 12h12M8.5 18h12" />
          <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" strokeWidth="2.4" />
        </svg>
      )
    case 'download':
      return (
        <svg {...common}>
          <path d="M12 4.5v11" />
          <path d="M7 10.5l5 5 5-5" />
          <path d="M4.5 15.5V19a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-3.5" />
        </svg>
      )
    case 'upload':
      return (
        <svg {...common}>
          <path d="M12 15.5V4.5" />
          <path d="M7 9l5-5 5 5" />
          <path d="M4.5 15.5V19a1.5 1.5 0 0 0 1.5 1.5h12a1.5 1.5 0 0 0 1.5-1.5v-3.5" />
        </svg>
      )
    case 'sun':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.36 5.64l-2.12 2.12M7.76 16.24l-2.12 2.12M18.36 18.36l-2.12-2.12M7.76 7.76 5.64 5.64" />
        </svg>
      )
    case 'moon':
      // The one filled icon in the set (fill: currentColor overriding the
      // shared stroke-only style) — a true crescent (two curved edges,
      // sharp pointed tips top and bottom), not a half-moon's straight
      // diameter edge. NOTE: an earlier version built this as two full
      // circles with fillRule="evenodd" — that computes their XOR
      // (symmetric difference), not a subtraction, whenever the cutout
      // circle extends outside the main one, which rendered as two
      // hollow-looking overlapping rings instead of a crescent (caught via
      // an actual screenshot, not just re-deriving the same flawed
      // approach). This is instead a single closed outline — a big arc for
      // the convex outer edge, a smaller arc for the concave inner edge,
      // meeting at two points — as a plain polyline (dense enough to read
      // as smoothly curved at icon sizes), which has no such ambiguity.
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M13.5,4 L12.42,4.93 L11.49,6.01 L10.72,7.21 L10.13,8.51 L9.73,9.88 L9.53,11.29 L9.53,12.71 L9.73,14.12 L10.13,15.49 L10.72,16.79 L11.49,17.99 L12.42,19.07 L13.5,20 L13.5,19.2 L11.04,18.77 L8.87,17.52 L7.26,15.6 L6.41,13.25 L6.41,10.75 L7.26,8.4 L8.87,6.48 L11.04,5.23 L13.5,4.8 Z" />
        </svg>
      )
    case 'folder':
      return (
        <svg {...common}>
          <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v9A1.5 1.5 0 0 1 19.5 20h-15A1.5 1.5 0 0 1 3 18.5Z" />
        </svg>
      )
    case 'target':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <circle cx="12" cy="12" r="4.5" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'inbox':
      return (
        <svg {...common}>
          <path d="M5.5 5.5h13L21 13v5.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V13Z" />
          <path d="M3 13h5l1.8 3h4.4l1.8-3h5" />
        </svg>
      )
    case 'checkCircle':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M7.5 12.5 10.3 15.3 16.5 9" />
        </svg>
      )
    case 'flag':
      return (
        <svg {...common}>
          <path d="M6 3v18" />
          <path d="M6 4.5h11l-2.5 3.5L17 11.5H6" />
        </svg>
      )
    case 'link':
      return (
        <svg {...common}>
          <path d="M10 14.5 14 10.5" />
          <path d="M8.5 15.5 6 18a3 3 0 0 1-4-4l3-3a3 3 0 0 1 4.2-.2" />
          <path d="M15.5 8.5 18 6a3 3 0 0 1 4 4l-3 3a3 3 0 0 1-4.2.2" />
        </svg>
      )
    case 'undo':
      return (
        <svg {...common}>
          <path d="M7 9H16a5 5 0 0 1 0 10H10" />
          <path d="M10.5 5 6.5 9l4 4" />
        </svg>
      )
    case 'redo':
      return (
        <svg {...common}>
          <path d="M17 9H8a5 5 0 0 0 0 10H14" />
          <path d="M13.5 5 17.5 9l-4 4" />
        </svg>
      )
    case 'forms':
      return (
        <svg {...common}>
          <path d="M7 3h7l3 3v15H7z" />
          <path d="M14 3v3h3" />
          <path d="M9.5 12h5" />
          <path d="M9.5 15.5h5" />
          <path d="M9.5 8.5h2" />
        </svg>
      )
    case 'clock':
      return (
        <svg {...common}>
          <path d="M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17z" />
          <path d="M12 7.5V12l4 2" />
        </svg>
      )
    case 'certificate':
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="12" />
          <path d="M8.5 16.5v4L11 19l1 1.5 1-1.5 2.5 1.5v-4" />
          <circle cx="12" cy="10" r="3" />
        </svg>
      )
  }
}
