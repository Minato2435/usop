import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { SkillLabDirectorShell } from './shell/SkillLabDirectorShell'
import { Skeleton } from './shell/ui'
import { Icon } from '../primary-admin/shell/Icon'
import { useCountUp } from '../primary-admin/shell/useCountUp'
import { watchAllCertificateRequests, certificateRequestStatus } from '../../lib/firestore/certificates'
import { watchInstitutions } from '../../lib/firestore/institutions'
import { getAppUser } from '../../lib/firestore/users'
import type { AppUser, CertificateDecision, CertificateRequest, Institution } from '../../types'

const BORDER = 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)'
const ROW_LINE = 'color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)'

const DECISION: Record<CertificateDecision, { label: string; color: string }> = {
  pending: { label: 'Pending', color: 'var(--color-char-soft)' },
  approved: { label: 'Approved', color: 'var(--color-teal)' },
  rejected: { label: 'Rejected', color: 'var(--color-clay)' },
}

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

// Laid out after `attaching references/Certificate Management - Skill Lab
// Director.dc.html`: greeting, four chamfered stat tiles (the one that's
// actually your job — "Pending my decision" — set in ink), then the oldest
// requests still waiting on you.
export function SkillLabDirectorDashboard() {
  const { appUser } = useAuth()
  const navigate = useNavigate()
  const [requests, setRequests] = useState<CertificateRequest[] | null>(null)
  useEffect(() => watchAllCertificateRequests(setRequests), [])
  const [institutions, setInstitutions] = useState<Institution[]>([])
  useEffect(() => watchInstitutions(setInstitutions, () => setInstitutions([])), [])

  const all = useMemo(() => requests ?? [], [requests])
  // Waiting on me: my side pending, and not already dead from the other side.
  const mine = useMemo(() => all.filter((r) => r.skillLabDirectorDecision === 'pending' && r.primaryAdminDecision !== 'rejected'), [all])
  const issued = all.filter((r) => certificateRequestStatus(r) === 'issued').length
  const rejected = all.filter((r) => certificateRequestStatus(r) === 'rejected').length
  const nextUp = useMemo(() => [...mine].sort((a, b) => a.requestedAt - b.requestedAt).slice(0, 5), [mine])

  const [students, setStudents] = useState<Record<string, AppUser | null>>({})
  useEffect(() => {
    const missing = nextUp.map((r) => r.studentId).filter((id) => !(id in students))
    if (missing.length === 0) return
    Promise.all(missing.map((id) => getAppUser(id).catch(() => null))).then((users) =>
      setStudents((prev) => {
        const next = { ...prev }
        users.forEach((u, i) => (next[missing[i]] = u))
        return next
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextUp.map((r) => r.studentId).join(',')])

  const firstName = appUser?.name?.replace(/^Dr\.?\s*/i, '').split(' ')[0] ?? ''
  const title = `${greeting()}${appUser?.name ? `, ${appUser.name.match(/^Dr\.?/i) ? `Dr. ${appUser.name.split(' ').slice(-1)[0]}` : firstName}` : ''}`

  return (
    <SkillLabDirectorShell eyebrow="Certificates" title={title}>
      <p className="text-[14px]" style={{ color: 'var(--color-char-soft)' }}>
        Certificate requests from every college, awaiting the Skill Lab Director’s decision.
      </p>

      <div className="grid gap-4 mt-7" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 200px), 1fr))' }}>
        <BigStat label="Pending my decision" value={mine.length} loading={!requests} highlight index={0} onClick={() => navigate('/skill-lab-director/requests?filter=pending')} />
        <BigStat label="Issued" value={issued} loading={!requests} index={1} onClick={() => navigate('/skill-lab-director/requests?filter=issued')} />
        <BigStat label="Rejected" value={rejected} loading={!requests} index={2} onClick={() => navigate('/skill-lab-director/requests?filter=rejected')} />
        <BigStat label="Total requests" value={all.length} loading={!requests} index={3} onClick={() => navigate('/skill-lab-director/requests?filter=all')} />
      </div>

      <div className="flex justify-between items-end gap-3 mt-11 mb-3.5">
        <div>
          <div className="font-mono text-[11px] tracking-[0.16em] uppercase" style={{ color: 'var(--color-gold)' }}>
            Oldest first
          </div>
          <h2 className="font-display text-[28px] mt-1" style={{ color: 'var(--color-char)' }}>
            Next up
          </h2>
        </div>
        <button onClick={() => navigate('/skill-lab-director/requests')} className="text-[13px] hover:opacity-70 transition-opacity" style={{ color: 'var(--color-gold)' }}>
          View all requests
        </button>
      </div>

      <div className="rounded-[10px] border overflow-hidden" style={{ borderColor: BORDER, backgroundColor: 'var(--color-paper)' }}>
        {!requests ? (
          <div className="p-4 space-y-2">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
        ) : nextUp.length === 0 ? (
          <div className="py-10 text-center">
            <div className="font-display text-[19px]" style={{ color: 'var(--color-char)' }}>
              All caught up
            </div>
            <p className="text-[13px] mt-1" style={{ color: 'var(--color-char-soft)' }}>
              Nothing is waiting on you.
            </p>
          </div>
        ) : (
          nextUp.map((r, i) => {
            const s = students[r.studentId]
            const adm = DECISION[r.primaryAdminDecision]
            return (
              <button
                key={r.id}
                onClick={() => navigate(`/skill-lab-director/requests/${r.id}`)}
                className="fade-up group w-full text-left flex items-center gap-x-[18px] gap-y-2 px-[22px] py-4 flex-wrap transition-colors hover:bg-black/[0.015]"
                style={{ borderTop: i > 0 ? `1px solid ${ROW_LINE}` : undefined, animationDelay: `${i * 40}ms` }}
              >
                <span
                  className="h-[38px] w-[38px] shrink-0 rounded-full flex items-center justify-center font-display text-[16px]"
                  style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-gold)' }}
                >
                  {s ? initials(s.name) : '·'}
                </span>
                <div className="flex-1 min-w-[180px]">
                  <div className="text-[14.5px] font-medium" style={{ color: 'var(--color-char)' }}>
                    {s?.name ?? 'Unknown student'}
                    <span className="font-mono text-[11px] font-normal ml-2" style={{ color: 'var(--color-char-soft)' }}>
                      {s?.rollNumber}
                    </span>
                  </div>
                  <div className="text-[12.5px] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
                    {institutions.find((x) => x.id === r.institutionId)?.name ?? ''}
                  </div>
                </div>
                <div className="min-w-[140px]">
                  <div className="text-[13.5px]" style={{ color: 'var(--color-char)' }}>
                    {r.department}
                  </div>
                  <div className="font-mono text-[11px] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
                    Year {r.mbbsYear}
                  </div>
                </div>
                <div className="font-mono text-[12px] min-w-[96px]" style={{ color: 'var(--color-char)' }}>
                  {new Date(r.requestedAt).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
                <span
                  className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium border whitespace-nowrap"
                  style={{ borderColor: `color-mix(in srgb, ${adm.color} 40%, transparent)`, color: adm.color }}
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: adm.color }} />
                  Admin · {adm.label}
                </span>
                <Icon name="chevron" className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" style={{ color: 'var(--color-gold)' }} />
              </button>
            )
          })
        )}
      </div>
    </SkillLabDirectorShell>
  )
}

function BigStat({
  label,
  value,
  loading,
  highlight,
  index,
  onClick,
}: {
  label: string
  value: number
  loading: boolean
  highlight?: boolean
  index: number
  onClick: () => void
}) {
  const shown = useCountUp(loading ? 0 : value)
  return (
    <button
      onClick={onClick}
      className="chamfer fade-up text-left px-6 py-[22px] transition-transform hover:-translate-y-0.5"
      style={{
        backgroundColor: highlight ? 'var(--color-ink)' : 'var(--color-paper-raised)',
        animationDelay: `${index * 60}ms`,
        border: highlight ? undefined : `1px solid ${BORDER}`,
      }}
    >
      <div className="font-mono text-[10.5px] tracking-[0.12em] uppercase" style={{ color: highlight ? 'color-mix(in srgb, var(--color-frost) 60%, transparent)' : 'var(--color-char-soft)' }}>
        {label}
      </div>
      <div className="font-display text-[56px] leading-none mt-3.5 tabular-nums" style={{ color: highlight ? 'var(--color-gold)' : 'var(--color-char)' }}>
        {shown}
      </div>
    </button>
  )
}
