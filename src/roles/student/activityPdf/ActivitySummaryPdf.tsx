import type { ReactNode } from 'react'
import { Defs, Document, LinearGradient, Link, Page, Polyline, Rect, Stop, StyleSheet, Svg, Text, View, pdf } from '@react-pdf/renderer'
import type { Style } from '@react-pdf/stylesheet'
import { registerPdfFonts } from './pdfFonts'
import { decodeEntities } from './htmlToPdf'
import { ATTEMPT_SHORT, C, Emblem, LEVEL, LEVEL_RANK, PdfFooter, STATUS, StatusPill, ecgPoints, fmtDate, pad2 } from './pdfTheme'
import type { ActivityRecordProps, ExportActivity } from './ActivityRecordPdf'
import type { CompetencyLevel, SubmissionStatus } from '../../../types'

// "Quick summary" export — the whole logbook at a glance, no descriptions or
// images. A4 landscape, in three sections that each start on a fresh page:
//   01 Overview          — headline numbers, departments, status mix, competency
//   02 Skills by department — every skill, grouped under its department
//   03 Activity log      — every activity, grouped by month
// Each section has its own running header naming it, and its column header
// repeats on every continuation page. Same clinical design as the full
// Activity Record (pdfTheme.tsx).

const W = 595.28
const H = 841.89
const SIDE = 36
const TOP = 58

const s = StyleSheet.create({
  page: { paddingTop: TOP, paddingBottom: 50, paddingHorizontal: SIDE, fontFamily: 'Inter', fontSize: 8, color: C.text, lineHeight: 1.4 },
  label: { fontSize: 6.2, fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase', color: C.soft, lineHeight: 1.3 },
  th: { fontSize: 6.2, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase', color: C.teal, lineHeight: 1.3 },
  box: { borderWidth: 0.75, borderColor: C.line, borderRadius: 6 },
  cardTitle: { fontSize: 7.2, fontWeight: 700, letterSpacing: 0.9, textTransform: 'uppercase', color: C.navy, lineHeight: 1.3 },
})

type StatusCounts = Record<SubmissionStatus, number>
const emptyCounts = (): StatusCounts => ({ approved: 0, submitted: 0, revisionRequested: 0, rejected: 0, draft: 0 })
const LEVEL_SHORT: Record<CompetencyLevel, string> = { I: 'Independent', P: 'Supervised', A: 'Assisted', O: 'Observed' }
const STATUS_ORDER: SubmissionStatus[] = ['approved', 'submitted', 'revisionRequested', 'rejected', 'draft']
const pct = (v: number, t: number) => (t ? Math.round((v / t) * 100) : 0)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const SECTIONS = [
  { id: 'overview', no: '01', title: 'Overview' },
  { id: 'skills', no: '02', title: 'Skills by department' },
  { id: 'log', no: '03', title: 'Activity log' },
] as const

// ── Building blocks ─────────────────────────────────────────────────────────

// Running header on section pages: teal hairline, college, section + student.
function RunningHeader({ college, section, student }: { college: string; section: (typeof SECTIONS)[number]; student: string }) {
  return (
    <View fixed style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
      <View style={{ height: 4, backgroundColor: C.teal }} />
      <View style={{ marginTop: 13, marginHorizontal: SIDE, flexDirection: 'row', alignItems: 'center', paddingBottom: 7, borderBottomWidth: 0.75, borderBottomColor: C.hair }}>
        <Emblem size={14} />
        <Text style={{ fontSize: 8.5, fontWeight: 700, color: C.navy, marginLeft: 6, lineHeight: 1.2 }}>{college}</Text>
        <View style={{ flex: 1 }} />
        <Text style={{ fontSize: 7.2, color: C.soft, lineHeight: 1.2 }}>
          <Text style={{ color: C.teal, fontWeight: 700 }}>{`${section.no}  ${section.title}`}</Text>
          {`   ·   ${student}`}
        </Text>
      </View>
    </View>
  )
}

// Big title at the start of a section.
function SectionTitle({ section, sub, right }: { section: (typeof SECTIONS)[number]; sub: string; right?: ReactNode }) {
  return (
    <View id={section.id} style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 10 }}>
      <Text style={{ fontSize: 26, fontWeight: 800, color: C.tealMid, lineHeight: 1, marginRight: 10, opacity: 0.55 }}>{section.no}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 6.8, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase', color: C.teal, lineHeight: 1.2 }}>{`Section ${section.no} of 03`}</Text>
        <Text style={{ fontSize: 16, fontWeight: 800, color: C.navy, lineHeight: 1.2, marginTop: 1 }}>{section.title}</Text>
        <Text style={{ fontSize: 7.4, color: C.soft, marginTop: 1 }}>{sub}</Text>
      </View>
      {right}
    </View>
  )
}

