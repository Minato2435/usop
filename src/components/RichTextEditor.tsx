import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import ReactQuill from 'react-quill-new'
import { VoiceInputButton } from './VoiceInputButton'
import 'react-quill-new/dist/quill.snow.css'
import { Icon, type IconName } from '../roles/primary-admin/shell/Icon'
import { ImageLightbox } from './ImageLightbox'
import {
  MAX_PHOTOS,
  MAX_SKETCHES,
  canvasToBlob,
  compressPhoto,
  draftFromBlob,
  imageObjectUrl,
  revokeDraft,
  type DraftImage,
} from '../lib/submissionImages'

// Backed by React Quill (react-quill-new — the React 19-compatible fork;
// the original react-quill package caps its peer dep at React 18 and
// relies on the since-removed findDOMNode) rather than a hand-built
// contentEditable, per explicit request. Stores/returns raw HTML; callers
// treat it as opaque rich content the same way the DOPS checklist treats
// FormField values as opaque per-question answers. Toolbar was expanded on
// request from a minimal bold/italic/underline/link/size set to a fuller
// authoring toolbar (headers, strike, color/highlight, lists, blockquote,
// alignment) — src/lib/sanitizeHtml.ts's allowlist was widened to match
// every tag/attribute this toolbar can actually produce.
const TOOLBAR_MODULES = {
  toolbar: [
    [{ header: [2, 3, false] }],
    [{ size: ['small', false, 'large', 'huge'] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ color: [] }, { background: [] }],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['blockquote'],
    [{ align: [] }],
    ['link'],
    ['clean'],
  ],
}

// Attached photos/sketches are kept OUT of the description's own HTML —
// they're a separate list rendered as their own thumbnail strip. They are
// held locally (Blob + object-URL preview) while editing and uploaded to
// Firebase Storage only when the activity is saved — see
// lib/submissionImages.ts. Photos and sketches have separate caps
// (MAX_PHOTOS / MAX_SKETCHES); a sketch is one running canvas you keep
// editing via its "Edit drawing" badge.
const PEN_COLORS = ['#0B1220', '#B8863B', '#2F7A6B', '#AC5138', '#F4F2EC']
const PEN_SIZES: { label: string; value: number }[] = [
  { label: 'S', value: 2 },
  { label: 'M', value: 4 },
  { label: 'L', value: 8 },
]
const CANVAS_BG = '#FFFDF8'

// A small labelled section within the attachments card — used to keep
// photos and sketches visually split rather than mixed into one flat row,
// since they're two different kinds of thing (a reference photo vs. a
// hand-drawn note) even though both end up in the same `images` array.
function AttachmentGroup({ label, icon, children }: { label: string; icon: IconName; children: ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon name={icon} className="h-3 w-3" style={{ color: 'var(--color-gold)' }} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.09em]" style={{ color: 'var(--color-char-soft)' }}>
          {label}
        </span>
      </div>
      <div className="flex items-center flex-wrap">{children}</div>
    </div>
  )
}

function AttachmentThumb({
  src,
  label,
  onPreview,
  onRemove,
  onEdit,
}: {
  src: string
  label: string
  onPreview: () => void
  onRemove: () => void
  onEdit?: () => void
}) {
  return (
    // The remove/edit badges sit in this outer box's own padding, never
    // inside the rounded, overflow-hidden image wrapper — that
    // overflow-hidden used to clip the corner badges since they're
    // positioned partly outside the image itself.
    <div className="relative shrink-0 p-1.5">
      <button
        type="button"
        onClick={onPreview}
        title="Preview"
        className="block rounded-[10px] overflow-hidden shadow-sm transition-transform hover:-translate-y-0.5"
      >
        <img src={src} alt={label} className="h-[72px] w-[72px] object-cover block" />
      </button>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          title="Edit drawing"
          className="absolute bottom-0 left-0 h-5 w-5 rounded-full flex items-center justify-center shadow"
          style={{ backgroundColor: 'var(--color-gold)', color: 'var(--color-frost)' }}
        >
          <Icon name="edit" className="h-2.5 w-2.5" />
        </button>
      )}
      <button
        type="button"
        onClick={onRemove}
        title="Remove"
        className="absolute top-0 right-0 h-5 w-5 rounded-full flex items-center justify-center text-[11px] font-semibold leading-none shadow"
        style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-frost)' }}
      >
        ×
      </button>
    </div>
  )
}

