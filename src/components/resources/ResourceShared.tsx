import { useState, type ReactNode } from 'react'
import { Icon } from '../../roles/primary-admin/shell/Icon'
import { Badge } from '../../roles/primary-admin/shell/ui'
import { ToggleSwitch } from '../../roles/primary-admin/shell/VideoShared'
import { RESOURCE_KIND_LABELS, downloadResource, formatBytes, isResourceActive } from '../../lib/firestore/resources'
import type { Resource, ResourceKind } from '../../types'

// Shared pieces for the Resources pages (admin lists, editor preview,
// student/faculty library).

// Fixed per-type colours (like a file manager), so a PDF always reads as a
// PDF whatever the platform theme is.
export const KIND_COLORS: Record<ResourceKind, string> = {
  pdf: '#C2410C',
  word: '#1D4ED8',
  powerpoint: '#B45309',
  excel: '#15803D',
  image: '#7C3AED',
}
const KIND_EXT: Record<ResourceKind, string> = { pdf: 'PDF', word: 'DOC', powerpoint: 'PPT', excel: 'XLS', image: 'IMG' }

export function FileKindTile({ kind, size = 44 }: { kind: ResourceKind; size?: number }) {
  const color = KIND_COLORS[kind]
  return (
    <span
      className="relative shrink-0 inline-flex items-end justify-center rounded-[8px]"
      style={{
        width: size,
        height: size * 1.18,
        backgroundColor: `color-mix(in srgb, ${color} 10%, var(--color-paper-raised) 90%)`,
        border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
        paddingBottom: size * 0.14,
      }}
      aria-label={RESOURCE_KIND_LABELS[kind]}
    >
      <span
        className="absolute top-0 right-0"
        style={{ width: size * 0.3, height: size * 0.3, background: `linear-gradient(225deg, var(--color-paper) 50%, color-mix(in srgb, ${color} 30%, transparent) 50%)`, borderTopRightRadius: 8 }}
      />
      <span className="font-mono font-semibold rounded-[3px] px-1" style={{ fontSize: size * 0.22, color: '#fff', backgroundColor: color, lineHeight: 1.35 }}>
        {KIND_EXT[kind]}
      </span>
    </span>
  )
}

export function resourceScopeLabel(r: Pick<Resource, 'department' | 'mbbsYear' | 'audience'>): string {
  const dept = r.department || 'All departments'
  if (r.audience === 'faculty') return `${dept} · Faculty`
  return `${dept} · ${r.mbbsYear ? `Year ${r.mbbsYear}` : 'All years'}`
}

export function fmtDay(ms: number) {
  return new Date(ms).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Open in a new tab (PDFs and images preview in the browser) + Download.
export function OpenDownloadButtons({ resource, compact }: { resource: Resource; compact?: boolean }) {
  const [busy, setBusy] = useState(false)
  const previewable = resource.kind === 'pdf' || resource.kind === 'image'
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      {previewable && (
        <a
          href={resource.url}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex items-center gap-1.5 rounded-[7px] border font-medium transition-colors hover:border-[var(--color-gold)] ${compact ? 'px-2.5 py-1 text-[11.5px]' : 'px-3 py-1.5 text-[12.5px]'}`}
          style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
        >
          <Icon name="eye" className="h-3.5 w-3.5" />
          Open
        </a>
      )}
      <button
        onClick={async () => {
          setBusy(true)
          await downloadResource(resource)
          setBusy(false)
        }}
        disabled={busy}
        className={`inline-flex items-center gap-1.5 rounded-[7px] font-medium transition-opacity hover:opacity-90 disabled:opacity-60 ${compact ? 'px-2.5 py-1 text-[11.5px]' : 'px-3 py-1.5 text-[12.5px]'}`}
        style={{ backgroundColor: 'var(--color-ink)', color: 'var(--color-frost)' }}
      >
        <Icon name="download" className="h-3.5 w-3.5" />
        {busy ? 'Saving…' : 'Download'}
      </button>
    </div>
  )
}

// One resource row in an admin list. `controls` slots the page-specific
// switch / edit / delete actions on the right.
export function AdminResourceRow({
  resource,
  collegeLabel,
  toggle,
  actions,
  muted,
}: {
  resource: Resource
  collegeLabel?: string
  toggle?: { on: boolean; onChange: () => void; label: string }
  actions?: ReactNode
  muted?: boolean
}) {
  return (
    <div
      className="flex items-center gap-4 px-4 py-3.5 border-b last:border-0 transition-colors hover:bg-black/[0.015]"
      style={{ borderColor: 'color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)', opacity: muted ? 0.62 : 1 }}
    >
      <FileKindTile kind={resource.kind} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-display text-[16px] leading-tight break-words" style={{ color: 'var(--color-char)' }}>
            {resource.title}
          </span>
          {!isResourceActive(resource) && <Badge tone="clay">Disabled</Badge>}
        </div>
        <div className="text-[12px] mt-0.5 flex flex-wrap gap-x-2" style={{ color: 'var(--color-char-soft)' }}>
          <span>{resourceScopeLabel(resource)}</span>
          {collegeLabel && <span>· {collegeLabel}</span>}
          <span className="font-mono text-[11px]">
            · {RESOURCE_KIND_LABELS[resource.kind]} · {formatBytes(resource.size)}
          </span>
        </div>
      </div>
      <a
        href={resource.url}
        target="_blank"
        rel="noopener noreferrer"
        title="Open file"
        className="h-8 w-8 shrink-0 flex items-center justify-center rounded-[6px] transition-colors hover:bg-black/[0.05]"
        style={{ color: 'var(--color-char-soft)' }}
      >
        <Icon name="eye" className="h-4 w-4" />
      </a>
      {actions}
      {toggle && <ToggleSwitch on={toggle.on} onChange={toggle.onChange} label={toggle.label} />}
    </div>
  )
}
