import { Defs, Document, Image, Line, LinearGradient, Link, Page, Polyline, Rect, Stop, StyleSheet, Svg, Text, View, pdf } from '@react-pdf/renderer'
import { registerPdfFonts } from './pdfFonts'
import { decodeEntities, htmlToPdf } from './htmlToPdf'
import type { Submission, SubmissionStatus } from '../../../types'
import { ATTEMPT, C, Emblem, LEVEL, PdfFooter, RatingDots, STATUS, StatusPill, VERB, ecgPoints, fmtDate, fmtMs, initials, pad2 } from './pdfTheme'

// The student's "Activity Record" PDF, laid out by @react-pdf/renderer in a
// clinical palette — deep teal + navy on white, soft aqua tints, standard
// clinical status colours, Inter type. Cover page (college band with an ECG
// motif, student details, summary tiles, clickable contents), then each
// activity starting on its own page; long activities flow onto further pages
// with the running header/footer repeated, never shrunk. Each activity is a
// PDF bookmark. Fixed print colours, independent of the app's theme.
// Keep this file free of browser-only APIs — the caller sanitises HTML.

export type ExportCollege = { name: string; city: string; state: string; type: string }
export type ExportStudent = { name: string; rollNumber: string; mbbsYear: number | null; email: string; phone: string }
export type ExportActivity = {
  submission: Submission
  departmentName: string
  templateTitle: string
  path: string[]
  assignedFacultyName: string | null
  reviewerName: string | null
  reviewerRole: 'faculty' | 'hod' | null
  images: { kind: 'photo' | 'sketch'; src: string }[] // data URLs, downloaded + downscaled by the caller
}
export type ActivityRecordProps = {
  college: ExportCollege
  student: ExportStudent
  activities: ExportActivity[]
  scopeLabel: string
  generatedAt: number
}

const PAGE_W = 595.28
const s = StyleSheet.create({
  page: { paddingTop: 84, paddingBottom: 54, paddingHorizontal: 44, fontFamily: 'Inter', fontSize: 9, color: C.text, lineHeight: 1.5 },
  cover: { paddingTop: 0, paddingBottom: 60, paddingHorizontal: 44, fontFamily: 'Inter', fontSize: 9, color: C.text, lineHeight: 1.5 },
  label: { fontSize: 6.6, fontWeight: 600, letterSpacing: 0.9, textTransform: 'uppercase', color: C.soft, lineHeight: 1.3 },
  h: { fontWeight: 700, color: C.navy, lineHeight: 1.25 },
  box: { borderWidth: 0.75, borderColor: C.line, borderRadius: 6 },
  pill: { borderRadius: 9, paddingVertical: 2.5, paddingHorizontal: 8 },
})

/* ---------------------------------------------------------------- */
/* Shared pieces                                                     */
/* ---------------------------------------------------------------- */

function RunningHeader({ college, right }: { college: ExportCollege; right: string }) {
  const place = [college.city, college.state].filter(Boolean).join(', ')
  return (
    <View fixed style={{ position: 'absolute', top: 0, left: 0, right: 0 }}>
      <Svg width={PAGE_W} height={6}>
        <Defs>
          <LinearGradient id="rh" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0" stopColor={C.navy} />
            <Stop offset="0.6" stopColor={C.tealDeep} />
            <Stop offset="1" stopColor={C.tealMid} />
          </LinearGradient>
        </Defs>
        <Rect x={0} y={0} width={PAGE_W} height={6} fill="url(#rh)" />
      </Svg>
      <View style={{ marginTop: 14, marginHorizontal: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
          <Emblem size={26} />
          <View style={{ marginLeft: 9, flex: 1 }}>
            <Text style={[s.h, { fontSize: 10.5 }]}>{college.name}</Text>
            {place ? <Text style={{ fontSize: 7, color: C.soft }}>{place}</Text> : null}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={s.label}>Activity record</Text>
          <View style={[s.pill, { backgroundColor: C.aqua, marginTop: 3 }]}>
            <Text style={{ fontSize: 7.5, fontWeight: 700, color: C.teal, lineHeight: 1.2 }}>{right}</Text>
          </View>
        </View>
      </View>
      <View style={{ height: 0.75, backgroundColor: C.line, marginTop: 10, marginHorizontal: 44 }} />
    </View>
  )
}

function SectionHead({ title, right }: { title: string; right?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8, marginBottom: 5 }}>
      <View style={{ width: 3, height: 10, backgroundColor: C.teal, borderRadius: 1.5, marginRight: 6 }} />
      <Text style={{ fontSize: 7.6, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: C.navy }}>{title}</Text>
      <View style={{ flex: 1, height: 0.75, backgroundColor: C.hair, marginLeft: 8 }} />
      {right ? <Text style={{ fontSize: 7, color: C.faint, marginLeft: 8 }}>{right}</Text> : null}
    </View>
  )
}