export function RichTextEditor({
  value,
  onChange,
  images,
  onImagesChange,
  placeholder = 'Write a description…',
}: {
  value: string
  onChange: (html: string) => void
  images: DraftImage[]
  onImagesChange: (images: DraftImage[]) => void
  placeholder?: string
}) {
  const [attaching, setAttaching] = useState(false)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)

  const imageCount = images.length
  // Keeping the original index alongside each entry (rather than filtering
  // `images` into two plain arrays) is what lets the two grouped sections
  // below still call removeImage/setPreviewIndex/setEditingIndex with the
  // correct position in the single underlying `images` array.
  const indexed = images.map((img, i) => ({ src: img.previewUrl, i }))
  const photoEntries = indexed.filter((e) => images[e.i].kind === 'photo')
  const drawingEntries = indexed.filter((e) => images[e.i].kind === 'sketch')
  const uploadedCount = photoEntries.length
  const drawingCount = drawingEntries.length
  const remainingUploadSlots = Math.max(0, MAX_PHOTOS - uploadedCount)
  const remainingDrawingSlots = Math.max(0, MAX_SKETCHES - drawingCount)

  function removeImage(index: number) {
    const gone = images[index]
    if (gone) revokeDraft(gone)
    onImagesChange(images.filter((_, i) => i !== index))
  }

  // Selecting several files at once fills as many of the remaining upload
  // slots as fit; anything past the cap is silently dropped rather than
  // erroring. Sketches have their own separate cap (remainingDrawingSlots),
  // so an upload-full note can still take a sketch and vice versa.
  async function handleAttachImages(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    e.target.value = '' // lets the same file be re-picked later
    const toProcess = files.filter((f) => f.type.startsWith('image/')).slice(0, remainingUploadSlots)
    if (toProcess.length === 0) return
    setAttaching(true)
    try {
      const compressed: DraftImage[] = []
      for (const file of toProcess) {
        try {
          compressed.push(draftFromBlob(await compressPhoto(file), 'photo'))
        } catch {
          // One bad file (corrupt image, unsupported format) shouldn't
          // stop the rest of the batch.
        }
      }
      if (compressed.length > 0) onImagesChange([...images, ...compressed])
    } finally {
      setAttaching(false)
    }
  }

  // --- sketch pad -----------------------------------------------------
  const [sketchOpen, setSketchOpen] = useState(false)
  // Which existing drawing (index into `images`) is being re-opened for
  // editing, if any — null means "Add drawing" appends a new attachment;
  // set means it replaces that entry instead.
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [penColor, setPenColor] = useState(PEN_COLORS[0])
  const [penSize, setPenSize] = useState(PEN_SIZES[1].value)
  const [eraser, setEraser] = useState(false)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const [sketchLoadError, setSketchLoadError] = useState('')

  // Undo/redo history is a stack of full-canvas PNG snapshots (small canvas,
  // so this is cheap) with a current index — restoring is just redrawing the
  // snapshot at that index, not replaying strokes.
  const [history, setHistory] = useState<{ stack: string[]; index: number }>({ stack: [], index: -1 })

  function snapshot() {
    const el = canvasRef.current
    if (!el) return
    const url = el.toDataURL('image/png')
    setHistory((h) => {
      const stack = [...h.stack.slice(0, h.index + 1), url]
      return { stack, index: stack.length - 1 }
    })
  }

  function restoreSnapshot(url: string) {
    const el = canvasRef.current
    if (!el) return
    const ctx = el.getContext('2d')
    if (!ctx) return
    const img = new window.Image()
    img.onload = () => {
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, el.width, el.height)
      ctx.drawImage(img, 0, 0, el.width, el.height)
      ctx.restore()
    }
    img.src = url
  }

  function sizeCanvas() {
    const el = canvasRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (!rect.width) return
    const dpr = window.devicePixelRatio || 1
    el.width = Math.round(rect.width * dpr)
    el.height = Math.round(rect.height * dpr)
    const ctx = el.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = CANVAS_BG
    ctx.fillRect(0, 0, rect.width, rect.height)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
  }

  useEffect(() => {
    if (!sketchOpen) return
    requestAnimationFrame(() => {
      sizeCanvas() // starts from a blank, correctly-sized canvas either way
      const el = canvasRef.current
      if (!el) return
      const editing = editingIndex !== null ? images[editingIndex] : undefined
      if (editing) {
        // Editing an existing drawing — draw it on top of the blank canvas
        // so further strokes continue from where it left off. Loaded as a
        // same-origin object URL (a saved sketch lives in Storage; drawing
        // a cross-origin image would taint the canvas and block saving).
        const ctx = el.getContext('2d')
        setSketchLoadError('')
        imageObjectUrl(editing)
          .then((objectUrl) => {
            const img = new window.Image()
            img.onload = () => {
              ctx?.save()
              ctx?.setTransform(1, 0, 0, 1, 0, 0)
              ctx?.drawImage(img, 0, 0, el.width, el.height)
              ctx?.restore()
              setHistory({ stack: [el.toDataURL('image/png')], index: 0 })
              if (objectUrl.startsWith('blob:')) URL.revokeObjectURL(objectUrl)
            }
            img.src = objectUrl
          })
          .catch(() => {
            setSketchLoadError('Couldn’t load the saved sketch to edit it — check your connection.')
            setHistory({ stack: [el.toDataURL('image/png')], index: 0 })
          })
      } else {
        setHistory({ stack: [el.toDataURL('image/png')], index: 0 })
      }
    })
    // Deliberately only re-runs when the pad opens/closes, not on every
    // `images`/`editingIndex` change — this should fire once per open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sketchOpen])

  function canvasPoint(e: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }
  function handlePointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    const el = canvasRef.current
    if (!el) return
    drawingRef.current = true
    el.setPointerCapture(e.pointerId)
    const ctx = el.getContext('2d')
    const p = canvasPoint(e)
    ctx?.beginPath()
    ctx?.moveTo(p.x, p.y)
  }
  function handlePointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const p = canvasPoint(e)
    ctx.strokeStyle = eraser ? CANVAS_BG : penColor
    ctx.lineWidth = eraser ? penSize * 5 : penSize
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }
  function handlePointerUp() {
    if (!drawingRef.current) return
    drawingRef.current = false
    snapshot()
  }
  function undo() {
    setHistory((h) => {
      if (h.index <= 0) return h
      restoreSnapshot(h.stack[h.index - 1])
      return { ...h, index: h.index - 1 }
    })
  }
  function redo() {
    setHistory((h) => {
      if (h.index >= h.stack.length - 1) return h
      restoreSnapshot(h.stack[h.index + 1])
      return { ...h, index: h.index + 1 }
    })
  }
  function clearCanvas() {
    const el = canvasRef.current
    const ctx = el?.getContext('2d')
    const rect = el?.getBoundingClientRect()
    if (ctx && rect) {
      ctx.fillStyle = CANVAS_BG
      ctx.fillRect(0, 0, rect.width, rect.height)
      snapshot()
    }
  }
  async function addDrawing() {
    const el = canvasRef.current
    if (!el) return
    if (editingIndex === null && remainingDrawingSlots === 0) return
    // An edited sketch becomes a NEW image (new id/path); the old file is
    // removed from Storage when the activity is saved.
    const drawn = draftFromBlob(await canvasToBlob(el, 'image/png'), 'sketch')
    if (editingIndex !== null) {
      const old = images[editingIndex]
      if (old) revokeDraft(old)
      onImagesChange(images.map((img, i) => (i === editingIndex ? drawn : img)))
    } else {
      onImagesChange([...images, drawn])
    }
    clearCanvas()
    setSketchOpen(false)
    setEditingIndex(null)
  }

  // Inserts a dictated phrase into Quill at the cursor, with a space before
  // it when needed and a capital letter at the start of a sentence.
  const quillRef = useRef<ReactQuill | null>(null)
  function insertDictation(text: string) {
    const q = quillRef.current?.getEditor()
    if (!q) return
    const end = Math.max(0, q.getLength() - 1)
    const index = q.getSelection()?.index ?? end
    const before = q.getText(Math.max(0, index - 2), Math.min(2, index))
    const startsSentence = index === 0 || /[.!?]\s*$/.test(before) || /\n$/.test(before)
    const piece = (startsSentence ? text.charAt(0).toUpperCase() + text.slice(1) : text) + ' '
    const lead = index > 0 && !/\s$/.test(before) ? ' ' : ''
    q.insertText(index, lead + piece, 'user')
    q.setSelection(index + lead.length + piece.length, 0, 'user')
  }

  const canUndo = history.index > 0
  const canRedo = history.index < history.stack.length - 1
  const atUploadLimit = remainingUploadSlots === 0
  const atDrawLimit = remainingDrawingSlots === 0

  return (
    <div>
      <div className="relative">
        <div className="usop-quill rounded-[10px] border overflow-hidden" style={{ borderColor: 'var(--color-line)' }}>
          <ReactQuill ref={quillRef} theme="snow" value={value} onChange={onChange} modules={TOOLBAR_MODULES} placeholder={placeholder} />
        </div>
        {/* Voice typing — dictated text goes in at the cursor (or the end). */}
        <VoiceInputButton className="absolute right-3 bottom-3" label="Speak your description" onText={insertDictation} />
      </div>

      {/* A deliberately separate card, not bolted onto the Quill box —
          attachments live alongside the note, not inside its own chrome. */}
      <div
        className="fade-up mt-4 rounded-[14px] border overflow-hidden"
        style={{
          borderColor: 'var(--color-gold-line)',
          backgroundColor: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)',
        }}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b flex-wrap" style={{ borderColor: 'var(--color-line)' }}>
          <div className="flex items-center gap-2.5">
            <span
              className="h-7 w-7 rounded-full flex items-center justify-center shrink-0"
              style={{ backgroundColor: 'var(--color-gold-soft)', color: 'var(--color-gold)' }}
            >
              <Icon name="upload" className="h-3.5 w-3.5" />
            </span>
            <div>
              <div className="text-[12.5px] font-display font-semibold leading-tight" style={{ color: 'var(--color-char)' }}>
                Attachments
              </div>
              <div className="text-[10.5px]" style={{ color: 'var(--color-char-soft)' }}>
                Photos and sketches — kept separate from your note
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2.5 shrink-0">
            <span className="text-[11px] tabular-nums font-mono" style={{ color: 'var(--color-char-soft)' }}>
              Photos {uploadedCount}/{MAX_PHOTOS}
            </span>
            <span className="text-[11px] tabular-nums font-mono" style={{ color: 'var(--color-char-soft)' }}>
              Sketches {drawingCount}/{MAX_SKETCHES}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2.5 px-4 py-3.5 flex-wrap">
          <label
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium cursor-pointer transition-colors shadow-sm"
            style={{
              backgroundColor: atUploadLimit ? 'var(--color-paper)' : 'var(--color-gold)',
              color: atUploadLimit ? 'var(--color-char-soft)' : 'var(--color-frost)',
              opacity: atUploadLimit || attaching ? 0.6 : 1,
              pointerEvents: atUploadLimit || attaching ? 'none' : 'auto',
            }}
          >
            <Icon name="upload" className="h-3.5 w-3.5" />
            {attaching ? 'Attaching…' : 'Attach image'}
            <input type="file" accept="image/*" multiple className="hidden" onChange={handleAttachImages} disabled={atUploadLimit || attaching} />
          </label>

          <button
            type="button"
            onClick={() => {
              setEditingIndex(null)
              setSketchOpen((s) => !s)
            }}
            disabled={atDrawLimit && !sketchOpen}
            className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium border transition-colors"
            style={{
              borderColor: 'var(--color-gold-line)',
              backgroundColor: sketchOpen ? 'var(--color-gold-soft)' : 'var(--color-paper-raised)',
              color: 'var(--color-gold)',
              opacity: atDrawLimit && !sketchOpen ? 0.5 : 1,
            }}
          >
            <Icon name="edit" className="h-3.5 w-3.5" />
            {sketchOpen ? 'Close sketch pad' : 'Draw a sketch'}
          </button>
        </div>

        {imageCount > 0 && (
          <div className="px-4 pb-4">
            {photoEntries.length > 0 && drawingEntries.length > 0 ? (
              // A true side-by-side split — two columns divided by a
              // vertical hairline — rather than one stacked above the
              // other. Only shown once both kinds actually have something
              // to show; either alone just gets the full width.
              // Photos can hold up to 5 thumbnails, the sketch column ever
              // only holds 1 — weighted 2fr/1fr rather than an even 50/50
              // split so photos get the room they actually need.
              <div className="grid gap-4" style={{ gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)' }}>
                <div className="pr-4 border-r" style={{ borderColor: 'var(--color-line)' }}>
                  <AttachmentGroup label="Photos" icon="upload">
                    {photoEntries.map(({ src, i }) => (
                      <AttachmentThumb
                        key={i}
                        src={src}
                        label={`Photo ${i + 1}`}
                        onPreview={() => setPreviewIndex(i)}
                        onRemove={() => removeImage(i)}
                      />
                    ))}
                  </AttachmentGroup>
                </div>
                <div>
                  <AttachmentGroup label="Sketch" icon="edit">
                    {drawingEntries.map(({ src, i }) => (
                      <AttachmentThumb
                        key={i}
                        src={src}
                        label="Sketch"
                        onPreview={() => setPreviewIndex(i)}
                        onRemove={() => removeImage(i)}
                        onEdit={() => {
                          setEditingIndex(i)
                          setSketchOpen(true)
                        }}
                      />
                    ))}
                  </AttachmentGroup>
                </div>
              </div>
            ) : photoEntries.length > 0 ? (
              <AttachmentGroup label="Photos" icon="upload">
                {photoEntries.map(({ src, i }) => (
                  <AttachmentThumb key={i} src={src} label={`Photo ${i + 1}`} onPreview={() => setPreviewIndex(i)} onRemove={() => removeImage(i)} />
                ))}
              </AttachmentGroup>
            ) : (
              <AttachmentGroup label="Sketch" icon="edit">
                {drawingEntries.map(({ src, i }) => (
                  <AttachmentThumb
                    key={i}
                    src={src}
                    label="Sketch"
                    onPreview={() => setPreviewIndex(i)}
                    onRemove={() => removeImage(i)}
                    onEdit={() => {
                      setEditingIndex(i)
                      setSketchOpen(true)
                    }}
                  />
                ))}
              </AttachmentGroup>
            )}
          </div>
        )}

        {previewIndex !== null && (
          <ImageLightbox src={images[previewIndex]?.previewUrl ?? ''} alt={`Attachment ${previewIndex + 1}`} onClose={() => setPreviewIndex(null)} />
        )}

        {sketchOpen && (
          <div className="fade-up border-t" style={{ borderColor: 'var(--color-line)' }}>
            <div
              className="flex items-center gap-2 px-3 py-2.5 border-b flex-wrap"
              style={{ backgroundColor: 'var(--color-ink)', borderColor: 'var(--color-ink-line)' }}
            >
              <span className="text-[10px] font-semibold uppercase tracking-[0.08em] mr-1" style={{ color: 'var(--color-mist)' }}>
                {editingIndex !== null ? 'Editing sketch' : 'Sketch'}
              </span>
              {sketchLoadError && (
                <span className="text-[11px] mr-1" style={{ color: 'var(--color-clay)' }}>
                  {sketchLoadError}
                </span>
              )}
              {PEN_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  title="Pen colour"
                  onClick={() => {
                    setPenColor(c)
                    setEraser(false)
                  }}
                  className="h-6 w-6 rounded-full border-2 shrink-0"
                  style={{ backgroundColor: c, borderColor: !eraser && penColor === c ? 'var(--color-gold)' : 'transparent' }}
                />
              ))}
              {/* Native colour picker — the 5 swatches above are quick
                  shortcuts, this opens the OS picker so any colour is
                  reachable, not just the presets. Styled as a small
                  rainbow-ringed swatch rather than the raw browser input. */}
              <label
                className="relative h-6 w-6 rounded-full border-2 shrink-0 cursor-pointer overflow-hidden"
                title="Custom colour"
                style={{
                  background: 'conic-gradient(from 0deg, #ff3b30, #ffcc00, #34c759, #007aff, #af52de, #ff3b30)',
                  borderColor: !eraser && !PEN_COLORS.includes(penColor) ? 'var(--color-gold)' : 'transparent',
                }}
              >
                <input
                  type="color"
                  value={penColor}
                  onChange={(e) => {
                    setPenColor(e.target.value)
                    setEraser(false)
                  }}
                  className="absolute -inset-1 opacity-0 cursor-pointer"
                />
              </label>
              <div className="w-px h-5 shrink-0" style={{ backgroundColor: 'var(--color-ink-line)' }} />
              {PEN_SIZES.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  onClick={() => setPenSize(s.value)}
                  className="h-6 w-6 flex items-center justify-center text-[11px] font-semibold rounded-[4px]"
                  style={{ backgroundColor: penSize === s.value ? 'rgba(255,255,255,0.12)' : 'transparent', color: 'var(--color-mist)' }}
                >
                  {s.label}
                </button>
              ))}
              <div className="w-px h-5 shrink-0" style={{ backgroundColor: 'var(--color-ink-line)' }} />
              <button
                type="button"
                onClick={() => setEraser((v) => !v)}
                className="px-2.5 h-6 text-[11px] font-medium rounded-[4px]"
                style={{ backgroundColor: eraser ? 'rgba(255,255,255,0.12)' : 'transparent', color: eraser ? 'var(--color-gold)' : 'var(--color-mist)' }}
              >
                Eraser
              </button>
            </div>

            <div
              className="flex items-center gap-1.5 px-3 py-2 border-b"
              style={{ backgroundColor: 'var(--color-ink-soft)', borderColor: 'var(--color-ink-line)' }}
            >
              <button
                type="button"
                onClick={undo}
                disabled={!canUndo}
                title="Undo"
                className="h-6 w-6 flex items-center justify-center rounded-[4px] disabled:opacity-30 transition-colors"
                style={{ color: 'var(--color-mist)' }}
              >
                <Icon name="undo" className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={redo}
                disabled={!canRedo}
                title="Redo"
                className="h-6 w-6 flex items-center justify-center rounded-[4px] disabled:opacity-30 transition-colors"
                style={{ color: 'var(--color-mist)' }}
              >
                <Icon name="redo" className="h-3.5 w-3.5" />
              </button>
              <div className="flex-1" />
              <button type="button" onClick={clearCanvas} className="px-2.5 h-6 text-[11px] font-medium" style={{ color: 'var(--color-mist)' }}>
                Clear
              </button>
              <button
                type="button"
                onClick={addDrawing}
                className="px-3 h-7 text-[12px] font-semibold rounded-[5px]"
                style={{ backgroundColor: 'var(--color-gold)', color: 'var(--color-frost)' }}
              >
                {editingIndex !== null ? 'Save changes' : 'Add drawing'}
              </button>
            </div>

            <canvas
              ref={canvasRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              style={{ display: 'block', width: '100%', height: 440, background: CANVAS_BG, cursor: 'crosshair', touchAction: 'none' }}
            />
          </div>
        )}
      </div>

      <style>{`
        .usop-quill .ql-toolbar.ql-snow {
          border: none;
          border-bottom: 1px solid var(--color-ink-line);
          background: var(--color-ink);
          padding: 9px 26px 9px 12px;
          /* Every format group stays on one row no matter how narrow the
             card is — Quill's own .ql-formats are inline-block, so they'd
             otherwise wrap like text; this scrolls sideways instead, so
             the card itself doesn't need to be extra-wide just to fit
             the full toolbar. Extra right padding (rather than trusting
             the last group's own trailing margin) because a scroll
             container's own last-child margin isn't reliably visible at
             the very end of the scrollable area in every browser — the
             "clean" button was getting visually clipped there. */
          white-space: nowrap;
          overflow-x: auto;
          overflow-y: hidden;
        }
        .usop-quill .ql-toolbar.ql-snow .ql-formats {
          display: inline-block;
          vertical-align: middle;
        }
        .usop-quill .ql-toolbar.ql-snow .ql-formats:last-child {
          margin-right: 0;
        }
        /* Space specifically to the right of the link icon itself (not
           its containing .ql-formats group, which risked reading as room
           *before* it depending on how the group's own box wraps) — an
           unambiguous margin on the button, so it's after link and only
           after link. */
        .usop-quill .ql-toolbar.ql-snow button.ql-link {
          margin-right: 22px;
        }
        .usop-quill .ql-container.ql-snow {
          border: none;
          font-family: var(--font-sans);
          font-size: 15px;
          background: var(--color-paper-raised);
        }
        .usop-quill .ql-editor {
          /* Starts at a comfortably large size, grows with typing, and
             once the content passes roughly 8 lines it stops growing and
             scrolls internally instead of pushing the rest of the page
             down indefinitely. */
          min-height: 260px;
          max-height: 340px;
          overflow-y: auto;
          padding: 22px 24px;
          line-height: 1.7;
          color: var(--color-char);
        }
        .usop-quill .ql-editor.ql-blank::before {
          color: var(--color-char-soft);
          font-style: italic;
          left: 24px;
          right: 24px;
        }
        .usop-quill .ql-editor a { color: var(--color-gold); }
        .usop-quill .ql-editor blockquote {
          border-left: 3px solid var(--color-gold-line);
          padding-left: 14px;
          color: var(--color-char-soft);
        }
        .usop-quill .ql-snow .ql-stroke { stroke: var(--color-mist); }
        .usop-quill .ql-snow .ql-fill { fill: var(--color-mist); }
        .usop-quill .ql-snow .ql-picker { color: var(--color-mist); }
        .usop-quill .ql-snow button:hover,
        .usop-quill .ql-snow button.ql-active {
          background: rgba(255, 255, 255, 0.08);
          border-radius: 4px;
        }
        .usop-quill .ql-snow button:hover .ql-stroke,
        .usop-quill .ql-snow button.ql-active .ql-stroke,
        .usop-quill .ql-snow .ql-picker-label:hover .ql-stroke {
          stroke: var(--color-gold);
        }
        .usop-quill .ql-snow button:hover .ql-fill,
        .usop-quill .ql-snow button.ql-active .ql-fill {
          fill: var(--color-gold);
        }
        .usop-quill .ql-snow .ql-picker-label:hover,
        .usop-quill .ql-snow .ql-picker-item:hover,
        .usop-quill .ql-snow .ql-picker-item.ql-selected {
          color: var(--color-gold);
        }
        .usop-quill .ql-snow .ql-picker-options {
          background: var(--color-ink-soft);
          border-color: var(--color-ink-line);
        }
        .usop-quill .ql-snow .ql-color-picker .ql-picker-options,
        .usop-quill .ql-snow .ql-icon-picker .ql-picker-options {
          padding: 6px;
        }
        .usop-quill .ql-snow .ql-picker.ql-expanded .ql-picker-label {
          border-color: var(--color-ink-line);
          color: var(--color-gold);
        }
      `}</style>
    </div>
  )
}
