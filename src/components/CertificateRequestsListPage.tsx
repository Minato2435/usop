import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Skeleton } from '../roles/primary-admin/shell/ui'
import { Icon } from '../roles/primary-admin/shell/Icon'
import { CertificateStatusPill } from './CertificateStatusPill'
import { watchAllCertificateRequests, certificateRequestStatus } from '../lib/firestore/certificates'
import { watchInstitutions } from '../lib/firestore/institutions'
import { getAppUser } from '../lib/firestore/users'
import type { AppUser, CertificateDecision, CertificateRequest, CertificateRequestStatus, Institution } from '../types'

type Filter = CertificateRequestStatus | 'all'

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'issued', label: 'Issued' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
]

const DECISION_LABEL: Record<CertificateDecision, string> = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected' }
const DECISION_STYLE: Record<CertificateDecision, { color: string; backgroundColor: string }> = {
  pending: { color: 'var(--color-char-soft)', backgroundColor: 'color-mix(in srgb, var(--color-char-soft) 12%, transparent)' },
  approved: { color: 'var(--color-teal)', backgroundColor: 'var(--color-teal-soft)' },
  rejected: { color: 'var(--color-clay)', backgroundColor: 'var(--color-clay-soft)' },
}

const BORDER = 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)'
const ROW_LINE = 'color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)'

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