/* ---------------------------------------------------------------- */
/* Cover                                                             */
/* ---------------------------------------------------------------- */

function Cover({ college, student, activities, scopeLabel, generatedAt }: ActivityRecordProps) {
  const dates = activities.map((a) => a.submission.activityDate).filter(Boolean).sort()
  const count = (st: SubmissionStatus) => activities.filter((a) => a.submission.status === st).length
  const depts = new Set(activities.map((a) => a.departmentName)).size
  const place = [college.type, [college.city, college.state].filter(Boolean).join(', ')].filter(Boolean).join('  ·  ')
  const left = `${student.name}${student.rollNumber ? ` · ${student.rollNumber}` : ''}`
  const BAND = 170
  const approved = count('approved')

  const stats: { label: string; value: string; color: string; sub: string; small?: boolean }[] = [
    { label: 'Activities', value: String(activities.length), color: C.teal, sub: `${depts} department${depts === 1 ? '' : 's'}` },
    { label: 'Approved', value: String(approved), color: STATUS.approved.bar, sub: activities.length ? `${Math.round((approved / activities.length) * 100)}% of logged` : '—' },
    { label: 'In review', value: String(count('submitted') + count('revisionRequested')), color: STATUS.submitted.bar, sub: 'awaiting or revising' },
    { label: 'Period', value: dates.length ? fmtDate(dates[0]) : '—', color: C.sky, sub: dates.length ? `to ${fmtDate(dates[dates.length - 1])}` : '', small: true },
  ]

  return (
    <Page size="A4" style={s.cover} bookmark={{ title: 'Cover & contents', fit: true }}>
      <PdfFooter left={left} top={803} side={44} />

      {/* College band */}
      <View style={{ marginHorizontal: -44, height: BAND }}>
        <Svg width={PAGE_W} height={BAND} style={{ position: 'absolute', top: 0, left: 0 }}>
          <Defs>
            <LinearGradient id="band" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={C.navy} />
              <Stop offset="0.55" stopColor={C.tealDeep} />
              <Stop offset="1" stopColor={C.teal} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={PAGE_W} height={BAND} fill="url(#band)" />
          <Polyline points={ecgPoints(PAGE_W, 132, 30)} stroke={C.tealMid} strokeWidth={1.3} fill="none" strokeOpacity={0.6} />
          <Line x1={0} y1={BAND - 2} x2={PAGE_W} y2={BAND - 2} stroke={C.tealMid} strokeWidth={4} />
        </Svg>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 44, paddingTop: 34 }}>
          <Emblem size={52} onDark />
          <View style={{ marginLeft: 14, flex: 1 }}>
            <Text style={{ fontSize: 7, fontWeight: 600, letterSpacing: 1.6, textTransform: 'uppercase', color: '#99F6E4' }}>Medical college</Text>
            <Text style={{ fontSize: 20, fontWeight: 800, color: C.white, marginTop: 3, lineHeight: 1.2 }}>{college.name}</Text>
            {place ? <Text style={{ fontSize: 8.2, color: '#CCFBF1', marginTop: 3 }}>{place}</Text> : null}
          </View>
        </View>
      </View>

      {/* Title */}
      <View style={{ marginTop: 22, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 7.5, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase', color: C.teal }}>MBBS · Clinical skills logbook</Text>
          <Text style={[s.h, { fontSize: 24, marginTop: 4 }]}>Record of Logged Activities</Text>
          <Text style={{ fontSize: 8.5, color: C.soft, marginTop: 4 }}>{scopeLabel}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={s.label}>Generated</Text>
          <Text style={{ fontSize: 8.5, fontWeight: 600, color: C.navy, marginTop: 2 }}>
            {new Date(generatedAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
          </Text>
        </View>
      </View>

      {/* Student details */}
      <View style={[s.box, { marginTop: 16, overflow: 'hidden' }]}>
        <View style={{ backgroundColor: C.aqua, paddingVertical: 6, paddingHorizontal: 12 }}>
          <Text style={[s.label, { color: C.teal }]}>Student details</Text>
        </View>
        <View style={{ flexDirection: 'row', padding: 12 }}>
          <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
            <Text style={{ fontSize: 15, fontWeight: 700, color: C.white }}>{initials(student.name)}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.h, { fontSize: 14 }]}>{student.name}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
              {(
                [
                  ['Register no.', student.rollNumber || '—', true],
                  ['Course', student.mbbsYear ? `MBBS · Year ${student.mbbsYear}` : 'MBBS', false],
                  ['Email', student.email || '—', false],
                  ['Phone', student.phone ? `+91 ${student.phone}` : '—', false],
                ] as const
              ).map(([label, value, strong]) => (
                <View key={label} style={{ width: '50%', paddingVertical: 3.5, paddingRight: 10 }}>
                  <Text style={s.label}>{label}</Text>
                  <Text style={{ fontSize: 9, color: strong ? C.teal : C.text, fontWeight: strong ? 700 : 500, marginTop: 1 }}>{value}</Text>
                </View>
              ))}
            </View>
          </View>
        </View>
      </View>

      {/* Summary tiles */}
      <View style={{ flexDirection: 'row', marginTop: 12 }}>
        {stats.map((st, i) => (
          <View key={st.label} style={[s.box, { flex: 1, marginLeft: i ? 8 : 0, overflow: 'hidden' }]}>
            <View style={{ height: 3, backgroundColor: st.color }} />
            <View style={{ paddingVertical: 8, paddingHorizontal: 10 }}>
              <Text style={s.label}>{st.label}</Text>
              <Text style={{ fontSize: st.small ? 10.5 : 19, fontWeight: 800, color: C.navy, marginTop: st.small ? 5 : 2, lineHeight: 1.15 }}>{st.value}</Text>
              {st.sub ? <Text style={{ fontSize: 6.8, color: C.soft, marginTop: 2 }}>{st.sub}</Text> : null}
            </View>
          </View>
        ))}
      </View>

      {/* Contents */}
      <SectionHead title="Contents" right="Select a row to open the activity" />
      <View>
        <View fixed style={{ flexDirection: 'row', backgroundColor: C.aqua, borderRadius: 4, paddingVertical: 5.5, paddingHorizontal: 8 }}>
          <Text style={[s.label, { width: 22, color: C.teal }]}>#</Text>
          <Text style={[s.label, { width: 64, color: C.teal }]}>Date</Text>
          <Text style={[s.label, { flex: 1, color: C.teal }]}>Skill</Text>
          <Text style={[s.label, { width: 108, color: C.teal }]}>Department</Text>
          <Text style={[s.label, { width: 92, color: C.teal }]}>Status</Text>
        </View>
        {activities.map((a, i) => (
          <Link key={a.submission.id} src={`#act-${i + 1}`} style={{ textDecoration: 'none', color: C.text }}>
            <View
              wrap={false}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                paddingVertical: 4.5,
                paddingHorizontal: 8,
                backgroundColor: i % 2 ? C.aquaSoft : C.white,
                borderBottomWidth: 0.5,
                borderBottomColor: C.hair,
              }}
            >
              <Text style={{ width: 22, fontSize: 7.6, color: C.faint, fontWeight: 600 }}>{pad2(i + 1)}</Text>
              <Text style={{ width: 64, fontSize: 7.6, color: C.soft }}>{fmtDate(a.submission.activityDate)}</Text>
              <Text style={{ flex: 1, fontSize: 8.2, color: C.navy, fontWeight: 500, paddingRight: 6 }}>{decodeEntities(a.submission.nodeTitle)}</Text>
              <Text style={{ width: 108, fontSize: 7.6, color: C.soft, paddingRight: 6 }}>{a.departmentName}</Text>
              <View style={{ width: 92, flexDirection: 'row' }}>
                <StatusPill status={a.submission.status} small />
              </View>
            </View>
          </Link>
        ))}
      </View>

      <Text style={{ fontSize: 7, color: C.faint, textAlign: 'center', marginTop: 14 }}>
        Reproduced from the USOP digital logbook exactly as recorded and reviewed on the platform.
      </Text>
    </Page>
  )
}

