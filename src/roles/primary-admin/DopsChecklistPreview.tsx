import { useMemo, useState, type CSSProperties } from 'react'
import type { FieldAnswerValue, FormField } from '../../types'
import { VoiceInputButton } from '../../components/VoiceInputButton'
import { appendDictation } from '../../lib/useSpeechToText'

// A preview of exactly what faculty will fill in when evaluating a
// student against this competency. Structurally adapted from a design
// reference (attaching references/Assessment Form.dc.html) — a two-column
// layout with a sticky live-score sidebar, section-by-section progress,
// and pill-style mark controls — but dressed in this app's own ledger
// aesthetic (ink/gold/Cormorant Garamond/Lora/IBM Plex Mono) rather than
// the reference's neutral-gray palette, since this now lives inside the
// product, not standalone. Nothing here is saved.
const C = {
  ink: 'var(--color-ink)',
  inkSoft: 'var(--color-ink-soft)',
  inkLine: 'var(--color-ink-line)',
  gold: 'var(--color-gold)',
  goldSoft: 'var(--color-gold-soft)',
  goldLine: 'var(--color-gold-line)',
  teal: 'var(--color-teal)',
  tealSoft: 'var(--color-teal-soft)',
  clay: 'var(--color-clay)',
  claySoft: 'var(--color-clay-soft)',
  paper: 'var(--color-paper-raised)',
  bg: 'var(--color-paper)',
  border: 'var(--color-line)',
  text: 'var(--color-char)',
  textSoft: 'var(--color-char-soft)',
  frost: 'var(--color-frost)',
  mist: 'var(--color-mist)',
}
const DISPLAY = 'var(--font-display)'
const SANS = 'var(--font-sans)'
const MONO = 'var(--font-mono)'

function chamfer(size: number): CSSProperties {
  return { clipPath: `polygon(0 0, calc(100% - ${size}px) 0, 100% ${size}px, 100% 100%, 0 100%)` }
}

interface Step {
  n: number
  section: string
  text: string
  field: FormField
  remarkField: FormField | null
}

// The classic Done/Not done/N/A triad is what drives the score — any
// other question type (short text, number, rating, a custom dropdown,
// etc.) is still shown and still counts toward "answered", just not
// toward the pass/fail percentage, since there's no way to grade it as
// correct/incorrect.
function isDoneTriad(options: string[] | null): boolean {
  if (!options) return false
  const norm = options.map((o) => o.trim().toLowerCase())
  return norm.includes('done') && (norm.includes('not done') || norm.includes('notdone'))
}

function toneForOption(opt: string): { bg: string; border: string; color: string } {
  const norm = opt.trim().toLowerCase()
  if (norm === 'done') return { bg: C.tealSoft, border: C.teal, color: C.teal }
  if (norm === 'not done' || norm === 'notdone') return { bg: C.claySoft, border: C.clay, color: C.clay }
  if (norm === 'n/a' || norm === 'na') return { bg: C.border, border: C.textSoft, color: C.textSoft }
  return { bg: C.goldSoft, border: C.goldLine, color: C.gold }
}

function isAnswered(value: string | string[] | undefined): boolean {
  if (value === undefined) return false
  return Array.isArray(value) ? value.length > 0 : value.trim() !== ''
}

function parseDops(fields: FormField[]) {
  const stepMap = new Map<number, { rating?: FormField; remark?: FormField }>()
  const ratings: FormField[] = []
  let feedback: FormField | null = null
  const signatures: FormField[] = []
  // Anything that doesn't match the known step/rating/feedback/signature id
  // conventions — e.g. a field added later via "+ Add field" — still needs
  // to show up somewhere rather than silently vanish from the preview.
  const other: FormField[] = []

  for (const f of fields) {
    const stepMatch = f.id.match(/^step-(\d+)$/)
    const remarkMatch = f.id.match(/^remark-(\d+)$/)
    if (stepMatch) {
      const n = Number(stepMatch[1])
      stepMap.set(n, { ...stepMap.get(n), rating: f })
    } else if (remarkMatch) {
      const n = Number(remarkMatch[1])
      stepMap.set(n, { ...stepMap.get(n), remark: f })
    } else if (f.id.startsWith('rating-')) {
      ratings.push(f)
    } else if (f.id === 'feedback') {
      feedback = f
    } else if (f.id === 'student-ack' || f.id === 'assessor-sign') {
      signatures.push(f)
    } else {
      other.push(f)
    }
  }

  const steps: Step[] = [...stepMap.entries()]
    .filter(([, v]) => v.rating)
    .sort((a, b) => a[0] - b[0])
    .map(([n, v]) => {
      const [section, ...rest] = (v.rating!.label ?? '').split(' — ')
      return { n, section, text: rest.join(' — ') || section, field: v.rating!, remarkField: v.remark ?? null }
    })

  const sections: { name: string; steps: Step[] }[] = []
  steps.forEach((s) => {
    let bucket = sections.find((sec) => sec.name === s.section)
    if (!bucket) {
      bucket = { name: s.section, steps: [] }
      sections.push(bucket)
    }
    bucket.steps.push(s)
  })

  return { sections, ratings, feedback, signatures, other, isDops: steps.length > 0 }
}

