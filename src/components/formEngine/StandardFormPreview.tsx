import { useMemo, type CSSProperties } from 'react'
import type { FieldAnswerValue, FormField } from '../../types'

// Generic renderer/filler for the standalone Faculty Forms (CBD/Mini-CEX/
// OSCE) — distinct from DopsChecklistPreview, which is purpose-built
// around DOPS's step-N/rating-/feedback/signature id conventions and a
// Done/Not-done/N/A step checklist. These forms have no such convention:
// just a flat FormField[] grouped into real section headers via
// FormField.section. 'fill' is controlled (value/onChange); 'review' is
// the same layout read-only.
const C = {
  gold: 'var(--color-gold)',
  goldLine: 'var(--color-gold-line)',
  border: 'var(--color-line)',
  text: 'var(--color-char)',
  textSoft: 'var(--color-char-soft)',
  paper: 'var(--color-paper)',
  paperRaised: 'var(--color-paper-raised)',
  frost: 'var(--color-frost)',
}

function groupBySection(fields: FormField[]): { section: string; fields: FormField[] }[] {
  const groups: { section: string; fields: FormField[] }[] = []
  for (const field of fields) {
    const name = field.section || 'Additional Fields'
    let bucket = groups.find((g) => g.section === name)
    if (!bucket) {
      bucket = { section: name, fields: [] }
      groups.push(bucket)
    }
    bucket.fields.push(field)
  }
  return groups
}

export function StandardFormPreview({
  title,
  fields,
  mode,
  value,
  onChange,
}: {
  title: string
  fields: FormField[]
  mode: 'fill' | 'review'
  value: Record<string, FieldAnswerValue>
  onChange?: (next: Record<string, FieldAnswerValue>) => void
}) {
  const groups = useMemo(() => groupBySection(fields), [fields])
  const readOnly = mode === 'review'

  function setFieldValue(id: string, v: FieldAnswerValue) {
    onChange?.({ ...value, [id]: v })
  }

  return (
    <div style={{ fontFamily: 'var(--font-sans)', color: C.text }}>
      <div style={{ padding: '22px 0 16px' }}>
        <h1 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 600, color: C.text }}>{title}</h1>
      </div>

      {groups.map((group, gi) => (
        <div key={group.section} style={{ borderTop: gi === 0 ? 'none' : `1px solid ${C.border}`, padding: '18px 0' }}>
          <h2
            style={{
              margin: '0 0 14px',
              fontFamily: 'var(--font-display)',
              fontSize: 15,
              fontWeight: 600,
              color: C.gold,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {group.section}
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
            {group.fields.map((field) => (
              <StandardField key={field.id} field={field} value={value[field.id]} onChange={(v) => setFieldValue(field.id, v)} readOnly={readOnly} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function StandardField({
  field,
  value,
  onChange,
  readOnly,
}: {
  field: FormField
  value: FieldAnswerValue | undefined
  onChange: (v: FieldAnswerValue) => void
  readOnly: boolean
}) {
  const textVal = typeof value === 'string' ? value : ''
  const arrVal = Array.isArray(value) ? value : []
  const wide = field.type === 'textarea'

  const inputStyle: CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    border: `1px solid ${C.border}`,
    borderRadius: 7,
    fontSize: 13.5,
    fontFamily: 'var(--font-sans)',
    outline: 'none',
    background: readOnly ? C.paper : C.paperRaised,
    color: C.text,
  }
  const labelStyle: CSSProperties = {
    display: 'block',
    fontSize: 11.5,
    fontWeight: 500,
    color: C.textSoft,
    marginBottom: 6,
  }

  return (
    <div style={{ gridColumn: wide ? '1 / -1' : undefined }}>
      <label style={labelStyle}>
        {field.label}
        {field.required && <span style={{ color: 'var(--color-clay)' }}> *</span>}
      </label>

      {field.type === 'text' && <input value={textVal} readOnly={readOnly} onChange={(e) => onChange(e.target.value)} style={inputStyle} />}
      {field.type === 'textarea' && (
        <textarea value={textVal} readOnly={readOnly} onChange={(e) => onChange(e.target.value)} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
      )}
      {field.type === 'number' && (
        <input type="number" value={textVal} readOnly={readOnly} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
      )}
      {field.type === 'date' && (
        <input type="date" value={textVal} readOnly={readOnly} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
      )}

      {field.type === 'dropdown' && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(field.options ?? []).map((opt) => {
            const active = textVal === opt
            return (
              <button
                key={opt}
                type="button"
                onClick={() => !readOnly && onChange(active ? '' : opt)}
                disabled={readOnly}
                style={{
                  padding: '7px 13px',
                  fontSize: 12.5,
                  borderRadius: 999,
                  border: `1.5px solid ${active ? C.gold : C.border}`,
                  background: active ? C.gold : 'transparent',
                  color: active ? C.frost : C.text,
                  cursor: readOnly ? 'default' : 'pointer',
                  opacity: readOnly && !active ? 0.5 : 1,
                }}
              >
                {opt}
              </button>
            )
          })}
        </div>
      )}

      {field.type === 'checkbox' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {(field.options ?? []).map((opt) => {
            const checked = arrVal.includes(opt)
            return (
              <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: readOnly ? 'default' : 'pointer' }}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={readOnly}
                  onChange={() => onChange(checked ? arrVal.filter((o) => o !== opt) : [...arrVal, opt])}
                />
                {opt}
              </label>
            )
          })}
        </div>
      )}

      {field.type === 'rating' && (
        <div style={{ display: 'flex', gap: 6 }}>
          {Array.from({ length: field.maxRating ?? 5 }).map((_, i) => {
            const n = i + 1
            const active = Number(textVal) === n
            return (
              <button
                key={n}
                type="button"
                onClick={() => !readOnly && onChange(String(n))}
                disabled={readOnly}
                style={{
                  height: 28,
                  width: 28,
                  borderRadius: '50%',
                  border: `1px solid ${C.goldLine}`,
                  background: active ? C.gold : 'transparent',
                  color: active ? C.frost : C.gold,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: readOnly ? 'default' : 'pointer',
                  opacity: readOnly && !active ? 0.55 : 1,
                }}
              >
                {n}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
