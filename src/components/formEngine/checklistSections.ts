import type { FormField, FormFieldType } from '../../types'

// A checklist is stored as a plain FormField[] (no section concept in the
// data model), but "step-<n>" / "remark-<n>" IDs plus a "Section — text"
// label prefix are enough to reconstruct/rebuild an editable section
// structure from it — the same convention scripts/seedCompetencies.mjs
// used when it created these fields, and DopsChecklistPreview already
// reads to group steps for display. This is the read/write counterpart
// used by the section-based editor.

export interface EditorQuestion {
  id: string // local editor key only, not persisted
  n: number // persisted as the "step-<n>" / "remark-<n>" id suffix
  text: string
  type: FormFieldType
  options: string[]
  maxRating: number | null
  hasRemark: boolean
}

export interface EditorSection {
  id: string // local editor key only, not persisted
  name: string
  questions: EditorQuestion[]
}

const SECTION_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

export function defaultSectionName(index: number): string {
  return `Section ${SECTION_LETTERS[index] ?? index + 1}`
}

export function parseSections(fields: FormField[]): {
  sections: EditorSection[]
  otherFields: FormField[]
  nextN: number
} {
  const stepMap = new Map<number, { rating?: FormField; remark?: FormField }>()
  const other: FormField[] = []

  for (const f of fields) {
    const stepMatch = f.id.match(/^step-(\d+)$/)
    const remarkMatch = f.id.match(/^remark-(\d+)$/)
    if (stepMatch) {
      stepMap.set(Number(stepMatch[1]), { ...stepMap.get(Number(stepMatch[1])), rating: f })
    } else if (remarkMatch) {
      stepMap.set(Number(remarkMatch[1]), { ...stepMap.get(Number(remarkMatch[1])), remark: f })
    } else {
      other.push(f)
    }
  }

  const entries = [...stepMap.entries()].filter(([, v]) => v.rating).sort((a, b) => a[0] - b[0])
  const sections: EditorSection[] = []
  let maxN = 0

  for (const [n, v] of entries) {
    maxN = Math.max(maxN, n)
    const [sectionName, ...rest] = (v.rating!.label ?? '').split(' — ')
    const text = rest.join(' — ') || sectionName
    let bucket = sections.find((s) => s.name === sectionName)
    if (!bucket) {
      bucket = { id: crypto.randomUUID(), name: sectionName || defaultSectionName(sections.length), questions: [] }
      sections.push(bucket)
    }
    bucket.questions.push({
      id: crypto.randomUUID(),
      n,
      text,
      type: v.rating!.type,
      options: v.rating!.options ?? [],
      maxRating: v.rating!.maxRating ?? null,
      hasRemark: !!v.remark,
    })
  }

  return { sections, otherFields: other, nextN: maxN + 1 }
}

export function serializeSections(sections: EditorSection[], otherFields: FormField[]): FormField[] {
  const out: FormField[] = []
  for (const section of sections) {
    for (const q of section.questions) {
      out.push({
        id: `step-${q.n}`,
        type: q.type,
        label: `${section.name} — ${q.text}`,
        required: true,
        options: q.type === 'dropdown' || q.type === 'checkbox' ? q.options : null,
        maxRating: q.type === 'rating' ? q.maxRating : null,
      })
      if (q.hasRemark) {
        out.push({
          id: `remark-${q.n}`,
          type: 'text',
          label: 'Remark (optional)',
          required: false,
          options: null,
          maxRating: null,
        })
      }
    }
  }
  return [...out, ...otherFields]
}
