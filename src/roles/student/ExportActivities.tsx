import { useMemo, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import { Modal, PrimaryButton, GhostButton } from './shell/ui'
import { Icon } from '../primary-admin/shell/Icon'
import { getInstitution } from '../../lib/firestore/institutions'
import { watchTemplate, watchTreeNodes } from '../../lib/firestore/logTemplates'
import { getAppUser } from '../../lib/firestore/users'
import { useStudentDepartments } from '../../lib/enabledDepartments'
import { imageAsDataUrl } from '../../lib/submissionImages'
import { sanitizeRichText } from '../../lib/sanitizeHtml'
import type { ExportActivity } from './activityPdf/ActivityRecordPdf'
import type { Submission, TreeNode } from '../../types'

type Scope = 'approved' | 'sent'
type Format = 'full' | 'summary'

function formatIso(iso: string) {
  const d = new Date(`${iso}T00:00:00`)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

// One-shot reads built from the existing real-time watchers.
function firstSnapshot<T>(subscribe: (cb: (v: T) => void) => () => void): Promise<T> {
  return new Promise((resolve) => {
    let unsub: (() => void) | null = null
    let done = false
    unsub = subscribe((v) => {
      if (done) return
      done = true
      resolve(v)
      queueMicrotask(() => unsub?.())
    })
    if (done) unsub()
  })
}

function ancestorTitles(nodes: TreeNode[], nodeId: string): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const out: string[] = []
  let cur = byId.get(nodeId)?.parentId ?? null
  let guard = 0
  while (cur && guard++ < 50) {
    const n = byId.get(cur)
    if (!n) break
    out.unshift(n.title)
    cur = n.parentId
  }
  return out
}

// "Export activities" on My Activity: pick what to include, then build a
// cover page + one page per activity and save it as a PDF.
export function ExportActivitiesButton({
  submissions,
  facultyNames,
  templateTitles,
}: {
  submissions: Submission[] | null
  facultyNames: Record<string, string>
  templateTitles: Record<string, string>
}) {
  const { appUser } = useAuth()
  const { allDepartments } = useStudentDepartments(appUser?.institutionId ?? null, appUser?.mbbsYear ?? null)
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<Scope>('approved')
  const [format, setFormat] = useState<Format>('full')
  const [departmentId, setDepartmentId] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState('')

  const deptName = (id: string) => allDepartments.find((d) => d.id === id)?.name ?? 'Department'
  const sent = useMemo(() => (submissions ?? []).filter((s) => s.status !== 'draft'), [submissions])
  const departmentOptions = useMemo(() => {
    const ids = Array.from(new Set(sent.map((s) => s.departmentId)))
    return ids.map((id) => ({ id, name: deptName(id) })).sort((a, b) => a.name.localeCompare(b.name))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sent, allDepartments])

  const selected = useMemo(
    () =>
      sent
        .filter((s) => (scope === 'approved' ? s.status === 'approved' : true))
        .filter((s) => !departmentId || s.departmentId === departmentId)
        .filter((s) => (!fromDate || (s.activityDate || '') >= fromDate) && (!toDate || (s.activityDate || '') <= toDate))
        .sort((a, b) => (a.activityDate || '').localeCompare(b.activityDate || '') || (a.submittedAt ?? 0) - (b.submittedAt ?? 0)),
    [sent, scope, departmentId, fromDate, toDate],
  )

  const busy = progress !== null

  async function generate() {
    if (!appUser?.institutionId || selected.length === 0) return
    setError('')
    setProgress('Gathering your activities…')
    try {
      const templateIds = Array.from(new Set(selected.map((s) => s.templateId)))
      const facultyIds = Array.from(new Set(selected.map((s) => s.facultyId).filter((id) => id && !(id in facultyNames))))

      const [institution, nodeLists, titles, names] = await Promise.all([
        getInstitution(appUser.institutionId),
        Promise.all(templateIds.map((id) => firstSnapshot<TreeNode[]>((cb) => watchTreeNodes(id, cb)).then((nodes) => [id, nodes] as const))),
        Promise.all(
          templateIds.map((id) =>
            id in templateTitles
              ? Promise.resolve([id, templateTitles[id]] as const)
              : firstSnapshot<{ title: string } | null>((cb) => watchTemplate(id, cb)).then((t) => [id, t?.title ?? ''] as const),
          ),
        ),
        Promise.all(facultyIds.map((id) => getAppUser(id).then((u) => [id, u?.name ?? ''] as const).catch(() => [id, ''] as const))),
      ])
      const nodesByTemplate = Object.fromEntries(nodeLists)
      const titleByTemplate = Object.fromEntries(titles)
      const allFaculty: Record<string, string> = { ...facultyNames, ...Object.fromEntries(names) }

      // Download every image from Storage once, downscaled for print, a few
      // at a time.
      // The quick summary has no images — skip the downloads entirely.
      const allImages = format === 'full' ? selected.flatMap((s) => s.images.map((img) => ({ sid: s.id, img }))) : []
      const imageData = new Map<string, { kind: 'photo' | 'sketch'; src: string }[]>()
      let fetched = 0
      for (let i = 0; i < allImages.length; i += 6) {
        const chunk = allImages.slice(i, i + 6)
        const results = await Promise.all(chunk.map(({ img }) => imageAsDataUrl(img)))
        chunk.forEach(({ sid, img }, k) => {
          const src = results[k]
          if (src) imageData.set(sid, [...(imageData.get(sid) ?? []), { kind: img.kind, src }])
        })
        fetched += chunk.length
        setProgress(`Loading images ${fetched} of ${allImages.length}…`)
      }

      const activities: ExportActivity[] = selected.map((s) => ({
        submission: { ...s, description: s.description ? sanitizeRichText(s.description) : null },
        departmentName: deptName(s.departmentId),
        templateTitle: titleByTemplate[s.templateId] ?? '',
        path: ancestorTitles(nodesByTemplate[s.templateId] ?? [], s.nodeId),
        assignedFacultyName: allFaculty[s.facultyId] || null,
        reviewerName: s.reviewedByName ?? null,
        reviewerRole: s.reviewedByRole ?? null,
        images: imageData.get(s.id) ?? [],
      }))

      const scopeLabel = [
        scope === 'approved' ? 'Approved activities' : 'All activities sent for review',
        departmentId ? deptName(departmentId) : 'All departments',
        appUser.mbbsYear ? `MBBS Year ${appUser.mbbsYear}` : '',
        fromDate || toDate ? `${fromDate ? formatIso(fromDate) : 'start'} to ${toDate ? formatIso(toDate) : 'today'}` : '',
      ]
        .filter(Boolean)
        .join(' · ')

      setProgress(format === 'full' ? `Laying out ${activities.length + 1}+ pages…` : 'Building the summary…')
      // react-pdf (+ fonts) is a separate chunk, loaded only when exporting.
      const render =
        format === 'full'
          ? (await import('./activityPdf/ActivityRecordPdf')).renderActivityRecordPdf
          : (await import('./activityPdf/ActivitySummaryPdf')).renderActivitySummaryPdf
      const blob = await render({
        college: {
          name: institution?.name ?? 'Medical College',
          city: institution?.city ?? '',
          state: institution?.state ?? '',
          type: institution?.type ?? '',
        },
        student: {
          name: appUser.name,
          rollNumber: appUser.rollNumber ?? '',
          mbbsYear: appUser.mbbsYear ?? null,
          email: appUser.email ?? '',
          phone: appUser.phone ?? '',
        },
        activities,
        scopeLabel,
        generatedAt: Date.now(),
      })

      const slug = [appUser.rollNumber || appUser.name, departmentId ? deptName(departmentId) : '', scope === 'approved' ? 'Approved' : 'All']
        .filter(Boolean)
        .join('-')
        .replace(/[^A-Za-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
      saveBlob(blob, `${format === 'full' ? 'USOP-Activities' : 'USOP-Activity-Summary'}-${slug}.pdf`)
      setOpen(false)
    } catch (e) {
      console.error('Activity export failed', e)
      setError('Couldn’t create the PDF — please try again.')
    } finally {
      setProgress(null)
    }
  }

  return (
    <>
      <button
        onClick={() => {
          setScope(sent.some((s) => s.status === 'approved') ? 'approved' : 'sent')
          setError('')
          setOpen(true)
        }}
        disabled={!submissions || sent.length === 0}
        title={sent.length === 0 ? 'Send an activity for review first' : 'Export your activities as a PDF'}
        className="inline-flex items-center gap-2 rounded-[8px] border px-3.5 py-2 text-[12.5px] font-semibold transition-colors hover:border-[var(--color-gold)] disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)', backgroundColor: 'var(--color-paper-raised)' }}
      >
        <Icon name="download" className="h-4 w-4" />
        Export activities
      </button>

      {open && (
        <Modal title="Export activities" onClose={() => !busy && setOpen(false)}>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] mb-2" style={{ color: 'var(--color-char-soft)' }}>
            Format
          </div>
          <div className="grid grid-cols-2 gap-2 mb-5">
            {(
              [
                ['full', 'Full record', 'Each activity on its own page — description, photos, sketch, review and signatures.'],
                ['summary', 'Quick summary', 'Your whole logbook at a glance — totals, departments, every skill and a log table. No images.'],
              ] as const
            ).map(([key, label, hint]) => {
              const active = format === key
              return (
                <button
                  key={key}
                  onClick={() => setFormat(key)}
                  disabled={busy}
                  className="text-left rounded-[10px] border px-3.5 py-3 transition-colors"
                  style={{
                    borderColor: active ? 'var(--color-gold)' : 'var(--color-line)',
                    backgroundColor: active ? 'color-mix(in srgb, var(--color-gold) 8%, var(--color-paper-raised) 92%)' : 'var(--color-paper-raised)',
                  }}
                >
                  <div className="text-[13px] font-semibold" style={{ color: 'var(--color-char)' }}>
                    {label}
                  </div>
                  <div className="text-[11.5px] mt-0.5 leading-snug" style={{ color: 'var(--color-char-soft)' }}>
                    {hint}
                  </div>
                </button>
              )
            })}
          </div>

          <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] mb-2" style={{ color: 'var(--color-char-soft)' }}>
            Include
          </div>
          <div className="grid grid-cols-2 gap-2 mb-5">
            {(
              [
                ['approved', 'Approved only', `${sent.filter((s) => s.status === 'approved').length} activities`],
                ['sent', 'Everything sent', `${sent.length} activities, any status`],
              ] as const
            ).map(([key, label, hint]) => {
              const active = scope === key
              return (
                <button
                  key={key}
                  onClick={() => setScope(key)}
                  disabled={busy}
                  className="text-left rounded-[10px] border px-3.5 py-3 transition-colors"
                  style={{
                    borderColor: active ? 'var(--color-gold)' : 'var(--color-line)',
                    backgroundColor: active ? 'color-mix(in srgb, var(--color-gold) 8%, var(--color-paper-raised) 92%)' : 'var(--color-paper-raised)',
                  }}
                >
                  <div className="text-[13px] font-semibold" style={{ color: 'var(--color-char)' }}>
                    {label}
                  </div>
                  <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
                    {hint}
                  </div>
                </button>
              )
            })}
          </div>

          <div className="text-[10.5px] font-semibold uppercase tracking-[0.09em] mb-2" style={{ color: 'var(--color-char-soft)' }}>
            Department
          </div>
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            disabled={busy}
            className="w-full rounded-[8px] border px-3 py-2.5 text-[13px] mb-5 bg-transparent"
            style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
          >
            <option value="">All departments</option>
            {departmentOptions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>

          <div className="flex items-baseline justify-between mb-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.09em]" style={{ color: 'var(--color-char-soft)' }}>
              Activity dates <span className="normal-case tracking-normal font-normal">(optional)</span>
            </span>
            {(fromDate || toDate) && (
              <button
                type="button"
                onClick={() => {
                  setFromDate('')
                  setToDate('')
                }}
                className="text-[11.5px] font-medium"
                style={{ color: 'var(--color-gold)' }}
              >
                Clear
              </button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 mb-5">
            {(
              [
                ['From', fromDate, setFromDate, undefined, toDate || undefined],
                ['To', toDate, setToDate, fromDate || undefined, undefined],
              ] as const
            ).map(([label, value, set, min, max]) => (
              <label key={label} className="block">
                <span className="block text-[11px] mb-1" style={{ color: 'var(--color-char-soft)' }}>
                  {label}
                </span>
                <input
                  type="date"
                  value={value}
                  min={min}
                  max={max}
                  onChange={(e) => set(e.target.value)}
                  disabled={busy}
                  className="w-full rounded-[8px] border px-3 py-2 text-[13px] bg-transparent"
                  style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
                />
              </label>
            ))}
          </div>

          <div
            className="rounded-[10px] px-4 py-3 mb-5 flex items-center justify-between gap-3"
            style={{ backgroundColor: 'var(--color-paper)', border: '1px solid var(--color-line)' }}
          >
            <span className="text-[12.5px]" style={{ color: 'var(--color-char)' }}>
              {selected.length === 0 ? 'No activities match these options.' : `${selected.length} ${selected.length === 1 ? 'activity' : 'activities'} · about ${format === 'full' ? selected.length + 1 + Math.ceil(selected.length / 12) : 2 + Math.ceil(selected.length / 22)} pages`}
            </span>
            {progress && (
              <span className="text-[12px] flex items-center gap-2" style={{ color: 'var(--color-gold)' }}>
                <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--color-gold)' }} />
                {progress}
              </span>
            )}
          </div>
          {error && (
            <p className="text-[12px] mb-4" style={{ color: 'var(--color-clay)' }}>
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <GhostButton onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </GhostButton>
            <PrimaryButton onClick={generate} disabled={busy || selected.length === 0}>
              {busy ? 'Creating PDF…' : 'Download PDF'}
            </PrimaryButton>
          </div>
        </Modal>
      )}

    </>
  )
}
