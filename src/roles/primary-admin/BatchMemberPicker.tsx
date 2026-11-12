import { useMemo, useState } from 'react'
import { Icon } from './shell/Icon'
import type { AppUser } from '../../types'

type Mode = 'list' | 'paste' | 'range'

const norm = (s: string) => s.trim().toUpperCase().replace(/\s+/g, '')
const naturalCompare = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
// Trailing number of a register number: "RG/22/0142" → 142. Lets people type
// just "142" or "0142" when that's unique within the cohort.
const tailNumber = (s: string) => {
  const m = s.match(/(\d+)\D*$/)
  return m ? Number(m[1]) : null
}

// Members step of a video batch. Three ways in, all writing the same
// selection: hand-pick from the list, paste a column of register numbers
// (from Excel / the register / a message — any separators), or select a
// register-number range. Matching ignores case and spaces, and also accepts
// just the last digits ("0142") when exactly one person in the cohort ends
// with that number.
export function BatchMemberPicker({
  candidates,
  memberIds,
  setMemberIds,
  audienceLabel,
}: {
  candidates: AppUser[]
  memberIds: string[]
  setMemberIds: (ids: string[]) => void
  audienceLabel: string
}) {
  const [mode, setMode] = useState<Mode>('list')
  const [search, setSearch] = useState('')
  const [onlySelected, setOnlySelected] = useState(false)

  const sorted = useMemo(
    () => candidates.slice().sort((a, b) => naturalCompare(a.rollNumber || a.name, b.rollNumber || b.name)),
    [candidates],
  )
  const selectedSet = useMemo(() => new Set(memberIds), [memberIds])

  function toggle(uid: string) {
    setMemberIds(selectedSet.has(uid) ? memberIds.filter((id) => id !== uid) : [...memberIds, uid])
  }
  function addIds(ids: string[]) {
    setMemberIds([...new Set([...memberIds, ...ids])])
  }

  // --- Paste ---------------------------------------------------------------
  const [pasteText, setPasteText] = useState('')
  const pasteResult = useMemo(() => {
    const tokens = [...new Set(pasteText.split(/[\s,;|]+/).map(norm).filter(Boolean))]
    const byRoll = new Map<string, AppUser>()
    const byEmail = new Map<string, AppUser>()
    const byTail = new Map<number, AppUser[]>()
    for (const u of candidates) {
      if (u.rollNumber) {
        byRoll.set(norm(u.rollNumber), u)
        const t = tailNumber(u.rollNumber)
        if (t !== null) byTail.set(t, [...(byTail.get(t) ?? []), u])
      }
      byEmail.set(norm(u.email), u)
    }
    const matched = new Map<string, AppUser>()
    const notFound: string[] = []
    const ambiguous: string[] = []
    for (const tok of tokens) {
      const exact = byRoll.get(tok) ?? byEmail.get(tok)
      if (exact) {
        matched.set(exact.uid, exact)
        continue
      }
      if (/^\d+$/.test(tok)) {
        const hits = byTail.get(Number(tok)) ?? []
        if (hits.length === 1) {
          matched.set(hits[0].uid, hits[0])
          continue
        }
        if (hits.length > 1) {
          ambiguous.push(tok)
          continue
        }
      }
      notFound.push(tok)
    }
    return { tokens: tokens.length, matched: [...matched.values()], notFound, ambiguous }
  }, [pasteText, candidates])

  // --- Range ---------------------------------------------------------------
  const [rangeFrom, setRangeFrom] = useState('')
  const [rangeTo, setRangeTo] = useState('')
  const rangeMatches = useMemo(() => {
    const from = rangeFrom.trim()
    const to = rangeTo.trim()
    if (!from || !to) return []
    const numericOnly = /^\d+$/.test(from) && /^\d+$/.test(to)
    const lo = numericOnly ? Math.min(Number(from), Number(to)) : null
    const hi = numericOnly ? Math.max(Number(from), Number(to)) : null
    const [a, b] = naturalCompare(from, to) <= 0 ? [norm(from), norm(to)] : [norm(to), norm(from)]
    return sorted.filter((u) => {
      if (!u.rollNumber) return false
      if (numericOnly) {
        const t = tailNumber(u.rollNumber)
        return t !== null && t >= lo! && t <= hi!
      }
      const r = norm(u.rollNumber)
      return naturalCompare(r, a) >= 0 && naturalCompare(r, b) <= 0
    })
  }, [rangeFrom, rangeTo, sorted])

  // --- List ----------------------------------------------------------------
  const visible = sorted.filter((u) => {
    if (onlySelected && !selectedSet.has(u.uid)) return false
    const q = search.trim().toLowerCase()
    return !q || u.name.toLowerCase().includes(q) || (u.rollNumber ?? '').toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  })
  const allVisibleOn = visible.length > 0 && visible.every((u) => selectedSet.has(u.uid))

  const tabBtn = (m: Mode, label: string) => (
    <button
      type="button"
      onClick={() => setMode(m)}
      className="px-3 py-2 text-[12.5px] font-medium transition-colors duration-150"
      style={{
        backgroundColor: mode === m ? 'var(--color-ink)' : 'transparent',
        color: mode === m ? 'var(--color-frost)' : 'var(--color-char-soft)',
        borderLeft: m !== 'list' ? '1px solid var(--color-line)' : undefined,
      }}
    >
      {label}
    </button>
  )

  return (
    <div>
      {/* Selection summary */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-baseline gap-1.5">
          <span className="font-display text-[28px] leading-none tabular-nums" style={{ color: 'var(--color-gold)' }}>
            {memberIds.length}
          </span>
          <span className="text-[12.5px]" style={{ color: 'var(--color-char-soft)' }}>
            of {candidates.length} {audienceLabel.toLowerCase()} selected
          </span>
        </div>
        <div className="sm:ml-auto inline-flex border rounded-[3px] overflow-hidden" style={{ borderColor: 'var(--color-line)' }}>
          {tabBtn('list', 'Pick from list')}
          {tabBtn('paste', 'Paste register numbers')}
          {tabBtn('range', 'Register range')}
        </div>
      </div>

      {mode === 'paste' && (
        <div className="rounded-[8px] border p-4 mb-4" style={{ borderColor: 'var(--color-line)' }}>
          <p className="text-[12.5px] mb-2.5 leading-relaxed" style={{ color: 'var(--color-char-soft)' }}>
            Paste register numbers from Excel, the register or a message — one per line, or separated by commas or spaces. Just the last
            digits (e.g. <span className="font-mono">0142</span>) work too when they’re unique.
          </p>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={5}
            placeholder={'RG/22/0101\nRG/22/0102\nRG/22/0107, RG/22/0110 …'}
            className="w-full px-3 py-2.5 font-mono text-[12.5px] rounded-[6px] border bg-transparent outline-none resize-y focus:border-[var(--color-gold)]"
            style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
          />
          {pasteResult.tokens > 0 && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                <Chip tone="teal">{pasteResult.matched.length} matched</Chip>
                {pasteResult.notFound.length > 0 && <Chip tone="clay">{pasteResult.notFound.length} not found</Chip>}
                {pasteResult.ambiguous.length > 0 && <Chip tone="gold">{pasteResult.ambiguous.length} need the full number</Chip>}
              </div>
              {pasteResult.notFound.length > 0 && (
                <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-clay)' }}>
                  Not in this cohort: <span className="font-mono">{pasteResult.notFound.join(', ')}</span>
                </p>
              )}
              {pasteResult.ambiguous.length > 0 && (
                <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-char-soft)' }}>
                  More than one person ends with: <span className="font-mono">{pasteResult.ambiguous.join(', ')}</span> — paste the full register number.
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <ActionButton
                  primary
                  disabled={pasteResult.matched.length === 0}
                  onClick={() => {
                    addIds(pasteResult.matched.map((u) => u.uid))
                    setMode('list')
                    setOnlySelected(true)
                  }}
                >
                  Add {pasteResult.matched.length} to selection
                </ActionButton>
                <ActionButton
                  disabled={pasteResult.matched.length === 0}
                  onClick={() => {
                    setMemberIds(pasteResult.matched.map((u) => u.uid))
                    setMode('list')
                    setOnlySelected(true)
                  }}
                >
                  Replace selection with these
                </ActionButton>
              </div>
            </div>
          )}
        </div>
      )}

      {mode === 'range' && (
        <div className="rounded-[8px] border p-4 mb-4" style={{ borderColor: 'var(--color-line)' }}>
          <p className="text-[12.5px] mb-2.5 leading-relaxed" style={{ color: 'var(--color-char-soft)' }}>
            Select a run of register numbers — full numbers (<span className="font-mono">RG/22/0101</span> to{' '}
            <span className="font-mono">RG/22/0150</span>) or just the last digits (<span className="font-mono">101</span> to{' '}
            <span className="font-mono">150</span>).
          </p>
          <div className="flex flex-wrap items-center gap-2.5">
            <input
              value={rangeFrom}
              onChange={(e) => setRangeFrom(e.target.value)}
              placeholder="From"
              className="h-9 w-[170px] px-3 font-mono text-[12.5px] rounded-[6px] border bg-transparent outline-none focus:border-[var(--color-gold)]"
              style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
            />
            <span className="text-[12px]" style={{ color: 'var(--color-char-soft)' }}>
              to
            </span>
            <input
              value={rangeTo}
              onChange={(e) => setRangeTo(e.target.value)}
              placeholder="To"
              className="h-9 w-[170px] px-3 font-mono text-[12.5px] rounded-[6px] border bg-transparent outline-none focus:border-[var(--color-gold)]"
              style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
            />
            {rangeFrom.trim() && rangeTo.trim() && <Chip tone={rangeMatches.length ? 'teal' : 'clay'}>{rangeMatches.length} in range</Chip>}
          </div>
          {rangeMatches.length > 0 && (
            <p className="mt-2.5 text-[12px] font-mono" style={{ color: 'var(--color-char-soft)' }}>
              {rangeMatches[0].rollNumber} … {rangeMatches[rangeMatches.length - 1].rollNumber}
            </p>
          )}
          <div className="flex flex-wrap gap-2 mt-3">
            <ActionButton
              primary
              disabled={rangeMatches.length === 0}
              onClick={() => {
                addIds(rangeMatches.map((u) => u.uid))
                setMode('list')
                setOnlySelected(true)
              }}
            >
              Add {rangeMatches.length} to selection
            </ActionButton>
            <ActionButton
              disabled={rangeMatches.length === 0}
              onClick={() => {
                setMemberIds(rangeMatches.map((u) => u.uid))
                setMode('list')
                setOnlySelected(true)
              }}
            >
              Replace selection with these
            </ActionButton>
          </div>
        </div>
      )}

      {/* The list — always visible so every method's result can be checked */}
      <div className="flex flex-wrap items-center gap-3 mb-2.5">
        <div className="relative flex-1 min-w-[200px] max-w-[280px]">
          <Icon name="search" className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5" style={{ color: 'var(--color-char-soft)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, register no., email…"
            className="w-full h-9 pl-8 pr-3 text-[13px] rounded-[6px] border bg-transparent outline-none focus:border-[var(--color-gold)]"
            style={{ borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
          />
        </div>
        <label className="inline-flex items-center gap-2 text-[12.5px] cursor-pointer select-none" style={{ color: 'var(--color-char-soft)' }}>
          <input type="checkbox" checked={onlySelected} onChange={(e) => setOnlySelected(e.target.checked)} />
          Show selected only
        </label>
        <div className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => (allVisibleOn ? setMemberIds(memberIds.filter((id) => !visible.some((u) => u.uid === id))) : addIds(visible.map((u) => u.uid)))}
            disabled={visible.length === 0}
            className="text-[12px] font-medium disabled:opacity-40"
            style={{ color: 'var(--color-gold)' }}
          >
            {allVisibleOn ? 'Unselect shown' : search || onlySelected ? `Select shown (${visible.length})` : 'Select all'}
          </button>
          <button
            type="button"
            onClick={() => setMemberIds([])}
            disabled={memberIds.length === 0}
            className="text-[12px] font-medium disabled:opacity-40"
            style={{ color: 'var(--color-char-soft)' }}
          >
            Clear all
          </button>
        </div>
      </div>
      <div className="rounded-[8px] border overflow-hidden max-h-[360px] overflow-y-auto" style={{ borderColor: 'var(--color-line)' }}>
        {visible.length === 0 ? (
          <p className="text-[12.5px] px-3 py-3" style={{ color: 'var(--color-char-soft)' }}>
            {onlySelected ? 'Nobody selected yet.' : 'No matches.'}
          </p>
        ) : (
          visible.map((u, i) => {
            const on = selectedSet.has(u.uid)
            return (
              <label
                key={u.uid}
                className="flex items-center gap-2.5 px-3 py-2.5 cursor-pointer transition-colors duration-150 hover:bg-black/[0.03]"
                style={{ borderTop: i > 0 ? '1px solid var(--color-line)' : undefined, backgroundColor: on ? 'var(--color-gold-soft)' : undefined }}
              >
                <input type="checkbox" checked={on} onChange={() => toggle(u.uid)} />
                <span className="font-mono text-[11.5px] w-[110px] shrink-0 truncate" style={{ color: 'var(--color-char-soft)' }}>
                  {u.rollNumber || '—'}
                </span>
                <span className="text-[13px] flex-1 min-w-0 truncate" style={{ color: 'var(--color-char)' }}>
                  {u.name}
                </span>
                <span className="text-[11px] shrink-0 hidden sm:inline truncate max-w-[200px]" style={{ color: 'var(--color-char-soft)' }}>
                  {u.email}
                </span>
              </label>
            )
          })
        )}
      </div>
    </div>
  )
}

function Chip({ tone, children }: { tone: 'teal' | 'clay' | 'gold'; children: React.ReactNode }) {
  const color = `var(--color-${tone})`
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11.5px] font-medium border"
      style={{ borderColor: `color-mix(in srgb, ${color} 40%, transparent)`, color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
  )
}

function ActionButton({ primary, disabled, onClick, children }: { primary?: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${primary ? 'chamfer-sm' : 'border'} px-4 py-2 text-[12.5px] font-medium transition-opacity disabled:opacity-40 disabled:cursor-not-allowed`}
      style={primary ? { backgroundColor: 'var(--color-ink)', color: 'var(--color-frost)' } : { borderColor: 'var(--color-line)', color: 'var(--color-char)' }}
    >
      {children}
    </button>
  )
}
