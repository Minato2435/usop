import { useState } from 'react'
import type { SdlCategory } from '../../types'
import { FormEngineIcon } from './icons'

export function SdlCategoryBuilder({
  categories,
  onAdd,
  onRemove,
}: {
  categories: SdlCategory[]
  onAdd: (title: string) => void
  onRemove: (categoryId: string) => void
}) {
  const [draft, setDraft] = useState('')
  const sorted = [...categories].sort((a, b) => a.order - b.order)

  function submit() {
    const trimmed = draft.trim()
    if (!trimmed) return
    onAdd(trimmed)
    setDraft('')
  }

  return (
    <>
      <h3 className="font-display text-[21px]" style={{ color: 'var(--color-char)' }}>
        SDL categories
      </h3>
      <p className="mt-1 mb-4 text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
        Flat list — students pick one when logging a self-directed learning activity. No evaluation
        form is attached to SDL categories.
      </p>

      <div className="border p-5" style={{ backgroundColor: 'transparent', borderColor: '#d7d3d3' }}>
      <div className="mb-4">
        {sorted.length === 0 && (
          <p className="py-3 text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
            No categories yet.
          </p>
        )}
        {sorted.map((cat, i) => (
          <div
            key={cat.id}
            className="group flex items-center gap-3 py-2 border-b last:border-0"
            style={{ borderColor: '#d7d3d3' }}
          >
            <span className="w-7 shrink-0 font-mono text-[10.5px] tabular-nums" style={{ color: 'var(--color-char-soft)' }}>
              {i + 1}
            </span>
            <span className="flex-1 min-w-0 text-[13.5px]" style={{ color: 'var(--color-char)' }}>
              {cat.title}
            </span>
            <button
              onClick={() => onRemove(cat.id)}
              className="shrink-0 h-6 w-6 flex items-center justify-center rounded-[3px] opacity-0 group-hover:opacity-100 hover:bg-black/[0.06] transition-opacity duration-150"
              style={{ color: 'var(--color-clay)' }}
              aria-label="Remove category"
            >
              <FormEngineIcon name="trash" className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="New category name"
          className="flex-1 px-3 py-2 text-[13.5px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]"
          style={{ borderColor: '#d7d3d3', color: 'var(--color-char)' }}
        />
        <button
          onClick={submit}
          className="rounded-[3px] inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-medium"
          style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-frost)' }}
        >
          <FormEngineIcon name="plus" className="h-3.5 w-3.5" />
          Add
        </button>
      </div>
      </div>
    </>
  )
}
