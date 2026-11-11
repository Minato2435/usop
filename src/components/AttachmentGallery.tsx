import { useState } from 'react'
import { isSafeImageUrl } from '../lib/submissionImages'
import { ImageLightbox } from './ImageLightbox'
import type { SubmissionImage } from '../types'

// Renders `Submission.images` — photos and the sketch attached on the New
// Activity page. The files live in Firebase Storage; each thumbnail loads
// lazily from its download URL, so long lists don't download every image
// up front. Every URL is checked (isSafeImageUrl) before reaching an <img>:
// the field is writable by the submission's owner straight through the
// SDK, so it must never point at an arbitrary remote host.
export function AttachmentGallery({ images }: { images: SubmissionImage[] }) {
  const safe = images.filter((img) => isSafeImageUrl(img.url))
  const [openIndex, setOpenIndex] = useState<number | null>(null)

  if (safe.length === 0) return null

  return (
    <>
      <div className="flex items-center gap-2.5 flex-wrap">
        {safe.map((img, i) => (
          <button
            key={img.id}
            type="button"
            onClick={() => setOpenIndex(i)}
            title={img.kind === 'sketch' ? 'Sketch' : `Photo ${i + 1}`}
            className="relative h-20 w-20 rounded-[8px] border overflow-hidden shrink-0 transition-transform hover:scale-[1.03]"
            style={{ borderColor: 'var(--color-line)', backgroundColor: img.kind === 'sketch' ? '#FFFDF8' : 'var(--color-paper)' }}
          >
            <img
              src={img.url}
              alt={img.kind === 'sketch' ? 'Sketch' : `Photo ${i + 1}`}
              loading="lazy"
              decoding="async"
              className={`h-full w-full ${img.kind === 'sketch' ? 'object-contain' : 'object-cover'}`}
            />
            {img.kind === 'sketch' && (
              <span
                className="absolute bottom-1 left-1 px-1.5 py-[1px] rounded-full text-[9px] font-semibold uppercase tracking-[0.06em]"
                style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-frost)' }}
              >
                Sketch
              </span>
            )}
          </button>
        ))}
      </div>

      {openIndex !== null && safe[openIndex] && (
        <ImageLightbox src={safe[openIndex].url} alt={`Attachment ${openIndex + 1}`} onClose={() => setOpenIndex(null)} />
      )}
    </>
  )
}