function Card({ title, right, children, style }: { title: string; right?: string; children: ReactNode; style?: Style }) {
  return (
    <View style={[s.box, { padding: 10 }, style ?? {}]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <View style={{ width: 3, height: 9, backgroundColor: C.teal, borderRadius: 1.5, marginRight: 5 }} />
        <Text style={s.cardTitle}>{title}</Text>
        <View style={{ flex: 1 }} />
        {right ? <Text style={{ fontSize: 6.6, color: C.faint }}>{right}</Text> : null}
      </View>
      {children}
    </View>
  )
}

function Bar({ value, total, color, width = 26 }: { value: number; total: number; color: string; width?: number }) {
  const p = pct(value, total)
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <View style={{ flex: 1, height: 5, borderRadius: 2.5, backgroundColor: C.hair, overflow: 'hidden' }}>
        <View style={{ width: `${p}%`, height: 5, backgroundColor: color }} />
      </View>
      <Text style={{ width, textAlign: 'right', fontSize: 7, fontWeight: 600, color: C.navy }}>{`${p}%`}</Text>
    </View>
  )
}

function LevelBadge({ level, size = 14 }: { level: CompetencyLevel; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: 3, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.54, fontWeight: 800, color: C.white, lineHeight: 1.2 }}>{level}</Text>
    </View>
  )
}

// A table whose rows are grouped (department / month). The column header is
// `fixed`, so it repeats at the top of every page of the section; a group's
// heading is glued to its first row so it is never left alone at a page end.
type Col = { label: string; width?: number; flex?: number; align?: 'left' | 'right' | 'center' }
type Group = { key: string; head: ReactNode; rows: ReactNode[][] }

function GroupedTable({ cols, groups }: { cols: Col[]; groups: Group[] }) {
  const cellStyle = (c: Col) => ({ width: c.width, flex: c.flex, paddingRight: 6, textAlign: c.align ?? 'left' }) as const
  const row = (cells: ReactNode[], r: number, key: string) => (
    <View
      key={key}
      wrap={false}
      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 7, backgroundColor: r % 2 ? C.aquaSoft : C.white, borderBottomWidth: 0.5, borderBottomColor: C.hair }}
    >
      {cells.map((cell, i) => (
        <View key={i} style={cellStyle(cols[i])}>
          {typeof cell === 'string' || typeof cell === 'number' ? <Text style={{ textAlign: cols[i].align ?? 'left' }}>{cell}</Text> : cell}
        </View>
      ))}
    </View>
  )
  return (
    <View>
      <View fixed style={{ flexDirection: 'row', backgroundColor: C.aqua, borderRadius: 4, paddingVertical: 5, paddingHorizontal: 7 }}>
        {cols.map((c) => (
          <Text key={c.label} style={[s.th, cellStyle(c)]}>
            {c.label}
          </Text>
        ))}
      </View>
      {groups.map((g) => (
        <View key={g.key}>
          <View wrap={false}>
            {g.head}
            {g.rows[0] ? row(g.rows[0], 0, `${g.key}-0`) : null}
          </View>
          {g.rows.slice(1).map((cells, r) => row(cells, r + 1, `${g.key}-${r + 1}`))}
        </View>
      ))}
    </View>
  )
}

function GroupHead({ title, meta, right }: { title: string; meta: string; right?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 9, paddingVertical: 5, paddingHorizontal: 7, borderBottomWidth: 1, borderBottomColor: C.teal }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.teal, marginRight: 6 }} />
      <Text style={{ fontSize: 8.8, fontWeight: 700, color: C.navy, lineHeight: 1.2 }}>{title}</Text>
      <Text style={{ fontSize: 7, color: C.soft, marginLeft: 8, lineHeight: 1.2 }}>{meta}</Text>
      <View style={{ flex: 1 }} />
      {right}
    </View>
  )
}

