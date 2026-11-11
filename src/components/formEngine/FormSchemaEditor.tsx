import type { FormField, FormFieldType, FormSchema } from '../../types'
import { FormEngineIcon } from './icons'

const FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  text: 'Text',
  textarea: 'Long text',
  number: 'Number',
  date: 'Date',
  dropdown: 'Dropdown',
  checkbox: 'Checkbox / multi-select',
  rating: 'Rating / competency scale',
}

function newField(): FormField {
  return {
    id: crypto.randomUUID(),
    type: 'text',
    label: '',
    required: false,
    options: null,
    maxRating: null,
  }
}

const inputClass =
  'w-full px-2.5 py-1.5 text-[13.5px] border outline-none transition-colors duration-150 focus:border-[var(--color-gold)]'

export function FormSchemaEditor({
  title,
  fields,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  title: string
  fields: FormField[]
  onChange: (fields: FormField[]) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
}) {
  function updateField(id: string, patch: Partial<FormField>) {
    onChange(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)))
  }

  function removeField(id: string) {
    onChange(fields.filter((f) => f.id !== id))
  }

  function addField() {
    onChange([...fields, newField()])
  }

  return (
    <div className="border p-5" style={{ backgroundColor: 'transparent', borderColor: 'var(--color-line)' }}>
      <h3 className="font-display text-[19px]" style={{ color: 'var(--color-char)' }}>
        Evaluation form: {title}
      </h3>
      <p className="mt-1 mb-4 text-[12.5px]" style={{ color: 'var(--color-char-soft)' }}>
        Fields faculty fill out when evaluating this specific activity.
      </p>

      <div className="space-y-3">
        {fields.map((field) => (
          <div key={field.id} className="rounded-[6px] border p-3 space-y-2.5" style={{ borderColor: 'var(--color-line)' }}>
            <div className="flex flex-wrap gap-2">
              <input
                placeholder="Field label"
                value={field.label}
                onChange={(e) => updateField(field.id, { label: e.target.value })}
                className={`flex-1 min-w-[140px] ${inputClass}`}
                style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              />
              <select
                value={field.type}
                onChange={(e) => {
                  const type = e.target.value as FormFieldType
                  updateField(field.id, {
                    type,
                    options: type === 'dropdown' || type === 'checkbox' ? (field.options ?? ['']) : null,
                    maxRating: type === 'rating' ? (field.maxRating ?? 5) : null,
                  })
                }}
                className={inputClass}
                style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
              >
                {Object.entries(FIELD_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-[12.5px] whitespace-nowrap" style={{ color: 'var(--color-char-soft)' }}>
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => updateField(field.id, { required: e.target.checked })}
                />
                Required
              </label>
              <button
                onClick={() => removeField(field.id)}
                className="h-8 w-8 flex items-center justify-center rounded-[3px] hover:bg-black/[0.06]"
                style={{ color: 'var(--color-clay)' }}
                aria-label="Remove field"
              >
                <FormEngineIcon name="trash" className="h-4 w-4" />
              </button>
            </div>

            {(field.type === 'dropdown' || field.type === 'checkbox') && (
              <div className="pl-1">
                <p className="text-[11.5px] mb-1.5" style={{ color: 'var(--color-char-soft)' }}>
                  Options
                </p>
                {(field.options ?? []).map((opt, i) => (
                  <div key={i} className="flex gap-2 mb-1.5">
                    <input
                      value={opt}
                      onChange={(e) => {
                        const next = [...(field.options ?? [])]
                        next[i] = e.target.value
                        updateField(field.id, { options: next })
                      }}
                      className={`flex-1 ${inputClass}`}
                      style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
                    />
                    <button
                      onClick={() =>
                        updateField(field.id, {
                          options: (field.options ?? []).filter((_, idx) => idx !== i),
                        })
                      }
                      className="h-8 w-8 shrink-0 flex items-center justify-center rounded-[3px] hover:bg-black/[0.06]"
                      style={{ color: 'var(--color-char-soft)' }}
                      aria-label="Remove option"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => updateField(field.id, { options: [...(field.options ?? []), ''] })}
                  className="text-[12.5px] font-medium"
                  style={{ color: 'var(--color-gold)' }}
                >
                  + Add option
                </button>
              </div>
            )}

            {field.type === 'rating' && (
              <div className="pl-1 flex items-center gap-2">
                <label className="text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
                  Max rating
                </label>
                <input
                  type="number"
                  min={2}
                  max={10}
                  value={field.maxRating ?? 5}
                  onChange={(e) => updateField(field.id, { maxRating: Number(e.target.value) })}
                  className={`w-16 ${inputClass}`}
                  style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      <button onClick={addField} className="mt-3.5 text-[12.5px] font-medium" style={{ color: 'var(--color-gold)' }}>
        + Add field
      </button>

      <div className="mt-5 flex gap-2">
        <button
          onClick={onSave}
          disabled={saving}
          className="rounded-[3px] px-4 py-2 text-[13px] font-medium disabled:opacity-50"
          style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-frost)' }}
        >
          {saving ? 'Saving…' : 'Save form'}
        </button>
        <button
          onClick={onCancel}
          className="px-4 py-2 text-[13px] font-medium border rounded-[3px] hover:bg-black/[0.03]"
          style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

export function emptySchema(title: string): Omit<FormSchema, 'id' | 'createdAt' | 'createdBy'> {
  return { title, fields: [], code: null, setting: null, level: null, domains: null }
}
