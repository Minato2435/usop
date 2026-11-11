import { createPortal } from 'react-dom'

// Shared full-screen preview overlay for a single image — used by
// AttachmentGallery.tsx (read-only submission views) and RichTextEditor.tsx
// (previewing an attachment while still composing the note), so both get
// the exact same click-to-enlarge behavior instead of two hand-rolled
// overlays drifting apart.
//
// Rendered via a portal straight onto document.body rather than in place:
// any ancestor with a CSS `transform` (including one applied only via a
// running/finished animation, like the `.fade-up` entrance animation these
// attachment cards use) becomes the containing block for its `position:
// fixed` descendants — so without the portal, this overlay was centering
// and clipping to that ancestor's box instead of the actual viewport.
export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ backgroundColor: 'rgba(11,18,32,0.82)' }}
      onClick={onClose}
    >
      <img src={src} alt={alt} className="max-h-[85vh] max-w-[90vw] rounded-[10px] shadow-2xl" onClick={(e) => e.stopPropagation()} />
      <button
        type="button"
        onClick={onClose}
        className="absolute top-5 right-5 h-9 w-9 rounded-full flex items-center justify-center text-[18px]"
        style={{ backgroundColor: 'var(--color-ink-soft)', color: 'var(--color-frost)' }}
      >
        ×
      </button>
    </div>,
    document.body,
  )
}