const SECTION_LETTER = ['A', 'B', 'C', 'D', 'E', 'F']

export function isDopsSchema(fields: FormField[]): boolean {
  return fields.some((f) => /^step-\d+$/.test(f.id))
}

const LEVEL_LABEL: Record<string, string> = {
  O: 'Observed',
  A: 'Assisted',
  P: 'Performed under supervision',
  I: 'Independently performed',
}

function MessageIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.6} strokeLinecap="square" strokeLinejoin="miter">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

export function DopsChecklistPreview({
  title,
  department,
  code,
  setting,
  level,
  domains,
  fields,
  mode = 'preview',
  value,
  onChange,
}: {
  title: string
  department?: string
  code?: string | null
  setting?: string | null
  level?: string | null
  domains?: string[] | null
  fields: FormField[]
  // 'preview' (default, unchanged from before this prop existed) keeps
  // every field interactive with purely local state — an admin previewing
  // what the finished checklist will look like, nothing persisted. 'fill'
  // is now the FACULTY member actually evaluating a submission: the full
  // form renders — step checklist, Global Rating/Outcome, and Feedback &
  // Sign-off — backed by the controlled `value`/`onChange` pair instead of
  // internal state (student-facing filling was reversed earlier — students
  // never fill this; see CLAUDE.md). 'review' renders that same full form
  // read-only, for the student to see exactly what the faculty recorded.
  // All three modes render every section now — only *interactivity*
  // (readOnly) and *data source* (internal state vs. controlled value)
  // differ between them.
  mode?: 'preview' | 'fill' | 'review'
  value?: Record<string, FieldAnswerValue>
  onChange?: (next: Record<string, FieldAnswerValue>) => void
}) {
  const parsed = useMemo(() => parseDops(fields), [fields])
  const allSteps = useMemo(() => parsed.sections.flatMap((s) => s.steps), [parsed.sections])
  const totalSteps = allSteps.length
  const scorableSteps = useMemo(
    () => allSteps.filter((s) => s.field.type === 'dropdown' && isDoneTriad(s.field.options)),
    [allSteps],
  )

  // Preview mode owns its own scratch state (exactly as before this prop
  // existed); fill/review modes are controlled by the caller so the
  // answers can be saved to Firestore and shown again later.
  const [internalValues, setInternalValues] = useState<Record<string, FieldAnswerValue>>({})
  const values = mode === 'preview' ? internalValues : (value ?? {})
  const readOnly = mode === 'review'
  function setFieldValue(fieldId: string, v: FieldAnswerValue) {
    if (mode === 'preview') setInternalValues((prev) => ({ ...prev, [fieldId]: v }))
    else onChange?.({ ...values, [fieldId]: v })
  }

  const [openRemarks, setOpenRemarks] = useState<Set<number>>(new Set())

  function toggleRemark(n: number) {
    setOpenRemarks((prev) => {
      const next = new Set(prev)
      if (next.has(n)) next.delete(n)
      else next.add(n)
      return next
    })
  }

  function stepValue(step: Step): string | string[] | undefined {
    const raw = values[step.field.id]
    return raw == null ? undefined : (raw as string | string[])
  }
  function stepRemark(step: Step): string {
    if (!step.remarkField) return ''
    const raw = values[step.remarkField.id]
    return typeof raw === 'string' ? raw : ''
  }

  const rated = allSteps.filter((s) => isAnswered(stepValue(s))).length
  const valueOf = (s: Step) => (stepValue(s) as string | undefined)?.trim().toLowerCase()
  const done = scorableSteps.filter((s) => valueOf(s) === 'done').length
  const notDone = scorableSteps.filter((s) => valueOf(s) === 'not done').length
  const naCount = scorableSteps.filter((s) => valueOf(s) === 'n/a').length
  const applicable = done + notDone
  const pct = applicable > 0 ? Math.round((done / applicable) * 100) : 0

  const resultField = parsed.ratings.find((r) => r.id === 'rating-result')
  const resultVal = resultField ? (values[resultField.id] as string | null | undefined) : null

  let verdictLabel = 'Not yet scored'
  let verdictColor = C.text
  let verdictNote =
    mode === 'preview' ? 'Set the overall result in the global ratings section.' : 'Mark every step to see a suggested result.'
  if (resultVal) {
    verdictLabel = resultVal
    verdictColor = /satisfactory/i.test(resultVal) ? C.teal : C.clay
    verdictNote = 'Recorded by the assessor.'
  } else if (totalSteps > 0 && rated === totalSteps && scorableSteps.length > 0 && applicable > 0) {
    verdictLabel = pct >= 90 ? 'Likely Satisfactory' : 'Likely needs practice'
    verdictColor = pct >= 90 ? C.teal : C.clay
    verdictNote = mode === 'preview' ? 'Suggested from step scoring — set the actual result above.' : 'Suggested from step scoring.'
  }

  const sectionHeadStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 14, padding: '22px 28px 12px' }
  const sectionTitleStyle: CSSProperties = { margin: 0, fontFamily: DISPLAY, fontSize: 20, fontWeight: 600, color: C.text }
  const numberBadgeStyle: CSSProperties = {
    ...chamfer(7),
    width: 26,
    height: 26,
    flexShrink: 0,
    background: C.ink,
    color: C.gold,
    fontFamily: DISPLAY,
    fontSize: 12.5,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }

  const badgeStyle: CSSProperties = {
    ...chamfer(6),
    background: 'color-mix(in srgb, var(--color-gold) 14%, transparent)',
    border: `1px solid ${C.goldLine}`,
    padding: '5px 13px',
    fontSize: 11.5,
    letterSpacing: '.02em',
    color: C.gold,
    fontWeight: 600,
  }

  const metaItems = [
    code && { label: 'Reference', value: code },
    level && { label: 'Level', value: `${LEVEL_LABEL[level] ?? level} (${level})` },
    setting && { label: 'Setting', value: setting },
  ].filter(Boolean) as { label: string; value: string }[]

  return (
    <div className="dops-preview-root" style={{ background: C.bg, fontFamily: SANS, color: C.text }}>
      <style>{`
        .dops-preview-root button,
        .dops-preview-root input,
        .dops-preview-root textarea,
        .dops-preview-root select {
          -webkit-tap-highlight-color: transparent;
        }
        .dops-preview-root button:focus,
        .dops-preview-root input:focus,
        .dops-preview-root textarea:focus,
        .dops-preview-root select:focus {
          outline: none;
        }
        .dops-preview-root button:focus-visible,
        .dops-preview-root input:focus-visible,
        .dops-preview-root textarea:focus-visible,
        .dops-preview-root select:focus-visible {
          outline: 2px solid var(--color-gold);
          outline-offset: 2px;
        }
        .dops-preview-root .dops-note {
          transition: border-color .15s ease, box-shadow .15s ease;
        }
        .dops-preview-root .dops-note:focus {
          border-color: var(--color-gold) !important;
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-gold) 15%, transparent);
        }
        .dops-preview-root .dops-note::placeholder {
          color: var(--color-char-soft);
          font-style: italic;
        }
      `}</style>
      <div style={{ width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'stretch', gap: 0 }}>
        {/* ---------- Main column ---------- */}
        <div style={{ flex: 1, minWidth: 0, paddingBottom: 40 }}>
          <div style={{ background: C.bg, borderBottom: `1px solid ${C.border}`, padding: '30px 32px 26px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 12 }}>
              <span
                style={{
                  ...chamfer(8),
                  width: 32,
                  height: 32,
                  flexShrink: 0,
                  background: C.ink,
                  color: C.gold,
                  fontFamily: DISPLAY,
                  fontSize: 15,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {(department ?? title).charAt(0).toUpperCase()}
              </span>
              <span style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '.16em', textTransform: 'uppercase', color: C.gold, fontWeight: 600 }}>
                {[department, 'DOPS Assessment'].filter(Boolean).join(' · ')}
              </span>
            </div>

            <h1 style={{ margin: 0, fontFamily: DISPLAY, fontSize: 32, fontWeight: 600, lineHeight: 1.2, maxWidth: 640, color: C.text }}>{title}</h1>

            {metaItems.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 22px', marginTop: 15 }}>
                {metaItems.map((m) => (
                  <span key={m.label} style={{ fontSize: 12.5, color: C.textSoft }}>
                    <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.08em', textTransform: 'uppercase', color: C.gold, marginRight: 7 }}>
                      {m.label}
                    </span>
                    {m.value}
                  </span>
                ))}
              </div>
            )}

            {domains && domains.length > 0 && (
              <div style={{ display: 'flex', gap: 8, marginTop: 15, flexWrap: 'wrap' }}>
                {domains.map((d) => (
                  <span key={d} style={badgeStyle}>
                    {d}
                  </span>
                ))}
              </div>
            )}
          </div>

          {parsed.sections.map((section, si) => {
            const marked = section.steps.filter((st) => isAnswered(stepValue(st))).length
            return (
              <div key={section.name} id={`dops-section-${si}`}>
                <div style={sectionHeadStyle}>
                  <span style={numberBadgeStyle}>{SECTION_LETTER[si] ?? si + 1}</span>
                  <h2 style={sectionTitleStyle}>{section.name}</h2>
                  <div style={{ flex: 1, height: 1, background: C.border }} />
                  <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: '.05em', textTransform: 'uppercase', color: C.textSoft, whiteSpace: 'nowrap' }}>
                    {marked} of {section.steps.length} marked
                  </span>
                </div>

                {section.steps.map((step) => {
                  const val = valueOf(step)
                  const remark = stepRemark(step)
                  const rail = val === 'done' ? C.teal : val === 'not done' ? C.clay : 'transparent'
                  const rowBg = val === 'not done' ? 'color-mix(in srgb, var(--color-clay) 5%, var(--color-paper) 95%)' : 'transparent'
                  const remarkOpen = openRemarks.has(step.n) || (readOnly && !!remark.trim())
                  const hasRemarkText = !!remark.trim()
                  return (
                    <div
                      key={step.n}
                      className="dops-step-row"
                      style={{ padding: '12px 28px 12px 25px', borderBottom: `1px solid ${C.border}`, borderLeft: `3px solid ${rail}`, background: rowBg, transition: 'background .15s ease' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16 }}>
                        <span style={{ width: 22, flexShrink: 0, textAlign: 'right', fontFamily: MONO, fontSize: 13, color: C.textSoft, paddingTop: 5 }}>
                          {step.n}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, lineHeight: 1.5, color: val === 'n/a' ? C.textSoft : C.text }}>{step.text}</div>
                          {remarkOpen && step.remarkField && (
                            <div style={{ marginTop: 10, maxWidth: 440, position: 'relative' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, color: C.gold }}>
                                <MessageIcon filled={false} />
                                <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: '.09em', textTransform: 'uppercase', fontWeight: 600 }}>Remark</span>
                              </div>
                              <textarea
                                className="dops-note"
                                value={remark}
                                readOnly={readOnly}
                                onChange={(e) => step.remarkField && setFieldValue(step.remarkField.id, e.target.value)}
                                placeholder="What did you observe?"
                                rows={2}
                                style={{
                                  width: '100%',
                                  border: `1px solid ${C.border}`,
                                  borderLeft: `3px solid ${C.goldLine}`,
                                  borderRadius: 8,
                                  background: 'color-mix(in srgb, var(--color-gold) 5%, var(--color-paper) 95%)',
                                  fontFamily: SANS,
                                  fontSize: 13,
                                  lineHeight: 1.55,
                                  color: C.text,
                                  padding: '10px 44px 10px 12px',
                                  outline: 'none',
                                  resize: 'vertical',
                                }}
                              />
                              {!readOnly && step.remarkField && (
                                <VoiceInputButton
                                  style={{ position: 'absolute', right: 8, bottom: 10 }}
                                  label="Speak your remark"
                                  onText={(t) =>
                                    step.remarkField && setFieldValue(step.remarkField.id, appendDictation(String(values[step.remarkField.id] ?? ''), t))
                                  }
                                />
                              )}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                          <StepResponseCell
                            field={step.field}
                            value={stepValue(step)}
                            onChange={(v) => setFieldValue(step.field.id, v)}
                            readOnly={readOnly}
                          />
                          {step.remarkField && !readOnly && (
                            <button
                              onClick={() => toggleRemark(step.n)}
                              title="Add remark"
                              style={{
                                border: 'none',
                                background: 'transparent',
                                color: remarkOpen || hasRemarkText ? C.gold : C.textSoft,
                                padding: 6,
                                display: 'flex',
                                cursor: 'pointer',
                              }}
                            >
                              <MessageIcon filled={hasRemarkText} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })}

          {parsed.ratings.length > 0 && (
            <div id="dops-section-ratings">
              <div style={sectionHeadStyle}>
                <span style={numberBadgeStyle}>{SECTION_LETTER[parsed.sections.length] ?? '#'}</span>
                <h2 style={sectionTitleStyle}>Global Rating &amp; Outcome</h2>
                <div style={{ flex: 1, height: 1, background: C.border }} />
              </div>
              <div style={{ padding: '4px 28px 20px' }}>
                {parsed.ratings.map((r, i) => (
                  <div
                    key={r.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 20,
                      flexWrap: 'wrap',
                      padding: '16px 0',
                      borderBottom: i < parsed.ratings.length - 1 ? `1px solid ${C.border}` : undefined,
                    }}
                  >
                    <div style={{ flex: '1 1 200px', minWidth: 0, fontSize: 14, fontWeight: 600, color: C.text }}>{r.label}</div>
                    <RatingOptionPicker
                      fieldId={r.id}
                      options={r.options ?? []}
                      selected={(values[r.id] as string | undefined) ?? null}
                      onSelect={(opt) => setFieldValue(r.id, values[r.id] === opt ? null : opt)}
                      readOnly={readOnly}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {(parsed.feedback || parsed.signatures.length > 0) && (
            <div id="dops-section-feedback">
              <div style={sectionHeadStyle}>
                <h2 style={sectionTitleStyle}>Feedback &amp; Sign-off</h2>
                <div style={{ flex: 1, height: 1, background: C.border }} />
              </div>
              <div style={{ padding: '4px 28px 20px' }}>
                {parsed.feedback && (
                  <div
                    style={{
                      border: `1px solid ${C.border}`,
                      borderRadius: 10,
                      background: 'color-mix(in srgb, var(--color-gold) 4%, var(--color-paper) 96%)',
                      padding: 16,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                      <span
                        style={{
                          width: 28,
                          height: 28,
                          flexShrink: 0,
                          borderRadius: '50%',
                          background: C.goldSoft,
                          border: `1px solid ${C.goldLine}`,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: C.gold,
                        }}
                      >
                        <MessageIcon filled={false} />
                      </span>
                      <span style={{ fontFamily: DISPLAY, fontSize: 15, fontWeight: 600, color: C.text }}>Faculty Feedback</span>
                    </div>
                    <div style={{ position: 'relative' }}>
                    <textarea
                      className="dops-note"
                      value={(values[parsed.feedback.id] as string | undefined) ?? ''}
                      readOnly={readOnly}
                      onChange={(e) => parsed.feedback && setFieldValue(parsed.feedback.id, e.target.value)}
                      placeholder="Comments on performance, safety, and next steps..."
                      style={{
                        width: '100%',
                        minHeight: 96,
                        border: `1px solid ${C.border}`,
                        borderRadius: 8,
                        padding: '12px 48px 12px 14px',
                        fontSize: 13.5,
                        lineHeight: 1.6,
                        fontFamily: SANS,
                        resize: 'vertical',
                        outline: 'none',
                        background: 'color-mix(in srgb, var(--color-paper-raised) 35%, var(--color-paper) 65%)',
                        color: C.text,
                      }}
                    />
                      {!readOnly && parsed.feedback && (
                        <VoiceInputButton
                          style={{ position: 'absolute', right: 10, bottom: 12 }}
                          label="Speak your feedback"
                          onText={(t) => parsed.feedback && setFieldValue(parsed.feedback.id, appendDictation(String(values[parsed.feedback.id] ?? ''), t))}
                        />
                      )}
                    </div>
                  </div>
                )}
                {parsed.signatures.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: 26,
                      marginTop: 22,
                      paddingTop: 18,
                      borderTop: `1px solid ${C.border}`,
                    }}
                  >
                    {parsed.signatures.map((s) => (
                      <div key={s.id} style={{ flex: '1 1 220px' }}>
                        <label
                          style={{ display: 'block', fontFamily: DISPLAY, fontSize: 11, fontWeight: 500, letterSpacing: '.05em', textTransform: 'uppercase', color: C.textSoft, marginBottom: 4 }}
                        >
                          {s.label}
                        </label>
                        <input
                          value={(values[s.id] as string | undefined) ?? ''}
                          readOnly={readOnly}
                          onChange={(e) => setFieldValue(s.id, e.target.value)}
                          placeholder="Type full name…"
                          style={{
                            width: '100%',
                            border: 'none',
                            borderBottom: `1px solid ${C.border}`,
                            background: 'transparent',
                            fontFamily: DISPLAY,
                            fontSize: 18,
                            color: C.text,
                            padding: '5px 0',
                            outline: 'none',
                          }}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {parsed.other.length > 0 && (
            <div>
              <div style={sectionHeadStyle}>
                <h2 style={sectionTitleStyle}>Additional Fields</h2>
                <div style={{ flex: 1, height: 1, background: C.border }} />
              </div>
              <div style={{ padding: '4px 28px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {parsed.other.map((f) => (
                  <DopsOtherField
                    key={f.id}
                    field={f}
                    value={values[f.id]}
                    onChange={(v) => setFieldValue(f.id, v)}
                    readOnly={readOnly}
                  />
                ))}
              </div>
            </div>
          )}

          <div style={{ fontSize: 11.5, color: C.textSoft, padding: '18px 28px 0' }}>
            {mode === 'preview'
              ? 'Preview only — nothing here is saved. This is exactly the layout and interaction faculty will see when evaluating a student against this competency.'
              : mode === 'fill'
                ? 'Mark each step, set the outcome, and sign off. Use the decision panel to send this back to the student when you’re done.'
                : 'This is exactly what your assessor recorded — read-only here.'}
          </div>
        </div>

        {/* ---------- Sidebar: live score ---------- */}
        {/* The outer box stretches to match the main column's full height
            (via the row's alignItems: 'stretch') so its white background
            never runs out before the checklist does; the inner wrapper is
            what actually sticks, so the score card floats near the top of
            the viewport as you scroll through a long checklist. */}
        <div
          style={{
            width: 300,
            boxSizing: 'border-box',
            flexShrink: 0,
            borderLeft: `1px solid ${C.border}`,
            background: 'color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-paper) 42%)',
          }}
        >
          <div style={{ position: 'sticky', top: 0, padding: '26px 24px 30px' }}>
          <div style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: C.textSoft, marginBottom: 12 }}>
            Live score
          </div>

          <div
            style={{
              ...chamfer(10),
              border: `1px solid ${C.border}`,
              background: 'color-mix(in srgb, var(--color-paper-raised) 75%, var(--color-paper) 25%)',
              boxShadow: '0 1px 3px color-mix(in srgb, var(--color-ink) 8%, transparent)',
              padding: 20,
              textAlign: 'center',
            }}
          >
            <div style={{ fontFamily: DISPLAY, fontSize: 48, lineHeight: 1, fontWeight: 600, color: applicable > 0 ? (pct >= 90 ? C.teal : C.text) : C.textSoft }}>
              {applicable > 0 ? `${pct}%` : '—'}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: C.textSoft, marginTop: 8 }}>
              {applicable > 0 ? `${done} of ${applicable} applicable steps done` : 'Mark steps to begin scoring'}
            </div>
            <div style={{ height: 6, borderRadius: 999, background: C.border, marginTop: 14, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${applicable > 0 ? pct : 0}%`, background: pct >= 90 ? C.teal : C.gold, borderRadius: 999, transition: 'width .2s ease' }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            {[
              { label: 'Done', value: done, color: C.teal },
              { label: 'Not done', value: notDone, color: C.clay },
              { label: 'N/A', value: naCount, color: C.textSoft },
            ].map((t) => (
              <div
                key={t.label}
                style={{
                  flex: 1,
                  border: `1px solid ${C.border}`,
                  borderRadius: 8,
                  background: 'color-mix(in srgb, var(--color-paper-raised) 75%, var(--color-paper) 25%)',
                  boxShadow: '0 1px 3px color-mix(in srgb, var(--color-ink) 8%, transparent)',
                  padding: '10px 6px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontFamily: DISPLAY, fontSize: 19, lineHeight: 1, fontWeight: 600, color: t.color }}>{t.value}</div>
                <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: '.05em', textTransform: 'uppercase', color: C.textSoft, marginTop: 5 }}>{t.label}</div>
              </div>
            ))}
          </div>

          <div style={{ marginTop: 22, fontFamily: MONO, fontSize: 10.5, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: C.textSoft, marginBottom: 8 }}>
            Sections
          </div>
          {parsed.sections.map((section, si) => {
            const marked = section.steps.filter((st) => isAnswered(stepValue(st))).length
            const complete = marked === section.steps.length && section.steps.length > 0
            return (
              <button
                key={section.name}
                onClick={() => document.getElementById(`dops-section-${si}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}
              >
                <span
                  style={{
                    width: 16,
                    height: 16,
                    flexShrink: 0,
                    borderRadius: '50%',
                    border: `1px solid ${complete ? C.gold : C.border}`,
                    background: complete ? C.gold : 'transparent',
                    color: C.frost,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 9.5,
                  }}
                >
                  {complete ? '✓' : ''}
                </span>
                <span style={{ flex: 1, fontSize: 12.5, minWidth: 0, color: C.text }}>{section.name}</span>
                <span style={{ fontFamily: MONO, fontSize: 11, color: C.textSoft, whiteSpace: 'nowrap' }}>
                  {marked}/{section.steps.length}
                </span>
              </button>
            )
          })}

          <div style={{ marginTop: 22, paddingTop: 16, borderTop: `1px solid ${C.border}` }}>
            <div style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 600, letterSpacing: '.14em', textTransform: 'uppercase', color: C.textSoft, marginBottom: 8 }}>
              Result
            </div>
            <div style={{ fontFamily: DISPLAY, fontSize: 21, lineHeight: 1.2, fontWeight: 600, color: verdictColor }}>{verdictLabel}</div>
            <div style={{ fontSize: 12, color: C.textSoft, marginTop: 6, lineHeight: 1.55 }}>{verdictNote}</div>
          </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Global Rating options are deliberately plainer than the step marks'
// pill-track: individual bordered rectangles, one per option, full label
// always visible — no numbers to decode, no merged segmented control.
// Overall Result uses the exact same button shape as the 4-point scale
// rows (just teal/clay instead of ink on selection) rather than a bigger,
// separately-styled control, so the whole section reads as one consistent
// picker language.
function RatingOptionPicker({
  fieldId,
  options,
  selected,
  onSelect,
  readOnly = false,
}: {
  fieldId: string
  options: string[]
  selected: string | null
  onSelect: (opt: string) => void
  readOnly?: boolean
}) {
  const isVerdict = fieldId === 'rating-result'
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      {options.map((opt) => {
        const active = selected === opt
        const positive = isVerdict && /satisfactory/i.test(opt)
        const strong = isVerdict ? (positive ? C.teal : C.clay) : C.ink
        return (
          <button
            key={opt}
            onClick={() => !readOnly && onSelect(opt)}
            disabled={readOnly}
            style={{
              minWidth: isVerdict ? 128 : 106,
              padding: '10px 16px',
              fontFamily: DISPLAY,
              fontSize: 13.5,
              textAlign: 'center',
              borderRadius: 7,
              border: `1.5px solid ${active ? strong : C.border}`,
              background: active ? strong : 'color-mix(in srgb, var(--color-paper-raised) 35%, var(--color-paper) 65%)',
              color: active ? C.frost : C.text,
              cursor: readOnly ? 'default' : 'pointer',
              opacity: readOnly && !active ? 0.55 : 1,
              transition: 'background .15s ease, border-color .15s ease, color .15s ease',
            }}
          >
            {opt}
          </button>
        )
      })}
    </div>
  )
}

// The interactive control shown next to each step — a pill-shaped
// segmented track for dropdown responses (matches the question's actual
// field type, set per-question in the section editor), tinted teal/clay/
// gold rather than the source reference's neutral fill.
function StepResponseCell({
  field,
  value,
  onChange,
  readOnly = false,
}: {
  field: FormField
  value: string | string[] | undefined
  onChange: (value: string | string[]) => void
  readOnly?: boolean
}) {
  const textVal = typeof value === 'string' ? value : ''
  const arrVal = Array.isArray(value) ? value : []
  const inputStyle: CSSProperties = { width: 200, padding: '7px 9px', border: `1px solid ${C.border}`, borderRadius: 6, fontSize: 13, fontFamily: SANS, outline: 'none', background: C.paper, color: C.text }

  if (field.type === 'dropdown') {
    return (
      <div
        style={{
          display: 'flex',
          gap: 3,
          flexWrap: 'wrap',
          border: `1px solid ${C.border}`,
          borderRadius: 999,
          padding: 3,
          background: 'color-mix(in srgb, var(--color-paper-raised) 35%, var(--color-paper) 65%)',
          boxShadow: 'inset 0 1px 2px color-mix(in srgb, var(--color-ink) 7%, transparent)',
        }}
      >
        {(field.options ?? []).map((opt) => {
          const active = textVal === opt
          const tone = toneForOption(opt)
          return (
            <button
              key={opt}
              onClick={() => !readOnly && onChange(opt)}
              disabled={readOnly}
              title={opt}
              style={{
                border: 'none',
                borderRadius: 999,
                padding: '0 13px',
                height: 28,
                fontSize: 11,
                letterSpacing: '.05em',
                textTransform: 'uppercase',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                background: active ? tone.color : 'transparent',
                color: active ? C.frost : C.textSoft,
                boxShadow: active ? `0 1px 4px color-mix(in srgb, ${tone.color} 50%, transparent)` : 'none',
                cursor: readOnly ? 'default' : 'pointer',
                opacity: readOnly && !active ? 0.55 : 1,
                transition: 'background .15s ease, color .15s ease, box-shadow .15s ease',
              }}
              onMouseEnter={(e) => {
                if (!active && !readOnly) {
                  e.currentTarget.style.background = tone.bg
                  e.currentTarget.style.color = tone.color
                }
              }}
              onMouseLeave={(e) => {
                if (!active && !readOnly) {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = C.textSoft
                }
              }}
            >
              {opt}
            </button>
          )
        })}
      </div>
    )
  }

  if (field.type === 'checkbox') {
    return (
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', maxWidth: 220 }}>
        {(field.options ?? []).map((opt) => (
          <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: C.text }}>
            <input
              type="checkbox"
              checked={arrVal.includes(opt)}
              disabled={readOnly}
              onChange={() => onChange(arrVal.includes(opt) ? arrVal.filter((o) => o !== opt) : [...arrVal, opt])}
            />
            {opt}
          </label>
        ))}
      </div>
    )
  }

  if (field.type === 'rating') {
    const n = Number(textVal) || 0
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        {Array.from({ length: field.maxRating ?? 5 }).map((_, i) => {
          const val = i + 1
          const active = n === val
          return (
            <button
              key={val}
              onClick={() => !readOnly && onChange(String(val))}
              disabled={readOnly}
              style={{
                height: 26,
                width: 26,
                borderRadius: '50%',
                border: `1px solid ${C.goldLine}`,
                background: active ? C.gold : C.paper,
                color: active ? C.frost : C.gold,
                fontSize: 11.5,
                fontWeight: 600,
                cursor: readOnly ? 'default' : 'pointer',
                opacity: readOnly && !active ? 0.55 : 1,
              }}
            >
              {val}
            </button>
          )
        })}
      </div>
    )
  }

  if (field.type === 'textarea') {
    return <textarea value={textVal} onChange={(e) => onChange(e.target.value)} readOnly={readOnly} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
  }
  if (field.type === 'number') {
    return <input type="number" value={textVal} onChange={(e) => onChange(e.target.value)} readOnly={readOnly} style={inputStyle} />
  }
  if (field.type === 'date') {
    return <input type="date" value={textVal} onChange={(e) => onChange(e.target.value)} readOnly={readOnly} style={inputStyle} />
  }
  return <input type="text" value={textVal} onChange={(e) => onChange(e.target.value)} readOnly={readOnly} placeholder="Faculty types here" style={inputStyle} />
}

function DopsOtherField({
  field,
  value,
  onChange,
  readOnly = false,
}: {
  field: FormField
  value: FieldAnswerValue | undefined
  onChange: (v: FieldAnswerValue) => void
  readOnly?: boolean
}) {
  const labelStyle: CSSProperties = {
    display: 'block',
    fontFamily: DISPLAY,
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: '.05em',
    color: C.textSoft,
    textTransform: 'uppercase',
    marginBottom: 6,
  }
  const inputStyle: CSSProperties = { width: '100%', padding: '9px 10px', border: `1px solid ${C.border}`, borderRadius: 7, fontSize: 14, fontFamily: SANS, outline: 'none', background: C.paper, color: C.text }
  const textVal = typeof value === 'string' ? value : ''
  const arrVal = Array.isArray(value) ? value : []
  const numVal = Number(value ?? 0) || 0

  return (
    <div>
      <label style={labelStyle}>
        {field.label || 'Untitled field'}
        {field.required && <span style={{ color: C.clay }}> *</span>}
      </label>

      {field.type === 'text' && (
        <input
          value={textVal}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Faculty types here"
          style={inputStyle}
        />
      )}
      {field.type === 'textarea' && (
        <textarea
          value={textVal}
          readOnly={readOnly}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      )}
      {field.type === 'number' && (
        <input type="number" value={textVal} readOnly={readOnly} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
      )}
      {field.type === 'date' && (
        <input type="date" value={textVal} readOnly={readOnly} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
      )}
      {field.type === 'dropdown' && (
        <select value={textVal} disabled={readOnly} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
          <option value="">Select…</option>
          {(field.options ?? []).map((opt, i) => (
            <option key={i} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      )}
      {field.type === 'checkbox' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
          {(field.options ?? []).map((opt, i) => (
            <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: C.text, textTransform: 'none', fontWeight: 400 }}>
              <input
                type="checkbox"
                checked={arrVal.includes(opt)}
                disabled={readOnly}
                onChange={() => onChange(arrVal.includes(opt) ? arrVal.filter((o) => o !== opt) : [...arrVal, opt])}
              />
              {opt}
            </label>
          ))}
        </div>
      )}
      {field.type === 'rating' && (
        <div style={{ display: 'flex', gap: 6 }}>
          {Array.from({ length: field.maxRating ?? 5 }).map((_, i) => {
            const val = i + 1
            const active = numVal === val
            return (
              <button
                key={i}
                onClick={() => !readOnly && onChange(String(val))}
                disabled={readOnly}
                style={{
                  height: 28,
                  width: 28,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
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
                {val}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
