// `Submission.description` is student-authored rich text rendered in a
// faculty member's browser (and the student's own, on My Activity) via
// dangerouslySetInnerHTML. The RichTextEditor's own toolbar (React Quill)
// only ever produces a small set of tags, but the *document* is writable
// straight through the Firestore SDK/REST API by whoever owns the
// submission — not only through that editor's UI — so this sanitizes
// defensively rather than trusting whatever's stored, on both write and
// read paths.
//
// The toolbar covers headers, size, bold/italic/underline/strike, text
// color + highlight, ordered/bullet lists, blockquote, alignment, and
// links — every tag/attribute below exists because the editor can
// actually produce it, not preemptively. Attached photos/sketches are
// NOT part of this HTML — they live in `Submission.images` (a separate
// array field, shown in their own gallery/preview strip, never embedded
// in the rich text) — see lib/submissionImages.ts for those.
const ALLOWED_TAGS = new Set([
  'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'A', 'FONT', 'BR', 'DIV', 'SPAN', 'P',
  'H2', 'H3', 'UL', 'OL', 'LI', 'BLOCKQUOTE',
])
const ALLOWED_ATTRS: Record<string, string[]> = {
  A: ['href'],
  FONT: ['size'],
  // Quill encodes its "small/large/huge" size choice as a class
  // (ql-size-*) on a SPAN rather than a <font size>.
  SPAN: ['class'],
  LI: ['data-list'], // Quill's own marker for ordered vs. bullet list items
}
const SAFE_CLASS = /^ql-(size-(small|large|huge)|align-(center|right|justify)|indent-\d)$/
// Quill applies color/highlight/alignment as inline style, not a class —
// restricted to color/background-color with an rgb()/hex value, or a
// known-safe text-align keyword, never arbitrary CSS.
const SAFE_STYLE_DECL = /^(color|background-color):\s*(#[0-9a-fA-F]{3,8}|rgba?\([0-9.,\s]+\))$|^text-align:\s*(left|right|center|justify)$/i
// Attached images/sketches (`Submission.images`) live in Firebase Storage —
// see lib/submissionImages.ts (`isSafeImageUrl`) for how their URLs are vetted.

function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url, window.location.origin)
    return u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:'
  } catch {
    return false
  }
}

function sanitizeStyle(style: string): string {
  return style
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d && SAFE_STYLE_DECL.test(d))
    .join('; ')
}

export function sanitizeRichText(html: string): string {
  const template = document.createElement('template')
  template.innerHTML = html
  // A static snapshot (not a live NodeList) — safe to mutate/remove nodes
  // while iterating.
  const all = Array.from(template.content.querySelectorAll('*'))
  for (const el of all) {
    if (!ALLOWED_TAGS.has(el.tagName)) {
      // Unwrap rather than delete outright — drops the disallowed element
      // (e.g. <script>, <img>) but keeps any inert text it wrapped.
      while (el.firstChild) el.parentNode?.insertBefore(el.firstChild, el)
      el.remove()
      continue
    }
    const allowedAttrs = ALLOWED_ATTRS[el.tagName] ?? []
    for (const attr of Array.from(el.attributes)) {
      if (attr.name === 'style' || attr.name === 'class') continue // handled below
      if (!allowedAttrs.includes(attr.name)) el.removeAttribute(attr.name)
    }
    // style: allowed on any surviving element, restricted to safe
    // color/background/alignment declarations only.
    if (el.hasAttribute('style')) {
      const cleaned = sanitizeStyle(el.getAttribute('style')!)
      if (cleaned) el.setAttribute('style', cleaned)
      else el.removeAttribute('style')
    }
    // class: only SPAN's Quill-generated size/align/indent classes survive.
    if (el.tagName === 'SPAN' && el.hasAttribute('class')) {
      const kept = el.getAttribute('class')!.split(/\s+/).filter((c) => SAFE_CLASS.test(c))
      if (kept.length > 0) el.setAttribute('class', kept.join(' '))
      else el.removeAttribute('class')
    } else {
      el.removeAttribute('class')
    }
    if (el.tagName === 'A') {
      const href = el.getAttribute('href')
      if (!href || !isSafeUrl(href)) el.removeAttribute('href')
      el.setAttribute('rel', 'noopener noreferrer')
      el.setAttribute('target', '_blank')
    }
  }
  return template.innerHTML
}
