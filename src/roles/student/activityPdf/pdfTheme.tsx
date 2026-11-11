import { Circle, Path, Svg, Text, View } from '@react-pdf/renderer'
import type { CompetencyLevel, SubmissionStatus } from '../../../types'

// Shared clinical design for the student's PDF exports (full Activity Record
// and the Quick Summary): palette, status colours, labels, formatters and a
// few small building blocks. Keep free of browser-only APIs.

export const C = {
  navy: '#0E2A47',
  text: '#1F2937',
  soft: '#5B6B73',
  faint: '#94A3B8',
  line: '#D5E3E1',
  hair: '#E7EEED',
  teal: '#0F766E',
  tealDeep: '#0B4F4A',
  tealMid: '#14B8A6',
  aqua: '#E6F4F2',
  aquaSoft: '#F3FAF9',
  sky: '#0369A1',
  skyTint: '#E0F2FE',
  white: '#FFFFFF',
}

export const STATUS: Record<SubmissionStatus, { label: string; color: string; bg: string; bar: string }> = {
  approved: { label: 'Approved', color: '#166534', bg: '#DCFCE7', bar: '#16A34A' },
  submitted: { label: 'Awaiting review', color: '#92400E', bg: '#FEF3C7', bar: '#D97706' },
  revisionRequested: { label: 'Revision requested', color: '#9A3412', bg: '#FFEDD5', bar: '#EA580C' },
  rejected: { label: 'Rejected', color: '#991B1B', bg: '#FEE2E2', bar: '#DC2626' },
  draft: { label: 'Draft', color: '#475569', bg: '#F1F5F9', bar: '#94A3B8' },
}

export const VERB: Record<SubmissionStatus, string> = {
  approved: 'Approved by',
  rejected: 'Rejected by',
  revisionRequested: 'Revision requested by',
  submitted: 'Awaiting review by',
  draft: 'Not yet sent',
}

export const ATTEMPT: Record<string, string> = { first: 'First attempt', repeat: 'Repeat attempt', remedial: 'Remedial attempt' }
export const ATTEMPT_SHORT: Record<string, string> = { first: 'First', repeat: 'Repeat', remedial: 'Remedial' }

export const LEVEL: Record<CompetencyLevel, string> = {
  O: 'Observed',
  A: 'Assisted',
  P: 'Performed under supervision',
  I: 'Performed independently',
}
export const LEVEL_RANK: Record<CompetencyLevel, number> = { O: 1, A: 2, P: 3, I: 4 }

export const fmtDate = (iso?: string | null) => {
  if (!iso) return '—'
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}
export const fmtMs = (ms?: number | null) => (ms ? new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—')
export const pad2 = (n: number) => String(n).padStart(2, '0')
export const initials = (name: string) =>
  name
    .replace(/^Dr\.?\s*/i, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?'

// A gentle ECG trace, used as the motif in header bands.
export function ecgPoints(width: number, base: number, amp: number, period = 120): string {
  const pts: string[] = []
  for (let x = 0; x <= width; x += 2) {
    const t = x % period
    let y = 0
    if (t > 14 && t < 34) y = -amp * 0.12 * Math.sin(((t - 14) / 20) * Math.PI)
    else if (t >= 44 && t < 48) y = amp * 0.12
    else if (t >= 48 && t < 54) y = -amp
    else if (t >= 54 && t < 60) y = amp * 0.3
    else if (t >= 72 && t < 100) y = -amp * 0.25 * Math.sin(((t - 72) / 28) * Math.PI)
    pts.push(`${x},${(base + y).toFixed(1)}`)
  }
  return pts.join(' ')
}

// Emblem: a disc with a teal medical cross.
export function Emblem({ size, onDark }: { size: number; onDark?: boolean }) {
  const c = size / 2
  const arm = size * 0.17
  const half = size * 0.27
  const d = `M ${c - arm / 2} ${c - half} H ${c + arm / 2} V ${c - arm / 2} H ${c + half} V ${c + arm / 2} H ${c + arm / 2} V ${c + half} H ${c - arm / 2} V ${c + arm / 2} H ${c - half} V ${c - arm / 2} H ${c - arm / 2} Z`
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={c} cy={c} r={c - 1} fill={onDark ? C.white : C.aqua} stroke={onDark ? C.tealMid : C.teal} strokeWidth={1.2} />
      <Path d={d} fill={C.teal} />
    </Svg>
  )
}

export function StatusPill({ status, small }: { status: SubmissionStatus; small?: boolean }) {
  const st = STATUS[status]
  return (
    <View style={{ borderRadius: 9, paddingHorizontal: small ? 6 : 8, backgroundColor: st.bg, flexDirection: 'row', alignItems: 'center', paddingVertical: small ? 1.8 : 3 }}>
      <View style={{ width: 4.5, height: 4.5, borderRadius: 2.25, backgroundColor: st.bar, marginRight: 4 }} />
      <Text style={{ fontSize: small ? 6.6 : 7.8, fontWeight: 700, color: st.color, lineHeight: 1.2 }}>{st.label}</Text>
    </View>
  )
}

export function RatingDots({ value, size = 7 }: { value: number; size?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {[1, 2, 3, 4, 5].map((i) => (
        <View
          key={i}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
            marginLeft: i === 1 ? 0 : size * 0.35,
            backgroundColor: i <= value ? C.teal : C.white,
            borderWidth: 0.9,
            borderColor: C.teal,
          }}
        />
      ))}
      <Text style={{ fontSize: size + 1, fontWeight: 700, color: C.navy, marginLeft: size * 0.7, lineHeight: 1.2 }}>{`${value}/5`}</Text>
    </View>
  )
}

// Footer pinned from the top — a `fixed` element anchored with `bottom` never rendered.
export function PdfFooter({ left, top, side }: { left: string; top: number; side: number }) {
  return (
    <View
      fixed
      style={{
        position: 'absolute',
        top,
        left: side,
        right: side,
        borderTopWidth: 0.75,
        borderTopColor: C.line,
        paddingTop: 7,
        flexDirection: 'row',
        justifyContent: 'space-between',
        fontSize: 6.8,
        color: C.faint,
      }}
    >
      <Text>{left}</Text>
      <Text>USOP · Clinical Skills Logbook</Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  )
}