// The shared requests table — no Shell of its own, so Primary Admin can
// host it as a tab (Certificate Management) and Skill Lab Director as a
// standalone page (CertificateRequestsListPage below). Laid out after
// `attaching references/Certificate Management - Admin.dc.html`: status
// filter tabs with counts + a student/college search, then a table of
// student · college · department · requested · both approvals · status.
export function CertificateRequestsList({ basePath }: { basePath: string }) {
  const navigate = useNavigate()
  const [requests, setRequests] = useState<CertificateRequest[] | null>(null)
  // `?filter=issued` etc. — the dashboard's stat tiles deep-link here.
  const [searchParams] = useSearchParams()
  const initialFilter = searchParams.get('filter')
  const [filter, setFilter] = useState<Filter>(
    initialFilter === 'issued' || initialFilter === 'rejected' || initialFilter === 'all' ? initialFilter : 'pending',
  )
  const [search, setSearch] = useState('')
  const [studentsById, setStudentsById] = useState<Record<string, AppUser>>({})
  const [institutions, setInstitutions] = useState<Institution[]>([])

  useEffect(() => watchAllCertificateRequests(setRequests), [])
  useEffect(() => watchInstitutions(setInstitutions, () => setInstitutions([])), [])

  const studentIds = useMemo(() => [...new Set((requests ?? []).map((r) => r.studentId))], [requests])
  useEffect(() => {
    const missing = studentIds.filter((id) => !studentsById[id])
    if (missing.length === 0) return
    let cancelled = false
    Promise.all(missing.map((id) => getAppUser(id).catch(() => null))).then((users) => {
      if (cancelled) return
      setStudentsById((prev) => {
        const next = { ...prev }
        users.forEach((u, i) => {
          if (u) next[missing[i]] = u
        })
        return next
      })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentIds.join(',')])

  const collegeName = (id: string) => institutions.find((i) => i.id === id)?.name ?? '—'

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { pending: 0, issued: 0, rejected: 0, all: 0 }
    for (const r of requests ?? []) {
      c[certificateRequestStatus(r)]++
      c.all++
    }
    return c
  }, [requests])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (requests ?? [])
      .filter((r) => filter === 'all' || certificateRequestStatus(r) === filter)
      .filter((r) => {
        if (!q) return true
        const s = studentsById[r.studentId]
        const hay = `${s?.name ?? ''} ${s?.rollNumber ?? ''} ${collegeName(r.institutionId)} ${r.department}`.toLowerCase()
        return hay.includes(q)
      })
      .sort((a, b) => b.requestedAt - a.requestedAt)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests, filter, search, studentsById, institutions])

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative w-full sm:w-[260px]">
          <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 pointer-events-none" style={{ color: 'var(--color-char-soft)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search student or college"
            className="w-full pl-8 pr-3 py-2 text-[13.5px] border outline-none bg-transparent transition-colors duration-150 focus:border-[var(--color-gold)]"
            style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
          />
        </div>
        <div className="inline-flex border rounded-[3px] overflow-hidden" style={{ borderColor: 'var(--color-line)' }}>
          {FILTERS.map((f, i) => {
            const active = filter === f.key
            return (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className="px-3 py-2 text-[12.5px] font-medium flex items-center gap-1.5 transition-colors duration-150"
                style={{
                  backgroundColor: active ? 'var(--color-ink)' : 'transparent',
                  color: active ? 'var(--color-frost)' : 'var(--color-char-soft)',
                  borderRight: i < FILTERS.length - 1 ? '1px solid var(--color-line)' : undefined,
                }}
              >
                {f.label}
                <span className="font-mono text-[10.5px] tabular-nums opacity-70">{counts[f.key]}</span>
              </button>
            )
          })}
        </div>
      </div>

      {!requests ? (
        <div className="space-y-2">
          <Skeleton className="h-14 rounded-[8px]" />
          <Skeleton className="h-14 rounded-[8px]" />
          <Skeleton className="h-14 rounded-[8px]" />
        </div>
      ) : (
        // Same treatment as the Log Templates / Users tables: on the page's
        // own paper ground, defined only by its border.
        <div className="rounded-[10px] overflow-hidden border" style={{ backgroundColor: 'var(--color-paper)', borderColor: BORDER }}>
          <div className="overflow-x-auto">
            <div className="min-w-[960px]">
              <div
                className="flex items-center gap-4 px-5 py-3 border-b text-[10.5px] font-semibold uppercase tracking-[0.08em]"
                style={{ borderColor: BORDER, color: 'var(--color-char-soft)' }}
              >
                <div className="flex-[2] min-w-[230px]">Student</div>
                <div className="w-[190px] shrink-0">College</div>
                <div className="w-[150px] shrink-0">Department</div>
                <div className="w-[104px] shrink-0">Requested</div>
                <div className="w-[176px] shrink-0">Approvals</div>
                <div className="w-[92px] shrink-0 text-right">Status</div>
              </div>

              {rows.length === 0 ? (
                <div className="py-12 text-center">
                  <div className="font-display text-[19px] mb-1" style={{ color: 'var(--color-char)' }}>
                    {filter === 'pending' && !search ? 'All caught up' : 'No requests here'}
                  </div>
                  <p className="text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
                    {filter === 'pending' && !search ? 'Nothing is waiting for a decision right now.' : 'Try another filter or search.'}
                  </p>
                </div>
              ) : (
                rows.map((r) => {
                  const student = studentsById[r.studentId]
                  return (
                    <button
                      key={r.id}
                      onClick={() => navigate(`${basePath}/${r.id}`)}
                      className="group w-full text-left flex items-center gap-4 px-5 py-3.5 border-b last:border-0 transition-colors duration-100 hover:bg-black/[0.015]"
                      style={{ borderColor: ROW_LINE }}
                    >
                      <div className="flex-[2] min-w-[230px] flex items-center gap-3">
                        <div
                          className="shrink-0 h-9 w-9 rounded-full border-[1.5px] flex items-center justify-center font-display text-[14px]"
                          style={{ borderColor: 'var(--color-gold-line)', color: 'var(--color-gold)' }}
                        >
                          {student ? initials(student.name) : '·'}
                        </div>
                        <div className="min-w-0">
                          <div className="font-display text-[16.5px] leading-snug truncate group-hover:opacity-75 transition-opacity" style={{ color: 'var(--color-char)' }}>
                            {student?.name ?? 'Unknown student'}
                          </div>
                          <div className="font-mono text-[11px] mt-0.5 truncate" style={{ color: 'var(--color-char-soft)' }}>
                            {student?.rollNumber || '—'}
                          </div>
                        </div>
                      </div>
                      <div className="w-[190px] shrink-0 text-[13px] leading-snug line-clamp-2" style={{ color: 'var(--color-char)' }}>
                        {collegeName(r.institutionId)}
                      </div>
                      <div className="w-[150px] shrink-0 min-w-0">
                        <div className="text-[13px] truncate" style={{ color: 'var(--color-char)' }}>
                          {r.department}
                        </div>
                        <div className="text-[11.5px] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
                          Year {r.mbbsYear} · {r.requiredSkills.length} skills
                        </div>
                      </div>
                      <div className="w-[104px] shrink-0 font-mono text-[12px] tabular-nums" style={{ color: 'var(--color-char-soft)' }}>
                        {formatDate(r.requestedAt)}
                      </div>
                      <div className="w-[176px] shrink-0 flex flex-col gap-1 items-start">
                        <DecisionChip who="Skill Lab" decision={r.skillLabDirectorDecision} />
                        <DecisionChip who="Admin" decision={r.primaryAdminDecision} />
                      </div>
                      <div className="w-[92px] shrink-0 flex justify-end">
                        <CertificateStatusPill status={certificateRequestStatus(r)} />
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function DecisionChip({ who, decision }: { who: string; decision: CertificateDecision }) {
  const color = DECISION_STYLE[decision].color
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap"
      style={{ borderColor: `color-mix(in srgb, ${color} 40%, transparent)`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      {who} · {DECISION_LABEL[decision]}
    </span>
  )
}

// Shell-wrapped standalone route — Skill Lab Director's Requests page.
export function CertificateRequestsListPage({
  Shell,
  basePath,
  title,
}: {
  Shell: ComponentType<{ eyebrow?: string; title: string; actions?: ReactNode; children: ReactNode }>
  basePath: string
  title: string
}) {
  return (
    <Shell eyebrow="Certificates" title={title}>
      <CertificateRequestsList basePath={basePath} />
    </Shell>
  )
}
