import { useEffect, useMemo, useState } from 'react'
import { Modal, Skeleton, inputClass } from './ui'
import { Icon } from './Icon'
import { watchInstitutions } from '../../../lib/firestore/institutions'
import type { Institution } from '../../../types'

// Shared institution-search picker, opened from pages that let a Primary
// Admin jump into one institution's view of something (Competencies page →
// its Competencies tab, Log Templates page → its SSL Logs tab, …). Owns its
// own institutions subscription so callers don't need one just for this.
export function InstitutionPickerModal({
  title,
  description,
  onClose,
  onSelect,
}: {
  title: string
  description: string
  onClose: () => void
  onSelect: (institution: Institution) => void
}) {
  const [institutions, setInstitutions] = useState<Institution[] | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => watchInstitutions(setInstitutions), [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = institutions ?? []
    if (!q) return list
    // Guard with `?? ''` — real Firestore docs can be missing city/state
    // even though the type says string; calling .toLowerCase() on
    // undefined here crashed the whole page the moment you typed.
    return list.filter((inst) => [inst.name, inst.city, inst.state].some((v) => (v ?? '').toLowerCase().includes(q)))
  }, [institutions, search])

  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-[12.5px] leading-relaxed mb-4" style={{ color: 'var(--color-char-soft)' }}>
        {description}
      </p>
      <div className="relative mb-3">
        <Icon
          name="search"
          className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none"
          style={{ color: 'var(--color-char-soft)' }}
        />
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search institutions"
          className={`${inputClass} pl-8`}
          style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
        />
      </div>

      {!institutions ? (
        <div className="space-y-2">
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-[13px] py-4 text-center" style={{ color: 'var(--color-char-soft)' }}>
          {institutions.length === 0 ? 'No institutions exist yet.' : `No institutions match "${search}".`}
        </p>
      ) : (
        <div className="max-h-[340px] overflow-y-auto -mx-1 px-1 space-y-1.5">
          {filtered.map((inst) => {
            const location = [inst.city, inst.state].filter(Boolean).join(', ')
            const initial = inst.name.trim()[0]?.toUpperCase() ?? '?'
            return (
              <button
                key={inst.id}
                onClick={() => onSelect(inst)}
                className="w-full flex items-center gap-3 px-2.5 py-2 rounded-[8px] text-left transition-colors hover:bg-black/[0.04]"
              >
                <div
                  className="shrink-0 h-9 w-9 rounded-full border-[1.5px] flex items-center justify-center font-display text-[14px]"
                  style={{ borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)' }}
                >
                  {initial}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-medium truncate" style={{ color: 'var(--color-char)' }}>
                    {inst.name}
                  </div>
                  <div className="text-[11.5px] truncate" style={{ color: 'var(--color-char-soft)' }}>
                    {location || 'Location not set'}
                  </div>
                </div>
                <Icon name="chevron" className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--color-char-soft)' }} />
              </button>
            )
          })}
        </div>
      )}
    </Modal>
  )
}