// ── Document ────────────────────────────────────────────────────────────────

export function SummaryDocument({ college, student, activities, scopeLabel, generatedAt }: ActivityRecordProps) {
  const who = `${student.name}${student.rollNumber ? ` · ${student.rollNumber}` : ''}`
  const total = activities.length
  const counts = emptyCounts()
  activities.forEach((a) => counts[a.submission.status]++)
  const dates = activities.map((a) => a.submission.activityDate).filter(Boolean).sort()
  const generated = new Date(generatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

  // Departments
  const deptMap = new Map<string, { name: string; counts: StatusCounts; skills: Set<string>; total: number }>()
  for (const a of activities) {
    const d = deptMap.get(a.departmentName) ?? { name: a.departmentName, counts: emptyCounts(), skills: new Set<string>(), total: 0 }
    d.counts[a.submission.status]++
    d.total++
    d.skills.add(`${a.submission.templateId}:${a.submission.nodeId}`)
    deptMap.set(a.departmentName, d)
  }
  const depts = [...deptMap.values()].sort((x, y) => y.total - x.total || x.name.localeCompare(y.name))

  // Skills
  type SkillRow = { title: string; log: string; dept: string; items: ExportActivity[] }
  const skillMap = new Map<string, SkillRow>()
  for (const a of activities) {
    const key = `${a.submission.templateId}:${a.submission.nodeId}`
    const row = skillMap.get(key) ?? { title: decodeEntities(a.submission.nodeTitle), log: decodeEntities(a.templateTitle), dept: a.departmentName, items: [] }
    row.items.push(a)
    skillMap.set(key, row)
  }
  const skills = [...skillMap.values()]
  const approvedOf = (items: ExportActivity[]) => items.filter((i) => i.submission.status === 'approved').length
  const latest = (items: ExportActivity[]) => [...items].sort((p, q) => (q.submission.activityDate || '').localeCompare(p.submission.activityDate || ''))[0]
  const bestLevel = (items: ExportActivity[]): CompetencyLevel | null =>
    items
      .filter((i) => i.submission.status === 'approved' && i.submission.competencyLevel)
      .map((i) => i.submission.competencyLevel as CompetencyLevel)
      .sort((p, q) => LEVEL_RANK[q] - LEVEL_RANK[p])[0] ?? null
  const skillsApproved = skills.filter((k) => approvedOf(k.items) > 0).length

  // Competency reached on approved activities, and attempt types
  const levelCounts: Record<CompetencyLevel, number> = { O: 0, A: 0, P: 0, I: 0 }
  activities.forEach((a) => {
    if (a.submission.status === 'approved' && a.submission.competencyLevel) levelCounts[a.submission.competencyLevel as CompetencyLevel]++
  })
  const levelTotal = Object.values(levelCounts).reduce((x, y) => x + y, 0)
  const attempts: Record<string, number> = { first: 0, repeat: 0, remedial: 0 }
  activities.forEach((a) => {
    if (a.submission.attemptType) attempts[a.submission.attemptType] = (attempts[a.submission.attemptType] ?? 0) + 1
  })

  // Months for the activity log
  const monthMap = new Map<string, ExportActivity[]>()
  activities.forEach((a) => {
    const k = (a.submission.activityDate || '').slice(0, 7) || 'undated'
    monthMap.set(k, [...(monthMap.get(k) ?? []), a])
  })
  const monthLabel = (k: string) => (k === 'undated' ? 'Undated' : new Date(`${k}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }))
  const indexOf = new Map(activities.map((a, i) => [a, i]))

  const kpis: { label: string; value: string; sub: string; color: string }[] = [
    { label: 'Activities logged', value: String(total), sub: plural(depts.length, 'department'), color: C.teal },
    { label: 'Approved', value: String(counts.approved), sub: total ? `${pct(counts.approved, total)}% of logged` : '—', color: STATUS.approved.bar },
    { label: 'Awaiting review', value: String(counts.submitted), sub: 'with faculty / HOD', color: STATUS.submitted.bar },
    { label: 'Needs action', value: String(counts.revisionRequested + counts.rejected), sub: `${counts.revisionRequested} revision · ${counts.rejected} rejected`, color: STATUS.revisionRequested.bar },
    { label: 'Skills covered', value: String(skills.length), sub: `${skillsApproved} with an approval`, color: C.sky },
    { label: 'Period', value: dates.length ? fmtDate(dates[0]) : '—', sub: dates.length ? `to ${fmtDate(dates[dates.length - 1])}` : '', color: C.navy },
  ]

  const BAND = 86
  return (
    <Document title={`${student.name} — Activity Summary`} author={student.name} subject={`Clinical skills logbook summary · ${college.name}`} creator="USOP" producer="USOP" language="en-IN">
      {/* ── 01 Overview ─────────────────────────────────────────────── */}
      <Page size="A4" style={s.page} bookmark={{ title: '01 Overview', fit: true }}>
        <PdfFooter left={who} top={H - 36} side={SIDE} />
        <View style={{ marginHorizontal: -SIDE, marginTop: -TOP, height: BAND }}>
          <Svg width={W} height={BAND} style={{ position: 'absolute', top: 0, left: 0 }}>
            <Defs>
              <LinearGradient id="sband" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={C.navy} />
                <Stop offset="0.55" stopColor={C.tealDeep} />
                <Stop offset="1" stopColor={C.teal} />
              </LinearGradient>
            </Defs>
            <Rect x={0} y={0} width={W} height={BAND} fill="url(#sband)" />
            <Polyline points={ecgPoints(W, 66, 20)} stroke={C.tealMid} strokeWidth={1.1} fill="none" strokeOpacity={0.5} />
            <Rect x={0} y={BAND - 3} width={W} height={3} fill={C.tealMid} />
          </Svg>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: SIDE, paddingTop: 19 }}>
            <Emblem size={38} onDark />
            <View style={{ marginLeft: 11, flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: 800, color: C.white, lineHeight: 1.2 }}>{college.name}</Text>
              <Text style={{ fontSize: 7.5, color: '#CCFBF1', marginTop: 2 }}>{[college.city, college.state].filter(Boolean).join(', ')}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 6.6, fontWeight: 600, letterSpacing: 1.4, textTransform: 'uppercase', color: '#99F6E4' }}>Logbook summary</Text>
              <Text style={{ fontSize: 13, fontWeight: 800, color: C.white, marginTop: 2, lineHeight: 1.2 }}>{student.name}</Text>
              <Text style={{ fontSize: 7.5, color: '#CCFBF1', marginTop: 1 }}>
                {[student.rollNumber, student.mbbsYear ? `MBBS Year ${student.mbbsYear}` : ''].filter(Boolean).join('  ·  ')}
              </Text>
            </View>
          </View>
        </View>

        {/* Title + contents */}
        <View style={{ marginTop: 14 }}>
          <View>
            <Text style={{ fontSize: 7, fontWeight: 700, letterSpacing: 1.4, textTransform: 'uppercase', color: C.teal }}>MBBS · Clinical skills logbook</Text>
            <Text style={{ fontSize: 18, fontWeight: 800, color: C.navy, marginTop: 1, lineHeight: 1.2 }}>Activity Summary</Text>
            <Text style={{ fontSize: 7.3, color: C.soft, marginTop: 1 }}>{`${scopeLabel} · Generated ${generated}`}</Text>
          </View>
          <View style={{ flexDirection: 'row', marginTop: 8 }}>
            {SECTIONS.map((sec, i) => (
              <Link key={sec.id} src={`#${sec.id}`} style={{ textDecoration: 'none' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginLeft: i ? 6 : 0, borderWidth: 0.75, borderColor: i ? C.line : C.teal, backgroundColor: i ? C.white : C.aqua, borderRadius: 10, paddingVertical: 3.5, paddingHorizontal: 8 }}>
                  <Text style={{ fontSize: 7, fontWeight: 800, color: C.teal, marginRight: 4, lineHeight: 1.2 }}>{sec.no}</Text>
                  <Text style={{ fontSize: 7, fontWeight: 600, color: C.navy, lineHeight: 1.2 }}>{sec.title}</Text>
                </View>
              </Link>
            ))}
          </View>
        </View>

        {/* KPIs */}
        <View id="overview" style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 12 }}>
          {kpis.map((k, i) => (
            <View key={k.label} style={[s.box, { width: '32%', marginLeft: i % 3 ? '2%' : 0, marginTop: i >= 3 ? 7 : 0, overflow: 'hidden' }]}>
              <View style={{ height: 3, backgroundColor: k.color }} />
              <View style={{ paddingVertical: 6, paddingHorizontal: 9 }}>
                <Text style={s.label}>{k.label}</Text>
                <Text style={{ fontSize: k.label === 'Period' ? 10 : 17, fontWeight: 800, color: C.navy, marginTop: k.label === 'Period' ? 4 : 1, lineHeight: 1.15 }}>{k.value}</Text>
                <Text style={{ fontSize: 6.4, color: C.soft, marginTop: 1 }}>{k.sub}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Departments */}
        <View style={{ marginTop: 10 }}>
          <Card title="By department" right={plural(depts.length, 'department')}>
            <View style={{ flexDirection: 'row', backgroundColor: C.aqua, borderRadius: 4, paddingVertical: 4.5, paddingHorizontal: 6 }}>
              <Text style={[s.th, { flex: 1 }]}>Department</Text>
              <Text style={[s.th, { width: 38, textAlign: 'right' }]}>Logged</Text>
              <Text style={[s.th, { width: 46, textAlign: 'right' }]}>Approved</Text>
              <Text style={[s.th, { width: 44, textAlign: 'right' }]}>Pending</Text>
              <Text style={[s.th, { width: 48, textAlign: 'right' }]}>Action</Text>
              <Text style={[s.th, { width: 34, textAlign: 'right' }]}>Skills</Text>
              <Text style={[s.th, { width: 112, paddingLeft: 12 }]}>Approval rate</Text>
            </View>
            {depts.map((d, r) => (
              <View key={d.name} wrap={false} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingHorizontal: 6, backgroundColor: r % 2 ? C.aquaSoft : C.white, borderBottomWidth: 0.5, borderBottomColor: C.hair }}>
                <Text style={{ flex: 1, fontWeight: 600, color: C.navy }}>{d.name}</Text>
                <Text style={{ width: 38, textAlign: 'right', fontWeight: 700, color: C.navy }}>{d.total}</Text>
                <Text style={{ width: 46, textAlign: 'right', fontWeight: 600, color: STATUS.approved.color }}>{d.counts.approved}</Text>
                <Text style={{ width: 44, textAlign: 'right', color: d.counts.submitted ? STATUS.submitted.color : C.faint }}>{d.counts.submitted}</Text>
                <Text style={{ width: 48, textAlign: 'right', color: d.counts.revisionRequested + d.counts.rejected ? STATUS.revisionRequested.color : C.faint }}>
                  {d.counts.revisionRequested + d.counts.rejected}
                </Text>
                <Text style={{ width: 34, textAlign: 'right', color: C.soft }}>{d.skills.size}</Text>
                <View style={{ width: 112, paddingLeft: 12 }}>
                  <Bar value={d.counts.approved} total={d.total} color={STATUS.approved.bar} />
                </View>
              </View>
            ))}
            <Text style={{ fontSize: 6.3, color: C.faint, marginTop: 5 }}>Pending = awaiting review · Action = revision requested + rejected.</Text>
          </Card>

        </View>

        {/* Status mix · competency · attempts, side by side */}
        <View wrap={false} style={{ flexDirection: 'row', marginTop: 10, alignItems: 'stretch' }}>
            <Card title="Status mix" right={String(total)} style={{ flex: 1.15 }}>
              <View style={{ flexDirection: 'row', height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: C.hair, marginBottom: 7 }}>
                {STATUS_ORDER.filter((st) => counts[st]).map((st) => (
                  <View key={st} style={{ flex: counts[st], backgroundColor: STATUS[st].bar }} />
                ))}
              </View>
              {STATUS_ORDER.filter((st) => st !== 'draft' || counts.draft).map((st) => (
                <View key={st} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2.5 }}>
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: STATUS[st].bar, marginRight: 6 }} />
                  <Text style={{ flex: 1, fontSize: 7.4, color: C.text }}>{STATUS[st].label}</Text>
                  <Text style={{ width: 24, textAlign: 'right', fontSize: 7.4, fontWeight: 700, color: C.navy }}>{counts[st]}</Text>
                  <Text style={{ width: 30, textAlign: 'right', fontSize: 7, color: C.faint }}>{`${pct(counts[st], total)}%`}</Text>
                </View>
              ))}
            </Card>

            <Card title="Competency" right="approved" style={{ flex: 1.3, marginLeft: 8 }}>
              {(['I', 'P', 'A', 'O'] as CompetencyLevel[]).map((lv) => (
                <View key={lv} style={{ flexDirection: 'row', alignItems: 'center', marginTop: lv === 'I' ? 0 : 4.5 }}>
                  <LevelBadge level={lv} size={11} />
                  <Text style={{ width: 54, fontSize: 6.8, color: C.text, marginLeft: 5 }}>{LEVEL_SHORT[lv]}</Text>
                  <View style={{ flex: 1 }}>
                    <Bar value={levelCounts[lv]} total={levelTotal} color={C.teal} width={24} />
                  </View>
                  <Text style={{ width: 16, textAlign: 'right', fontSize: 7.2, fontWeight: 700, color: C.navy }}>{levelCounts[lv]}</Text>
                </View>
              ))}
            </Card>

            <Card title="Attempts" style={{ flex: 0.75, marginLeft: 8 }}>
              {(['first', 'repeat', 'remedial'] as const).map((k, i) => (
                <View key={k} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 3, borderTopWidth: i ? 0.5 : 0, borderTopColor: C.hair }}>
                  <Text style={{ flex: 1, fontSize: 7.4, color: C.text }}>{ATTEMPT_SHORT[k]}</Text>
                  <Text style={{ fontSize: 11, fontWeight: 800, color: C.navy, lineHeight: 1.15 }}>{attempts[k] ?? 0}</Text>
                </View>
              ))}
            </Card>
        </View>
      </Page>

      {/* ── 02 Skills by department ─────────────────────────────────── */}
      <Page size="A4" style={s.page} bookmark={{ title: '02 Skills by department', fit: true }}>
        <RunningHeader college={college.name} section={SECTIONS[1]} student={who} />
        <PdfFooter left={who} top={H - 36} side={SIDE} />
        <SectionTitle
          section={SECTIONS[1]}
          sub={`${plural(skills.length, 'distinct skill')} across ${plural(depts.length, 'department')} · ${skillsApproved} approved at least once`}
        />
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: -3, marginBottom: 9 }}>
          <Text style={{ fontSize: 6.4, color: C.faint, marginRight: 2 }}>Best level reached:</Text>
          {(['O', 'A', 'P', 'I'] as CompetencyLevel[]).map((lv) => (
            <View key={lv} style={{ flexDirection: 'row', alignItems: 'center', marginLeft: 7 }}>
              <LevelBadge level={lv} size={10} />
              <Text style={{ fontSize: 6.4, color: C.soft, marginLeft: 3 }}>{LEVEL[lv]}</Text>
            </View>
          ))}
        </View>
        <GroupedTable
          cols={[
            { label: 'Skill', flex: 1 },
            { label: 'Logged', width: 36, align: 'right' },
            { label: 'Appr.', width: 32, align: 'right' },
            { label: 'Approval rate', width: 76 },
            { label: 'Best', width: 30, align: 'center' },
            { label: 'Last logged', width: 58 },
            { label: 'Latest status', width: 86 },
          ]}
          groups={depts.map((d) => {
            const rows = skills
              .filter((k) => k.dept === d.name)
              .sort((x, y) => y.items.length - x.items.length || x.title.localeCompare(y.title))
            return {
              key: d.name,
              head: (
                <GroupHead
                  title={d.name}
                  meta={`${plural(rows.length, 'skill')} · ${plural(d.total, 'activity', 'activities')} · ${d.counts.approved} approved`}
                  right={
                    <View style={{ width: 90 }}>
                      <Bar value={d.counts.approved} total={d.total} color={STATUS.approved.bar} />
                    </View>
                  }
                />
              ),
              rows: rows.map((k) => {
                const last = latest(k.items)
                const best = bestLevel(k.items)
                const ok = approvedOf(k.items)
                return [
                  <View>
                    <Text style={{ fontWeight: 600, color: C.navy }}>{k.title}</Text>
                    {k.log ? <Text style={{ fontSize: 6.6, color: C.faint, lineHeight: 1.25 }}>{k.log}</Text> : null}
                  </View>,
                  <Text style={{ textAlign: 'right', fontWeight: 700, color: C.navy }}>{k.items.length}</Text>,
                  <Text style={{ textAlign: 'right', fontWeight: 600, color: ok ? STATUS.approved.color : C.faint }}>{ok}</Text>,
                  <Bar value={ok} total={k.items.length} color={STATUS.approved.bar} />,
                  best ? (
                    <View style={{ alignItems: 'center' }}>
                      <LevelBadge level={best} />
                    </View>
                  ) : (
                    <Text style={{ textAlign: 'center', color: C.faint }}>—</Text>
                  ),
                  <Text style={{ color: C.soft }}>{fmtDate(last.submission.activityDate)}</Text>,
                  <View style={{ flexDirection: 'row' }}>
                    <StatusPill status={last.submission.status} small />
                  </View>,
                ]
              }),
            }
          })}
        />
      </Page>

      {/* ── 03 Activity log ─────────────────────────────────────────── */}
      <Page size="A4" style={s.page} bookmark={{ title: '03 Activity log', fit: true }}>
        <RunningHeader college={college.name} section={SECTIONS[2]} student={who} />
        <PdfFooter left={who} top={H - 36} side={SIDE} />
        <SectionTitle
          section={SECTIONS[2]}
          sub={`${plural(total, 'activity', 'activities')} in date order, grouped by month${dates.length ? ` · ${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}` : ''}`}
        />
        <GroupedTable
          cols={[
            { label: '#', width: 18 },
            { label: 'Date', width: 42 },
            { label: 'Skill · department', flex: 1 },
            { label: 'Attempt', width: 42 },
            { label: 'Status', width: 86 },
            { label: 'Reviewed by', width: 92 },
            { label: 'Level', width: 26, align: 'center' },
            { label: 'Rating', width: 28, align: 'right' },
          ]}
          groups={[...monthMap.entries()].map(([k, items]) => {
            const ok = approvedOf(items)
            return {
              key: k,
              head: <GroupHead title={monthLabel(k)} meta={`${plural(items.length, 'activity', 'activities')} · ${ok} approved`} />,
              rows: items.map((a) => {
                const sub = a.submission
                const decided = sub.status === 'approved' || sub.status === 'rejected' || sub.status === 'revisionRequested'
                const reviewer = decided ? (a.reviewerName ?? a.assignedFacultyName) : a.assignedFacultyName
                const role = decided && a.reviewerRole === 'hod' ? 'HOD' : 'Faculty'
                return [
                  <Text style={{ color: C.faint, fontWeight: 600 }}>{pad2((indexOf.get(a) ?? 0) + 1)}</Text>,
                  <Text style={{ color: C.soft }}>{k === 'undated' ? '—' : fmtDate(sub.activityDate).replace(/\s\d{4}$/, '')}</Text>,
                  <View>
                    <Text style={{ fontWeight: 600, color: C.navy }}>{decodeEntities(sub.nodeTitle)}</Text>
                    <Text style={{ fontSize: 6.6, color: C.faint, lineHeight: 1.25 }}>{a.departmentName}</Text>
                  </View>,
                  <Text style={{ color: C.soft }}>{sub.attemptType ? ATTEMPT_SHORT[sub.attemptType] : '—'}</Text>,
                  <View style={{ flexDirection: 'row' }}>
                    <StatusPill status={sub.status} small />
                  </View>,
                  reviewer ? (
                    <View>
                      <Text style={{ color: C.text }}>{reviewer}</Text>
                      <Text style={{ fontSize: 6.6, color: C.faint, lineHeight: 1.25 }}>{decided ? role : 'Assigned'}</Text>
                    </View>
                  ) : (
                    <Text style={{ color: C.faint }}>—</Text>
                  ),
                  decided && sub.competencyLevel ? (
                    <View style={{ alignItems: 'center' }}>
                      <LevelBadge level={sub.competencyLevel as CompetencyLevel} size={12} />
                    </View>
                  ) : (
                    <Text style={{ textAlign: 'center', color: C.faint }}>—</Text>
                  ),
                  <Text style={{ textAlign: 'right', fontWeight: 600, color: C.navy }}>{decided && sub.facultyRating != null ? `${sub.facultyRating}/5` : '—'}</Text>,
                ]
              }),
            }
          })}
        />
      </Page>
    </Document>
  )
}

export async function renderActivitySummaryPdf(props: ActivityRecordProps): Promise<Blob> {
  registerPdfFonts()
  return pdf(SummaryDocument(props)).toBlob()
}
