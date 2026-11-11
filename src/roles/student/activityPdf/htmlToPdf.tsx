import type { ReactNode } from 'react'
import { Link, Text, View } from '@react-pdf/renderer'
import type { Style } from '@react-pdf/stylesheet'

// Turns the student's rich-text description (Quill HTML, already passed
// through sanitizeRichText) into react-pdf elements: paragraphs, H2/H3,
// bulleted + numbered lists (nested), blockquotes, bold / italic /
// underline / strike, links, text colour, highlight, Quill sizes and
// alignment. Anything else falls back to its plain text.

// Clinical palette (same as ActivityRecordPdf).
const INK = '#0E2A47'
const SOFT = '#5B6B73'
const GOLD = '#0F766E' // accent: clinical teal
const GOLD_LINE = '#99D5CD'

const SIZE: Record<string, number> = { 'ql-size-small': 8.5, 'ql-size-large': 13, 'ql-size-huge': 17 }
const ALIGN: Record<string, Style['textAlign']> = { 'ql-align-center': 'center', 'ql-align-right': 'right', 'ql-align-justify': 'justify' }
const BLOCK = new Set(['P', 'DIV', 'H2', 'H3', 'UL', 'OL', 'BLOCKQUOTE', 'LI'])

function inlineStyle(el: Element): Style {
  const st: Style = {}
  const css = el.getAttribute('style') ?? ''
  const color = css.match(/(?:^|;)\s*color:\s*([^;]+)/i)?.[1]?.trim()
  const bg = css.match(/background-color:\s*([^;]+)/i)?.[1]?.trim()
  if (color) st.color = color
  if (bg) st.backgroundColor = bg
  for (const c of Array.from(el.classList)) if (SIZE[c]) st.fontSize = SIZE[c]
  return st
}

function blockAlign(el: Element): Style {
  for (const c of Array.from(el.classList)) if (ALIGN[c]) return { textAlign: ALIGN[c] }
  const a = (el.getAttribute('style') ?? '').match(/text-align:\s*(left|right|center|justify)/i)?.[1]
  return a ? { textAlign: a.toLowerCase() as Style['textAlign'] } : {}
}

function inline(node: Node, key: string): ReactNode {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (node.nodeType !== Node.ELEMENT_NODE) return null
  const el = node as Element
  const kids = Array.from(el.childNodes).map((c, i) => inline(c, `${key}.${i}`))
  switch (el.tagName) {
    case 'BR':
      return '\n'
    case 'STRONG':
    case 'B':
      return <Text key={key} style={{ fontWeight: 700 }}>{kids}</Text>
    case 'EM':
    case 'I':
      return <Text key={key} style={{ fontStyle: 'italic' }}>{kids}</Text>
    case 'U':
      return <Text key={key} style={{ textDecoration: 'underline' }}>{kids}</Text>
    case 'S':
    case 'STRIKE':
      return <Text key={key} style={{ textDecoration: 'line-through' }}>{kids}</Text>
    case 'A': {
      const href = el.getAttribute('href') ?? ''
      return /^(https?:|mailto:)/i.test(href) ? (
        <Link key={key} src={href} style={{ color: GOLD, textDecoration: 'underline' }}>
          {kids}
        </Link>
      ) : (
        <Text key={key}>{kids}</Text>
      )
    }
    default:
      return (
        <Text key={key} style={inlineStyle(el)}>
          {kids}
        </Text>
      )
  }
}

function list(el: Element, key: string, depth: number): ReactNode {
  const ordered = el.tagName === 'OL'
  const items = Array.from(el.children).filter((c) => c.tagName === 'LI')
  return (
    <View key={key} style={{ marginBottom: depth === 0 ? 5 : 0, paddingLeft: depth * 12 }}>
      {items.map((li, i) => {
        const inlineKids = Array.from(li.childNodes).filter((c) => !(c.nodeType === Node.ELEMENT_NODE && ['UL', 'OL'].includes((c as Element).tagName)))
        const nested = Array.from(li.children).filter((c) => c.tagName === 'UL' || c.tagName === 'OL')
        return (
          <View key={`${key}-${i}`}>
            <View wrap={false} style={{ flexDirection: 'row', marginBottom: 1.5 }}>
              <Text style={{ width: ordered ? 16 : 11, color: ordered ? GOLD : INK, fontWeight: ordered ? 600 : 400 }}>{ordered ? `${i + 1}.` : '•'}</Text>
              <Text style={[{ flex: 1 }, blockAlign(li)]}>{inlineKids.map((c, k) => inline(c, `${key}-${i}-${k}`))}</Text>
            </View>
            {nested.map((n, k) => list(n, `${key}-${i}-n${k}`, depth + 1))}
          </View>
        )
      })}
    </View>
  )
}

function blocks(nodes: Node[], key: string): ReactNode[] {
  const out: ReactNode[] = []
  let run: Node[] = []
  const flush = () => {
    const text = run.map((n) => n.textContent ?? '').join('')
    if (text.trim()) out.push(<Text key={`${key}-r${out.length}`} style={{ marginBottom: 5 }}>{run.map((n, i) => inline(n, `${key}-r${out.length}-${i}`))}</Text>)
    run = []
  }
  nodes.forEach((n, i) => {
    const el = n.nodeType === Node.ELEMENT_NODE ? (n as Element) : null
    if (!el || !BLOCK.has(el.tagName)) {
      run.push(n)
      return
    }
    flush()
    const k = `${key}-${i}`
    const kids = Array.from(el.childNodes)
    const empty = !(el.textContent ?? '').trim()
    switch (el.tagName) {
      case 'H2':
        out.push(<Text key={k} style={[{ fontWeight: 700, fontSize: 12, color: INK, marginTop: 3, marginBottom: 3 }, blockAlign(el)]}>{kids.map((c, j) => inline(c, `${k}.${j}`))}</Text>)
        break
      case 'H3':
        out.push(<Text key={k} style={[{ fontWeight: 700, fontSize: 10.5, color: INK, marginTop: 2, marginBottom: 2 }, blockAlign(el)]}>{kids.map((c, j) => inline(c, `${k}.${j}`))}</Text>)
        break
      case 'UL':
      case 'OL':
        out.push(list(el, k, 0))
        break
      case 'BLOCKQUOTE':
        out.push(
          <View key={k} wrap={false} style={{ borderLeftWidth: 2.5, borderLeftColor: GOLD_LINE, backgroundColor: '#F0F9F8', paddingVertical: 4, paddingLeft: 9, paddingRight: 9, marginBottom: 5 }}>
            <Text style={{ color: SOFT, fontStyle: 'italic' }}>{kids.map((c, j) => inline(c, `${k}.${j}`))}</Text>
          </View>,
        )
        break
      default: // P / DIV
        if (empty) out.push(<Text key={k} style={{ marginBottom: 3 }}> </Text>)
        else out.push(<Text key={k} style={[{ marginBottom: 5 }, blockAlign(el)]}>{kids.map((c, j) => inline(c, `${k}.${j}`))}</Text>)
    }
  })
  flush()
  // Drop trailing empty paragraphs Quill leaves behind.
  return out
}

export function htmlToPdf(html: string): ReactNode[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  return blocks(Array.from(doc.body.childNodes), 'd')
}

// Titles were sometimes saved with HTML entities ("IUCD Insertion &amp; Removal").
export function decodeEntities(s: string): string {
  if (!s || !s.includes('&')) return s
  return new DOMParser().parseFromString(`<body>${s}</body>`, 'text/html').body.textContent ?? s
}