/* ---------------------------------------------------------------- */
/* One activity                                                      */
/* ---------------------------------------------------------------- */

function ActivityPage({ a, index, total, college, student }: { a: ExportActivity; index: number; total: number; college: ExportCollege; student: ExportStudent }) {
  const sub = a.submission
  const st = STATUS[sub.status]
  const title = decodeEntities(sub.nodeTitle)
  const decided = sub.status === 'approved' || sub.status === 'rejected' || sub.status === 'revisionRequested'
  const reviewer = decided ? (a.reviewerName ?? a.assignedFacultyName) : a.assignedFacultyName
  const role = decided ? (a.reviewerRole ?? 'faculty') : 'faculty'
  const roleLabel = `${role === 'hod' ? 'Head of Department' : 'Faculty'} · ${a.departmentName}`
  const hodOverride = decided && a.reviewerRole === 'hod' && a.assignedFacultyName && a.reviewerName !== a.assignedFacultyName
  const description = sub.description ?? '' // sanitised by the caller
  const hasDescription = description.replace(/<[^>]*>/g, '').trim().length > 0
  const photos = a.images.filter((i) => i.kind === 'photo')
  const sketches = a.images.filter((i) => i.kind === 'sketch')
  // Photos and the sketch share ONE compact row (photos ~⅔, sketch ~⅓) so a
  // typical activity fits on a single A4 page. All photos sit side by side
  // in that row (tested: two short rows made 5 photos tiny).
  const ROW_H = 100
  const hasSketch = sketches.length > 0
  const photoCols = Math.max(1, photos.length)
  const photoRowsCount = 1
  const thumbH = ROW_H - 12
  const photoW = `${(100 - (photoCols - 1) * 2) / photoCols}%`
  const photoFlex = hasSketch ? (photos.length >= 4 ? 2.4 : 2) : 1
  const left = `${student.name}${student.rollNumber ? ` · ${student.rollNumber}` : ''}`
  const notes = (
    [
      ['Feedback', sub.facultyFeedback],
      ['Remarks', sub.facultyRemarks],
    ] as const
  ).filter(([, t]) => !!t)

  return (
    <Page size="A4" style={s.page} bookmark={{ title: `${pad2(index + 1)}. ${title}`, fit: true }}>
      <RunningHeader college={college} right={`Activity ${pad2(index + 1)} / ${pad2(total)}`} />
      <PdfFooter left={left} top={803} side={44} />

      {/* Title card, with a status-coloured edge */}
      <View id={`act-${index + 1}`} wrap={false} style={[s.box, { flexDirection: 'row', overflow: 'hidden' }]}>
        <View style={{ width: 4, backgroundColor: st.bar }} />
        <View style={{ flex: 1, paddingVertical: 8, paddingHorizontal: 12 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', flex: 1, paddingRight: 10 }}>
              <View style={[s.pill, { backgroundColor: C.skyTint, marginRight: 5, marginBottom: 3 }]}>
                <Text style={{ fontSize: 7, fontWeight: 700, color: C.sky, lineHeight: 1.2 }}>{a.departmentName}</Text>
              </View>
              {a.templateTitle ? (
                <View style={[s.pill, { backgroundColor: C.aqua, marginBottom: 3 }]}>
                  <Text style={{ fontSize: 7, fontWeight: 600, color: C.teal, lineHeight: 1.2 }}>{decodeEntities(a.templateTitle)}</Text>
                </View>
              ) : null}
            </View>
            <StatusPill status={sub.status} />
          </View>
          <Text style={[s.h, { fontSize: 14.5, marginTop: 4 }]}>{title}</Text>
          {a.path.length > 0 ? <Text style={{ fontSize: 7.6, color: C.soft, marginTop: 4 }}>{[...a.path.map(decodeEntities), title].join('  ›  ')}</Text> : null}
        </View>
      </View>

      {/* Key facts */}
      <View wrap={false} style={{ flexDirection: 'row', marginTop: 8 }}>
        {(
          [
            [sub.mbbsYear ? `Activity date · Year ${sub.mbbsYear}` : 'Activity date', fmtDate(sub.activityDate)],
            ['Attempt', sub.attemptType ? ATTEMPT[sub.attemptType] : '—'],
            ['Submitted', fmtMs(sub.submittedAt)],
            ['Reviewed', decided ? fmtMs(sub.reviewedAt) : '—'],
          ] as const
        ).map(([label, value], i) => (
          <View
            key={label}
            style={{ flex: 1, marginLeft: i ? 6 : 0, backgroundColor: C.aquaSoft, borderRadius: 5, borderWidth: 0.6, borderColor: C.hair, paddingVertical: 4.5, paddingHorizontal: 9 }}
          >
            <Text style={s.label}>{label}</Text>
            <Text style={{ fontSize: 9.2, fontWeight: 700, color: C.navy, marginTop: 2 }}>{value}</Text>
          </View>
        ))}
      </View>

      {/* Clinical review */}
      <View wrap={false}>
        <SectionHead title="Clinical review" />
        <View style={[s.box, { paddingVertical: 8, paddingHorizontal: 10 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', flex: 1 }}>
              <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: C.aqua, alignItems: 'center', justifyContent: 'center', marginRight: 9 }}>
                <Text style={{ fontSize: 10, fontWeight: 700, color: C.teal }}>{initials(reviewer ?? '?')}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>{VERB[sub.status]}</Text>
                <Text style={[s.h, { fontSize: 11.5, marginTop: 1 }]}>{reviewer || '—'}</Text>
                <Text style={{ fontSize: 7.6, color: C.soft }}>{roleLabel}</Text>
                {hodOverride ? <Text style={{ fontSize: 7.2, color: C.soft, marginTop: 2 }}>{`Originally sent to ${a.assignedFacultyName} (Faculty)`}</Text> : null}
              </View>
            </View>
            {decided && (sub.competencyLevel || sub.facultyRating != null) ? (
              <View style={{ alignItems: 'flex-end' }}>
                {sub.competencyLevel ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 15, height: 15, borderRadius: 3, backgroundColor: C.teal, alignItems: 'center', justifyContent: 'center', marginRight: 5 }}>
                      <Text style={{ fontSize: 8, fontWeight: 800, color: C.white }}>{sub.competencyLevel}</Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={s.label}>Competency</Text>
                      <Text style={{ fontSize: 8, fontWeight: 600, color: C.navy }}>{LEVEL[sub.competencyLevel]}</Text>
                    </View>
                  </View>
                ) : null}
                {sub.facultyRating != null ? (
                  <View style={{ marginTop: 6, alignItems: 'flex-end' }}>
                    <Text style={[s.label, { marginBottom: 2 }]}>Global rating</Text>
                    <RatingDots value={sub.facultyRating} />
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
          {decided && notes.length > 0 ? (
            <View style={{ flexDirection: 'row', marginTop: 8 }}>
              {notes.map(([label, text], i) => (
                <View key={label} style={{ flex: 1, marginLeft: i ? 8 : 0, backgroundColor: C.aquaSoft, borderRadius: 5, borderLeftWidth: 2.5, borderLeftColor: C.teal, paddingVertical: 5, paddingHorizontal: 7 }}>
                  <Text style={[s.label, { color: C.teal }]}>{label}</Text>
                  <Text style={{ fontSize: 8.4, marginTop: 2, color: C.text }}>{text}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </View>

      {/* Description */}
      <SectionHead title="Activity description" />
      {hasDescription ? (
        <View style={{ fontSize: 8.5, lineHeight: 1.45 }}>{htmlToPdf(description)}</View>
      ) : (
        <Text style={{ fontSize: 8.4, color: C.faint, fontStyle: 'italic' }}>No description was written for this activity.</Text>
      )}

      {/* Attachments — one block that never splits, heading included */}
      {photos.length > 0 || hasSketch ? (
        <View wrap={false}>
          <SectionHead
            title={photos.length && hasSketch ? 'Clinical photographs & sketch' : photos.length ? 'Clinical photographs' : "Student's sketch"}
            right={photos.length ? `${photos.length} photo${photos.length === 1 ? '' : 's'}${hasSketch ? ' · 1 sketch' : ''}` : undefined}
          />
          <View style={{ flexDirection: 'row' }}>
            {photos.length > 0 ? (
              <View style={{ flex: photoFlex, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                {photos.map((p, i) => (
                  <View key={i} style={{ width: photoW, marginBottom: photoRowsCount > 1 && i < photoCols ? 6 : 0 }}>
                    <View style={[s.box, { height: thumbH, backgroundColor: '#F1F5F9', padding: 2.5, overflow: 'hidden' }]}>
                      <Image src={p.src} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                    </View>
                    <Text style={{ fontSize: 6.4, color: C.faint, marginTop: 1.5 }}>{`Fig. ${i + 1}`}</Text>
                  </View>
                ))}
                {Array.from({ length: (photoCols - (photos.length % photoCols)) % photoCols }, (_, k) => (
                  <View key={`pad-${k}`} style={{ width: photoW }} />
                ))}
              </View>
            ) : null}
            {hasSketch ? (
              <View style={{ flex: 1, marginLeft: photos.length ? 10 : 0 }}>
                <View style={[s.box, { height: ROW_H - 12, backgroundColor: C.white, padding: 3 }]}>
                  <Image src={sketches[0].src} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                </View>
                <Text style={{ fontSize: 6.4, color: C.faint, marginTop: 1.5 }}>Student's sketch</Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      {/* Signatures — compact: name in italic over a teal signature line */}
      <View wrap={false} style={{ marginTop: 10, flexDirection: 'row' }}>
        {[
          ['Logged by', student.name, `Student${student.rollNumber ? ` · ${student.rollNumber}` : ''}`],
          [
            decided ? 'Verified by' : 'Reviewer',
            decided ? (reviewer ?? '—') : 'Pending review',
            decided ? `${roleLabel}${sub.reviewedAt ? ` · ${fmtMs(sub.reviewedAt)}` : ''}` : (a.assignedFacultyName ?? ''),
          ],
        ].map(([kicker, name, role], i) => (
          <View key={i} style={{ flex: 1, marginLeft: i ? 24 : 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', borderBottomWidth: 0.9, borderBottomColor: C.teal, paddingBottom: 2 }}>
              <Text style={[s.label, { marginRight: 6, marginBottom: 1 }]}>{kicker}</Text>
              <Text style={{ fontSize: 10, fontWeight: 600, fontStyle: 'italic', color: C.navy }}>{name}</Text>
            </View>
            <Text style={{ fontSize: 6.6, color: C.soft, marginTop: 2 }}>{role}</Text>
          </View>
        ))}
      </View>
      <Text style={{ fontSize: 6, color: C.faint, textAlign: 'center', marginTop: 4 }}>Signed electronically on USOP at the time of submission and review.</Text>
    </Page>
  )
}

export function ActivityRecordDocument(props: ActivityRecordProps) {
  const { college, student, activities } = props
  return (
    <Document
      title={`${student.name} — Activity Record`}
      author={student.name}
      subject={`Clinical skills logbook · ${college.name}`}
      creator="USOP"
      producer="USOP"
      language="en-IN"
    >
      <Cover {...props} />
      {activities.map((a, i) => (
        <ActivityPage key={a.submission.id} a={a} index={i} total={activities.length} college={college} student={student} />
      ))}
    </Document>
  )
}

export async function renderActivityRecordPdf(props: ActivityRecordProps): Promise<Blob> {
  registerPdfFonts()
  // Hand react-pdf the <Document> element itself as the root.
  return pdf(ActivityRecordDocument(props)).toBlob()
}
