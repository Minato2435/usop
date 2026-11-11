import { useState } from 'react'
import type { TreeNode } from '../../types'
import { FormEngineIcon, type FormEngineIconName } from './icons'

export interface NumberedRow {
  node: TreeNode
  depth: number
  number: string
}

// Depth-first numbering ("1", "1.2", "1.2.1", ...). Pass a `collapsed` map to
// number only the currently visible rows (TreeBuilder); omit it (or pass {})
// to number the full tree regardless of collapse state (the preview dialog).
export function numberTree(
  nodes: TreeNode[],
  collapsed: Record<string, boolean> = {},
  parentId: string | null = null,
  depth = 0,
  prefix = '',
): NumberedRow[] {
  const siblings = nodes.filter((n) => n.parentId === parentId).sort((a, b) => a.order - b.order)
  return siblings.flatMap((n, i) => {
    const number = prefix ? `${prefix}.${i + 1}` : String(i + 1)
    const children = collapsed[n.id] ? [] : numberTree(nodes, collapsed, n.id, depth + 1, number)
    return [{ node: n, depth, number }, ...children]
  })
}

export function maxTreeDepth(nodes: TreeNode[]): number {
  if (nodes.length === 0) return 0
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const cache = new Map<string, number>()
  function depthOf(node: TreeNode): number {
    if (cache.has(node.id)) return cache.get(node.id)!
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    const d = parent ? depthOf(parent) + 1 : 0
    cache.set(node.id, d)
    return d
  }
  return Math.max(...nodes.map(depthOf)) + 1
}

interface TreeBuilderProps {
  nodes: TreeNode[]
  onAddChild: (parentId: string | null) => void
  onRename: (nodeId: string, title: string) => void
  onToggleRequired: (nodeId: string) => void
  onRemove: (nodeId: string) => void
  onInsert: (referenceNodeId: string, position: 'above' | 'below') => void
  onDuplicate: (nodeId: string) => void
}

export function TreeBuilder({
  nodes,
  onAddChild,
  onRename,
  onToggleRequired,
  onRemove,
  onInsert,
  onDuplicate,
}: TreeBuilderProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const childCount = new Map<string | null, number>()
  for (const n of nodes) childCount.set(n.parentId, (childCount.get(n.parentId) ?? 0) + 1)

  const rows = numberTree(nodes, collapsed)

  function toggleCollapse(id: string) {
    setCollapsed((c) => ({ ...c, [id]: !c[id] }))
  }
  function expandAll() {
    setCollapsed({})
  }
  function collapseAll() {
    const next: Record<string, boolean> = {}
    for (const n of nodes) if (childCount.get(n.id)) next[n.id] = true
    setCollapsed(next)
  }

  return (
    <>
      <div className="flex items-end justify-between gap-3 mb-4">
        <div>
          <h3 className="font-display text-[21px] leading-tight" style={{ color: 'var(--color-char)' }}>
            Field structure
          </h3>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
            Nest sub-fields under any field. Depth is unlimited.
          </p>
        </div>
        <div className="flex gap-1 shrink-0">
          <button onClick={expandAll} className="px-2.5 py-1 text-[12px] font-medium hover:opacity-70" style={{ color: 'var(--color-gold)' }}>
            Expand all
          </button>
          <button onClick={collapseAll} className="px-2.5 py-1 text-[12px] font-medium hover:opacity-70" style={{ color: 'var(--color-gold)' }}>
            Collapse all
          </button>
        </div>
      </div>

      <div className="border" style={{ backgroundColor: 'transparent', borderColor: '#d7d3d3' }}>
      {rows.length > 0 && (
        <div
          className="hidden md:flex items-center gap-4 px-5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] border-b whitespace-nowrap"
          style={{ color: 'var(--color-char-soft)', borderColor: '#d7d3d3' }}
        >
          <div className="flex-1 min-w-0">Field label</div>
          <div className="w-[78px] shrink-0 -ml-6 text-center">Required</div>
          <div className="w-[168px] shrink-0 text-right">Insert &amp; actions</div>
        </div>
      )}

      <div>
        {rows.length === 0 && (
          <p className="px-5 py-6 text-[13px]" style={{ color: 'var(--color-char-soft)' }}>
            No fields yet — add the first one below.
          </p>
        )}
        {rows.map(({ node, depth, number }) => (
          <Row
            key={node.id}
            node={node}
            depth={depth}
            number={number}
            isLeaf={!childCount.get(node.id)}
            collapsed={!!collapsed[node.id]}
            onToggleCollapse={() => toggleCollapse(node.id)}
            onAddChild={() => {
              setCollapsed((c) => ({ ...c, [node.id]: false }))
              onAddChild(node.id)
            }}
            onRename={(title) => onRename(node.id, title)}
            onToggleRequired={() => onToggleRequired(node.id)}
            onRemove={() => onRemove(node.id)}
            onInsertAbove={() => onInsert(node.id, 'above')}
            onInsertBelow={() => onInsert(node.id, 'below')}
            onDuplicate={() => onDuplicate(node.id)}
          />
        ))}
      </div>

      <div className="px-5 py-3.5">
        <button
          onClick={() => onAddChild(null)}
          className="inline-flex items-center gap-2 px-3.5 py-1.5 text-[13px] font-medium rounded-[3px] border transition-colors duration-150 hover:bg-[var(--color-gold-soft)]"
          style={{ borderColor: 'var(--color-gold)', color: 'var(--color-gold)' }}
        >
          <FormEngineIcon name="plus" className="h-3.5 w-3.5" />
          Add log field
        </button>
      </div>
      </div>
    </>
  )
}

function Row({
  node,
  depth,
  number,
  isLeaf,
  collapsed,
  onToggleCollapse,
  onAddChild,
  onRename,
  onToggleRequired,
  onRemove,
  onInsertAbove,
  onInsertBelow,
  onDuplicate,
}: {
  node: TreeNode
  depth: number
  number: string
  isLeaf: boolean
  collapsed: boolean
  onToggleCollapse: () => void
  onAddChild: () => void
  onRename: (title: string) => void
  onToggleRequired: () => void
  onRemove: () => void
  onInsertAbove: () => void
  onInsertBelow: () => void
  onDuplicate: () => void
}) {
  const [draft, setDraft] = useState(node.title)

  function commit() {
    const trimmed = draft.trim()
    if (trimmed !== node.title) onRename(trimmed)
  }

  return (
    <div
      className="flex items-center gap-4 px-5 py-2 border-b last:border-0 transition-colors duration-100 hover:bg-black/[0.015]"
      style={{ borderColor: '#d7d3d3' }}
    >
      <div className="flex-1 min-w-0 flex items-center gap-2" style={{ paddingLeft: depth * 22 }}>
        {!isLeaf ? (
          <button
            onClick={onToggleCollapse}
            className="shrink-0 h-5 w-5 flex items-center justify-center rounded-[3px] hover:bg-black/[0.06]"
            style={{ color: 'var(--color-char-soft)' }}
            aria-label={collapsed ? 'Expand' : 'Collapse'}
          >
            <FormEngineIcon
              name="chevron"
              className="h-3 w-3 transition-transform duration-150"
              style={{ transform: collapsed ? 'none' : 'rotate(90deg)' }}
            />
          </button>
        ) : (
          <span className="shrink-0 h-5 w-5 flex items-center justify-center">
            <span className="h-[5px] w-[5px] rounded-full" style={{ backgroundColor: 'var(--color-char-soft)', opacity: 0.5 }} />
          </span>
        )}
        <span className="shrink-0 w-9 font-mono text-[10.5px] tabular-nums" style={{ color: 'var(--color-char-soft)' }}>
          {number}
        </span>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => {
            commit()
            e.currentTarget.style.borderColor = 'transparent'
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
          placeholder="Untitled field"
          className="min-w-0 flex-1 bg-transparent text-[13.5px] py-0.5 border-b outline-none transition-colors duration-150"
          style={{ color: 'var(--color-char)', borderColor: 'transparent' }}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--color-gold-line)')}
        />
      </div>

      <div className="w-[78px] shrink-0 -ml-6 flex justify-center">
        <button
          onClick={onToggleRequired}
          aria-label="Required"
          className="w-[34px] h-[19px] rounded-full border flex items-center px-0 transition-colors duration-150"
          style={{
            borderColor: node.required ? 'var(--color-gold-line)' : '#d7d3d3',
            backgroundColor: node.required ? 'var(--color-gold-soft)' : 'var(--color-paper)',
          }}
        >
          <span
            className="h-[13px] w-[13px] rounded-full transition-[margin] duration-150"
            style={{ backgroundColor: node.required ? 'var(--color-gold)' : 'var(--color-char-soft)', marginLeft: node.required ? 17 : 2 }}
          />
        </button>
      </div>

      <div className="w-[168px] shrink-0 flex items-center justify-end">
        <div
          className="inline-flex items-center rounded-full border overflow-hidden"
          style={{ borderColor: '#d7d3d3' }}
        >
          <ToolbarButton onClick={onInsertAbove} title="Insert field above" icon="arrowUp" />
          <ToolbarDivider />
          <ToolbarButton onClick={onInsertBelow} title="Insert field below" icon="arrowDown" />
          <ToolbarDivider />
          <ToolbarButton onClick={onAddChild} title="Add a subfield inside this field" icon="corner" accent />
          <ToolbarDivider />
          <ToolbarButton onClick={onDuplicate} title="Duplicate with subfields" icon="copy" />
          <ToolbarDivider />
          <ToolbarButton onClick={onRemove} title="Remove field" icon="trash" tone="danger" />
        </div>
      </div>
    </div>
  )
}

// A single continuous pill toolbar rather than three visually separate
// controls (a stepper box, a labeled pill, bare icons) — one cohesive unit,
// color-coded by consequence: quiet neutral for reordering/duplicating,
// gold for the structural "add nested field" action, clay for remove.
function ToolbarButton({
  onClick,
  title,
  icon,
  accent,
  tone,
}: {
  onClick: () => void
  title: string
  icon: FormEngineIconName
  accent?: boolean
  tone?: 'danger'
}) {
  const color = tone === 'danger' ? 'var(--color-clay)' : accent ? 'var(--color-gold)' : 'var(--color-char-soft)'
  const hoverBg =
    tone === 'danger'
      ? 'var(--color-clay-soft)'
      : accent
        ? 'var(--color-gold-soft)'
        : 'color-mix(in srgb, var(--color-char) 7%, transparent)'
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className="h-7 w-7 flex items-center justify-center shrink-0 transition-colors duration-150"
      style={{ color }}
      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = hoverBg)}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
    >
      <FormEngineIcon name={icon} className="h-3.5 w-3.5" />
    </button>
  )
}

function ToolbarDivider() {
  return <span className="h-4 w-px shrink-0" style={{ backgroundColor: '#d7d3d3' }} />
}
