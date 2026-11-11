// Image generator for scripts/seedDemoActivities.mjs — no dependencies.
// A tiny anti-aliased rasteriser + PNG encoder, used to draw:
//   - "sketches": hand-drawn-looking labelled diagrams (ECG, sutures, heart,
//     lungs, eye, skin layers) on the same cream canvas + pen colours the
//     app's own sketch pad uses — saved as PNG, which is exactly how the app
//     tells a sketch apart from a photo.
//   - clinical-style "photos" (chest X-ray, ECG printout, fundus, dermoscopy,
//     suture pad) — rendered as PNG, then converted to JPEG by the caller
//     (photos in the app are always JPEG).

import zlib from 'node:zlib'

/* ------------------------------------------------------------------ */
/* RNG + colour helpers                                                */
/* ------------------------------------------------------------------ */

export function makeRng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

// The app's sketch-pad palette (RichTextEditor PEN_COLORS) and canvas colour.
const INK = hex('#0B1220')
const GOLD = hex('#B8863B')
const TEAL = hex('#2F7A6B')
const CLAY = hex('#AC5138')
const CANVAS = hex('#FFFDF8')

/* ------------------------------------------------------------------ */
/* Raster                                                              */
/* ------------------------------------------------------------------ */

class Raster {
  constructor(w, h, bg) {
    this.w = w
    this.h = h
    this.px = new Float32Array(w * h * 3)
    for (let i = 0; i < w * h; i++) {
      this.px[i * 3] = bg[0]
      this.px[i * 3 + 1] = bg[1]
      this.px[i * 3 + 2] = bg[2]
    }
  }

  blend(x, y, c, a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return
    const k = (y * this.w + x) * 3
    const p = this.px
    p[k] += (c[0] - p[k]) * a
    p[k + 1] += (c[1] - p[k + 1]) * a
    p[k + 2] += (c[2] - p[k + 2]) * a
  }

  // Polyline with round joins: per-stroke coverage mask (max), composited once.
  stroke(pts, width, c, alpha = 1) {
    if (pts.length < 2) return
    const r = width / 2
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y)
    }
    x0 = Math.max(0, Math.floor(x0 - r - 2)); y0 = Math.max(0, Math.floor(y0 - r - 2))
    x1 = Math.min(this.w - 1, Math.ceil(x1 + r + 2)); y1 = Math.min(this.h - 1, Math.ceil(y1 + r + 2))
    if (x1 < x0 || y1 < y0) return
    const mw = x1 - x0 + 1
    const mask = new Float32Array(mw * (y1 - y0 + 1))
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i]
      const [bx, by] = pts[i + 1]
      const dx = bx - ax, dy = by - ay
      const len2 = dx * dx + dy * dy || 1e-9
      const sx0 = Math.max(x0, Math.floor(Math.min(ax, bx) - r - 1)), sx1 = Math.min(x1, Math.ceil(Math.max(ax, bx) + r + 1))
      const sy0 = Math.max(y0, Math.floor(Math.min(ay, by) - r - 1)), sy1 = Math.min(y1, Math.ceil(Math.max(ay, by) + r + 1))
      for (let y = sy0; y <= sy1; y++) {
        const py = y + 0.5
        for (let x = sx0; x <= sx1; x++) {
          const px = x + 0.5
          let t = ((px - ax) * dx + (py - ay) * dy) / len2
          t = t < 0 ? 0 : t > 1 ? 1 : t
          const qx = ax + t * dx - px, qy = ay + t * dy - py
          const cov = clamp01(r + 0.5 - Math.sqrt(qx * qx + qy * qy))
          const mi = (y - y0) * mw + (x - x0)
          if (cov > mask[mi]) mask[mi] = cov
        }
      }
    }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const m = mask[(y - y0) * mw + (x - x0)]
      if (m > 0) this.blend(x, y, c, m * alpha)
    }
  }

  // Even-odd polygon fill, exact horizontal coverage on 4 sub-rows.
  fill(pts, c, alpha = 1) {
    let y0 = Infinity, y1 = -Infinity
    for (const [, y] of pts) { y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
    y0 = Math.max(0, Math.floor(y0)); y1 = Math.min(this.h - 1, Math.ceil(y1))
    const SUB = 4
    const row = new Float32Array(this.w)
    for (let y = y0; y <= y1; y++) {
      row.fill(0)
      for (let s = 0; s < SUB; s++) {
        const sy = y + (s + 0.5) / SUB
        const xs = []
        for (let i = 0; i < pts.length; i++) {
          const [ax, ay] = pts[i]
          const [bx, by] = pts[(i + 1) % pts.length]
          if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax))
        }
        xs.sort((a, b) => a - b)
        for (let i = 0; i + 1 < xs.length; i += 2) {
          const a = Math.max(0, xs[i]), b = Math.min(this.w, xs[i + 1])
          if (b <= a) continue
          for (let x = Math.floor(a); x < Math.ceil(b) && x < this.w; x++) {
            const ov = Math.min(b, x + 1) - Math.max(a, x)
            if (ov > 0) row[x] += ov / SUB
          }
        }
      }
      for (let x = 0; x < this.w; x++) if (row[x] > 0) this.blend(x, y, c, Math.min(1, row[x]) * alpha)
    }
  }

  ellipse(cx, cy, rx, ry, c, alpha = 1) {
    const pts = []
    const n = Math.max(24, Math.round((rx + ry) * 0.8))
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2
      pts.push([cx + Math.cos(t) * rx, cy + Math.sin(t) * ry])
    }
    this.fill(pts, c, alpha)
  }

  // Soft radial glow (gaussian falloff).
  blob(cx, cy, r, c, alpha = 1) {
    const R = r * 2
    for (let y = Math.max(0, Math.floor(cy - R)); y < Math.min(this.h, cy + R); y++)
      for (let x = Math.max(0, Math.floor(cx - R)); x < Math.min(this.w, cx + R); x++) {
        const d = Math.hypot(x - cx, y - cy) / r
        this.blend(x, y, c, alpha * Math.exp(-d * d * 1.6))
      }
  }

  blur(radius, passes = 2) {
    const { w, h } = this
    const tmp = new Float32Array(this.px.length)
    for (let p = 0; p < passes; p++) {
      for (const horizontal of [true, false]) {
        const src = this.px, dst = tmp
        const outer = horizontal ? h : w, inner = horizontal ? w : h
        for (let o = 0; o < outer; o++) {
          for (let ch = 0; ch < 3; ch++) {
            let acc = 0, cnt = 0
            const idx = (i) => ((horizontal ? o * w + i : i * w + o) * 3 + ch)
            for (let i = -radius; i <= radius; i++) if (i >= 0 && i < inner) { acc += src[idx(i)]; cnt++ }
            for (let i = 0; i < inner; i++) {
              dst[idx(i)] = acc / cnt
              const out = i - radius, inn = i + radius + 1
              if (out >= 0) { acc -= src[idx(out)]; cnt-- }
              if (inn < inner) { acc += src[idx(inn)]; cnt++ }
            }
          }
        }
        this.px.set(tmp)
      }
    }
  }

  noise(amount, rng) {
    for (let i = 0; i < this.w * this.h; i++) {
      const n = (rng() - 0.5) * amount
      this.px[i * 3] += n; this.px[i * 3 + 1] += n; this.px[i * 3 + 2] += n
    }
  }

  // Multiply towards black at the edges (lighting / lens falloff).
  vignette(strength, cx = this.w / 2, cy = this.h / 2) {
    const R = Math.hypot(this.w, this.h) / 2
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      const d = Math.hypot(x - cx, y - cy) / R
      const f = 1 - strength * d * d
      const k = (y * this.w + x) * 3
      this.px[k] *= f; this.px[k + 1] *= f; this.px[k + 2] *= f
    }
  }

  toPNG() {
    const { w, h } = this
    const raw = Buffer.alloc((w * 3 + 1) * h)
    for (let y = 0; y < h; y++) {
      raw[y * (w * 3 + 1)] = 0
      for (let x = 0; x < w * 3; x++) {
        const v = Math.round(this.px[y * w * 3 + x])
        raw[y * (w * 3 + 1) + 1 + x] = v < 0 ? 0 : v > 255 ? 255 : v
      }
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
    ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ])
  }
}

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}

/* ------------------------------------------------------------------ */
/* Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

function cubic(p0, p1, p2, p3, n = 24) {
  const out = []
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ])
  }
  return out
}

// Catmull-Rom through the given points (open or closed).
function smooth(pts, seg = 10, closed = false) {
  const out = []
  const n = pts.length
  const P = (i) => (closed ? pts[(i + n) % n] : pts[Math.max(0, Math.min(n - 1, i))])
  const last = closed ? n : n - 1
  for (let i = 0; i < last; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2)
    for (let s = 0; s < seg; s++) {
      const t = s / seg, t2 = t * t, t3 = t2 * t
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ])
    }
  }
  if (!closed) out.push(pts[n - 1])
  return out
}

// Gentle hand tremor: a smooth perpendicular offset along the path.
function wobble(pts, rng, amp = 1.2) {
  const f1 = 0.02 + rng() * 0.03, f2 = 0.07 + rng() * 0.05, ph1 = rng() * 6, ph2 = rng() * 6
  let dist = 0
  return pts.map((p, i) => {
    const q = pts[Math.min(pts.length - 1, i + 1)], o = pts[Math.max(0, i - 1)]
    const dx = q[0] - o[0], dy = q[1] - o[1]
    const l = Math.hypot(dx, dy) || 1
    if (i > 0) dist += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1])
    const off = amp * (Math.sin(dist * f1 + ph1) * 0.7 + Math.sin(dist * f2 + ph2) * 0.3)
    return [p[0] - (dy / l) * off, p[1] + (dx / l) * off]
  })
}

function densify(pts, step = 3) {
  const out = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i]
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step))
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n])
  }
  return out
}

function pen(r, pts, width, c, rng, amp = 1) {
  r.stroke(wobble(densify(pts), rng, amp), width, c)
}

function dashed(r, pts, width, c, rng, dash = 12, gap = 8) {
  const d = densify(pts, 2)
  let acc = 0, on = true, cur = [d[0]]
  for (let i = 1; i < d.length; i++) {
    acc += Math.hypot(d[i][0] - d[i - 1][0], d[i][1] - d[i - 1][1])
    if (on) cur.push(d[i])
    if (acc >= (on ? dash : gap)) {
      if (on && cur.length > 1) pen(r, cur, width, c, rng, 0.5)
      on = !on; acc = 0; cur = [d[i]]
    }
  }
  if (on && cur.length > 1) pen(r, cur, width, c, rng, 0.5)
}

function arrow(r, from, to, c, rng, width = 3) {
  pen(r, [from, to], width, c, rng, 0.8)
  const ang = Math.atan2(to[1] - from[1], to[0] - from[0])
  const L = 12 + width * 1.5
  for (const s of [-1, 1]) {
    const a = ang + Math.PI + s * 0.45
    r.stroke([to, [to[0] + Math.cos(a) * L, to[1] + Math.sin(a) * L]], width, c)
  }
}

function dot(r, x, y, rad, c) {
  r.ellipse(x, y, rad, rad, c)
}

/* ------------------------------------------------------------------ */
/* A small stroke font (capitals, digits) for hand-lettered labels     */
/* ------------------------------------------------------------------ */

const O_SHAPE = '1,0 3,0 4,1 4,5 3,6 1,6 0,5 0,1 1,0'
const P_SHAPE = '0,6 0,0 3,0 4,1 4,2 3,3 0,3'
const GLYPHS = {
  A: '0,6 2,0 4,6|0.8,3.8 3.2,3.8',
  B: '0,6 0,0 3,0 4,1 4,2 3,3 0,3|3,3 4,4 4,5 3,6 0,6',
  C: '4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5',
  D: '0,0 0,6 3,6 4,5 4,1 3,0 0,0',
  E: '4,0 0,0 0,6 4,6|0,3 3,3',
  F: '4,0 0,0 0,6|0,3 3,3',
  G: '4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5 4,3.5 2.2,3.5',
  H: '0,0 0,6|4,0 4,6|0,3 4,3',
  I: '1,0 3,0|2,0 2,6|1,6 3,6',
  J: '4,0 4,5 3,6 1,6 0,5',
  K: '0,0 0,6|4,0 0,3.6|1.3,2.8 4,6',
  L: '0,0 0,6 4,6',
  M: '0,6 0,0 2,3.2 4,0 4,6',
  N: '0,6 0,0 4,6 4,0',
  O: O_SHAPE,
  P: P_SHAPE,
  Q: `${O_SHAPE}|2.6,4.4 4.2,6.2`,
  R: `${P_SHAPE}|2,3 4,6`,
  S: '4,1 3,0 1,0 0,1 0,2 1,3 3,3 4,4 4,5 3,6 1,6 0,5',
  T: '0,0 4,0|2,0 2,6',
  U: '0,0 0,5 1,6 3,6 4,5 4,0',
  V: '0,0 2,6 4,0',
  W: '0,0 1,6 2,3 3,6 4,0',
  X: '0,0 4,6|4,0 0,6',
  Y: '0,0 2,3 4,0|2,3 2,6',
  Z: '0,0 4,0 0,6 4,6',
  0: `${O_SHAPE}|0.6,5.2 3.4,0.8`,
  1: '1,1.2 2,0 2,6|1,6 3,6',
  2: '0,1 1,0 3,0 4,1 4,2 0,6 4,6',
  3: '0,1 1,0 3,0 4,1 4,2 3,3 1.6,3|3,3 4,4 4,5 3,6 1,6 0,5',
  4: '3,6 3,0 0,4 4,4',
  5: '4,0 0.4,0 0,3 3,3 4,4 4,5 3,6 0,6',
  6: '4,1 3,0 1,0 0,1 0,5 1,6 3,6 4,5 4,4 3,3 0,3',
  7: '0,0 4,0 1.4,6',
  8: '1,3 0,2 0,1 1,0 3,0 4,1 4,2 3,3 1,3 0,4 0,5 1,6 3,6 4,5 4,4 3,3',
  9: '0,5 1,6 3,6 4,5 4,1 3,0 1,0 0,1 0,2 1,3 4,3',
  '-': '0.8,3 3.2,3',
  '/': '0,6 4,0',
  '.': '1.8,5.6 2.2,5.6',
  ':': '2,1.6 2,1.9|2,4.6 2,4.9',
  '(': '2.6,0 1.4,1.5 1.4,4.5 2.6,6',
  ')': '1.4,0 2.6,1.5 2.6,4.5 1.4,6',
  '+': '2,1.4 2,4.6|0.4,3 3.6,3',
  '>': '0.6,0.8 3.6,3 0.6,5.2',
}

function textWidth(str, size) {
  const u = size / 6
  let w = 0
  for (const ch of str) w += ch === ' ' ? 3.6 * u : 5.6 * u
  return w - 1.6 * u
}

function text(r, str, x, y, size, c, rng, width) {
  const u = size / 6
  const lw = width ?? Math.max(1.6, size / 9)
  let cx = x
  for (const ch of str.toUpperCase()) {
    if (ch === ' ') { cx += 3.6 * u; continue }
    const g = GLYPHS[ch]
    if (g) {
      const slant = 0.12 + (rng() - 0.5) * 0.06
      const dy = (rng() - 0.5) * u * 0.5
      for (const part of g.split('|')) {
        const pts = part.split(' ').map((p) => {
          const [gx, gy] = p.split(',').map(Number)
          return [cx + gx * u + (6 - gy) * u * slant, y + gy * u + dy]
        })
        r.stroke(wobble(densify(pts, 2), rng, 0.25), lw, c)
      }
    }
    cx += 5.6 * u
  }
  return cx
}

function label(r, str, at, textPos, rng, c = INK, size = 15) {
  // leader line from the text to the feature, with a dot at the feature
  const tw = textWidth(str, size)
  const leftSide = textPos[0] < at[0]
  const anchor = leftSide ? [textPos[0] + tw + 6, textPos[1] + size / 2] : [textPos[0] - 6, textPos[1] + size / 2]
  pen(r, [anchor, at], 1.6, c, rng, 0.6)
  dot(r, at[0], at[1], 3, c)
  text(r, str, textPos[0], textPos[1], size, c, rng)
}

function title(r, str, rng) {
  const end = text(r, str, 34, 26, 19, INK, rng, 2.4)
  pen(r, [[32, 56], [end + 6, 55]], 3, GOLD, rng, 0.8)
}

/* ------------------------------------------------------------------ */
/* Sketches (cream canvas, app pen colours, PNG)                       */
/* ------------------------------------------------------------------ */

const SW = 760, SH = 440

function ecgBeat(t, st) {
  // t: px within a 150px beat; returns y offset (negative = up)
  const bump = (a, b, amp) => (t >= a && t <= b ? -amp * Math.sin(((t - a) / (b - a)) * Math.PI) : 0)
  let y = bump(18, 44, 12)
  if (t >= 58 && t < 63) y = ((t - 58) / 5) * 9
  else if (t >= 63 && t < 70) y = 9 - ((t - 63) / 7) * 121
  else if (t >= 70 && t < 78) y = -112 + ((t - 70) / 8) * 140
  else if (t >= 78 && t < 86) y = 28 - ((t - 78) / 8) * (28 + st)
  else if (t >= 86 && t < 108) y = -st
  else if (t >= 108 && t <= 146) y = -st * (1 - (t - 108) / 38) - 30 * Math.sin(((t - 108) / 38) * Math.PI)
  return y
}

function sketchEcg(r, rng) {
  title(r, 'ECG - LEAD II', rng)
  const base = 250, period = 150 + Math.round(rng() * 16)
  const pts = []
  for (let x = 40; x <= 720; x += 1.5) {
    const beat = Math.floor((x - 40) / period)
    const t = (x - 40) % period
    const st = beat >= 2 ? 16 : 0
    pts.push([x, base + ecgBeat(t, st)])
  }
  pen(r, pts, 3, INK, rng, 0.6)
  const b0 = 40, b1 = 40 + period, b2 = 40 + 2 * period
  text(r, 'P', b0 + 26, base - 46, 15, TEAL, rng)
  text(r, 'QRS', b1 + 52, base - 150, 15, TEAL, rng)
  text(r, 'T', b1 + 122, base - 66, 15, TEAL, rng)
  // PR interval bracket
  const py = base + 48
  pen(r, [[b0 + 18, py], [b0 + 63, py]], 2.4, GOLD, rng, 0.4)
  pen(r, [[b0 + 18, py - 7], [b0 + 18, py + 7]], 2.4, GOLD, rng, 0.3)
  pen(r, [[b0 + 63, py - 7], [b0 + 63, py + 7]], 2.4, GOLD, rng, 0.3)
  text(r, 'PR', b0 + 30, py + 14, 14, GOLD, rng)
  // ST elevation
  arrow(r, [b2 + 150, base + 95], [b2 + 98, base - 12], CLAY, rng, 3)
  text(r, 'ST ELEVATION', b2 + 112, base + 104, 15, CLAY, rng)
  text(r, `RATE ${Math.round(60 / ((period / 150) * 0.8))} / MIN`, 520, 384, 15, INK, rng)
  text(r, 'SINUS RHYTHM', 40, 384, 15, INK, rng)
}

function sketchSutures(r, rng) {
  title(r, 'SIMPLE INTERRUPTED SUTURES', rng)
  const wound = smooth([[100, 250], [260, 236], [420, 244], [560, 232], [660, 240]], 14)
  // wound edges
  pen(r, wound.map(([x, y]) => [x, y - 6]), 2, INK, rng, 0.8)
  pen(r, wound.map(([x, y]) => [x, y + 6]), 2, INK, rng, 0.8)
  pen(r, wound, 4, CLAY, rng, 0.6)
  const n = 7
  const knots = []
  for (let i = 0; i < n; i++) {
    const idx = Math.round(((i + 0.5) / n) * (wound.length - 1))
    const [x, y] = wound[idx]
    const top = [x - 2 + (rng() - 0.5) * 3, y - 34], bot = [x + 2 + (rng() - 0.5) * 3, y + 34]
    pen(r, [top, bot], 3, INK, rng, 0.4)
    dot(r, top[0], top[1], 3.5, INK)
    dot(r, bot[0], bot[1], 3.5, INK)
    // knot on the side + cut tails
    const k = [x + 12, y - 30]
    dot(r, k[0], k[1], 5, INK)
    pen(r, [k, [k[0] + 12, k[1] - 12]], 2, INK, rng, 0.3)
    pen(r, [k, [k[0] + 16, k[1] - 4]], 2, INK, rng, 0.3)
    knots.push(k)
  }
  // spacing bracket between stitch 2 and 3
  const s2 = wound[Math.round((2.5 / n) * (wound.length - 1))], s3 = wound[Math.round((3.5 / n) * (wound.length - 1))]
  const by = s2[1] + 70
  pen(r, [[s2[0], by], [s3[0], by]], 2.4, TEAL, rng, 0.4)
  pen(r, [[s2[0], by - 7], [s2[0], by + 7]], 2.4, TEAL, rng, 0.3)
  pen(r, [[s3[0], by - 7], [s3[0], by + 7]], 2.4, TEAL, rng, 0.3)
  text(r, '5 MM', (s2[0] + s3[0]) / 2 - 20, by + 14, 14, TEAL, rng)
  label(r, 'KNOT TO ONE SIDE', knots[0], [70, 110], rng, INK, 14)
  label(r, 'WOUND EDGE', [wound[40][0], wound[40][1] + 7], [470, 360], rng, CLAY, 14)
  text(r, 'EDGES EVERTED - EQUAL BITES', 60, 392, 14, GOLD, rng)
}

function sketchHeart(r, rng) {
  title(r, 'HEART - BLOOD FLOW', rng)
  const cx = 380, cy = 255
  const outline = [
    ...cubic([cx, cy - 70], [cx - 40, cy - 140], [cx - 190, cy - 110], [cx - 170, cy - 10], 30),
    ...cubic([cx - 170, cy - 10], [cx - 155, cy + 70], [cx - 60, cy + 120], [cx + 10, cy + 160], 30).slice(1),
    ...cubic([cx + 10, cy + 160], [cx + 90, cy + 110], [cx + 175, cy + 60], [cx + 175, cy - 20], 30).slice(1),
    ...cubic([cx + 175, cy - 20], [cx + 185, cy - 115], [cx + 40, cy - 140], [cx, cy - 70], 30).slice(1),
  ]
  pen(r, outline, 4, INK, rng, 1)
  // septum + AV groove
  pen(r, smooth([[cx, cy - 70], [cx - 6, cy + 10], [cx + 4, cy + 90], [cx + 10, cy + 158]], 10), 2.6, INK, rng, 0.8)
  pen(r, smooth([[cx - 165, cy - 5], [cx - 60, cy + 12], [cx + 60, cy + 6], [cx + 172, cy - 10]], 10), 2.2, GOLD, rng, 0.8)
  // aorta + pulmonary trunk
  pen(r, smooth([[cx + 30, cy - 110], [cx + 20, cy - 170], [cx + 100, cy - 195], [cx + 150, cy - 150]], 10), 4, CLAY, rng, 0.8)
  pen(r, smooth([[cx - 30, cy - 105], [cx - 50, cy - 160], [cx - 110, cy - 175]], 10), 4, TEAL, rng, 0.8)
  text(r, 'RA', cx - 110, cy - 55, 20, INK, rng)
  text(r, 'LA', cx + 80, cy - 60, 20, INK, rng)
  text(r, 'RV', cx - 85, cy + 45, 20, INK, rng)
  text(r, 'LV', cx + 60, cy + 40, 20, INK, rng)
  arrow(r, [cx - 95, cy - 20], [cx - 70, cy + 35], TEAL, rng)
  arrow(r, [cx - 30, cy + 70], [cx - 30, cy - 90], TEAL, rng)
  arrow(r, [cx + 100, cy - 20], [cx + 85, cy + 30], CLAY, rng)
  arrow(r, [cx + 40, cy + 75], [cx + 40, cy - 100], CLAY, rng)
  text(r, 'AORTA', cx + 160, cy - 165, 15, CLAY, rng)
  text(r, 'PULM. TRUNK', cx - 260, cy - 190, 15, TEAL, rng)
  text(r, 'DEOXYGENATED', 40, 392, 13, TEAL, rng)
  text(r, 'OXYGENATED', 560, 392, 13, CLAY, rng)
}

function sketchLungs(r, rng) {
  title(r, 'LUNGS - AUSCULTATION POINTS', rng)
  const cx = 380
  pen(r, [[cx - 12, 70], [cx - 12, 170]], 3, INK, rng, 0.5)
  pen(r, [[cx + 12, 70], [cx + 12, 170]], 3, INK, rng, 0.5)
  for (let y = 84; y < 170; y += 14) pen(r, [[cx - 12, y], [cx + 12, y]], 1.6, INK, rng, 0.2)
  const right = smooth([[cx - 30, 120], [cx - 110, 110], [cx - 190, 180], [cx - 215, 300], [cx - 190, 385], [cx - 70, 380], [cx - 35, 300], [cx - 30, 200]], 10, true)
  const left = smooth([[cx + 30, 120], [cx + 110, 110], [cx + 190, 180], [cx + 215, 300], [cx + 190, 385], [cx + 100, 382], [cx + 60, 330], [cx + 80, 280], [cx + 40, 220]], 10, true)
  pen(r, [...right, right[0]], 3.6, INK, rng, 1)
  pen(r, [...left, left[0]], 3.6, INK, rng, 1)
  // bronchial tree
  for (const s of [-1, 1]) {
    pen(r, [[cx, 170], [cx + s * 60, 215]], 4, GOLD, rng, 0.5)
    pen(r, [[cx + s * 60, 215], [cx + s * 110, 200]], 3, GOLD, rng, 0.5)
    pen(r, [[cx + s * 60, 215], [cx + s * 105, 270]], 3, GOLD, rng, 0.5)
    pen(r, [[cx + s * 105, 270], [cx + s * 140, 320]], 2, GOLD, rng, 0.5)
    pen(r, [[cx + s * 105, 270], [cx + s * 150, 260]], 2, GOLD, rng, 0.5)
  }
  dashed(r, smooth([[cx - 200, 235], [cx - 130, 280], [cx - 60, 330]], 8), 2.4, CLAY, rng)
  dashed(r, smooth([[cx + 200, 210], [cx + 130, 270], [cx + 70, 340]], 8), 2.4, CLAY, rng)
  const points = [[cx - 120, 160], [cx + 120, 160], [cx - 178, 300], [cx + 182, 300], [cx - 105, 362], [cx + 150, 362]]
  points.forEach(([x, y], i) => {
    r.stroke(wobble(densify(smooth([[x + 14, y], [x, y + 14], [x - 14, y], [x, y - 14]], 6, true).concat([[x + 14, y]])), rng, 0.4), 2.6, TEAL)
    text(r, String(i + 1), x - 5, y - 8, 15, TEAL, rng)
  })
  text(r, 'R', cx - 290, 230, 22, INK, rng)
  text(r, 'L', cx + 270, 230, 22, INK, rng)
  label(r, 'TRACHEA', [cx + 14, 100], [cx + 70, 72], rng, INK, 14)
  text(r, 'FISSURES', 40, 400, 13, CLAY, rng)
}

function sketchEye(r, rng) {
  title(r, 'EYE - EXTERNAL EXAMINATION', rng)
  const cx = 380, cy = 240
  const upper = cubic([cx - 210, cy], [cx - 110, cy - 130], [cx + 110, cy - 130], [cx + 210, cy], 40)
  const lower = cubic([cx - 210, cy], [cx - 100, cy + 100], [cx + 100, cy + 100], [cx + 210, cy], 40)
  // conjunctival vessels in the sclera
  for (let i = 0; i < 7; i++) {
    const side = i % 2 ? 1 : -1
    const x0 = cx + side * (110 + rng() * 70), y0 = cy + (rng() - 0.5) * 50
    pen(r, smooth([[x0, y0], [x0 - side * 20, y0 + (rng() - 0.5) * 18], [x0 - side * 42, y0 + (rng() - 0.5) * 22]], 6), 1.4, CLAY, rng, 0.8)
  }
  r.ellipse(cx, cy, 72, 72, [214, 232, 226])
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2
    r.stroke([[cx + Math.cos(a) * 32, cy + Math.sin(a) * 32], [cx + Math.cos(a) * 68, cy + Math.sin(a) * 68]], 1.2, TEAL, 0.7)
  }
  r.stroke(wobble(densify(smooth(Array.from({ length: 16 }, (_, i) => [cx + Math.cos((i / 16) * 6.283) * 72, cy + Math.sin((i / 16) * 6.283) * 72]), 6, true)), rng, 0.5), 4, TEAL)
  r.ellipse(cx, cy, 30, 30, INK)
  r.ellipse(cx - 12, cy - 13, 8, 8, CANVAS)
  pen(r, upper, 4.4, INK, rng, 0.8)
  pen(r, lower, 3.2, INK, rng, 0.8)
  for (let i = 3; i < 38; i += 3) {
    const [x, y] = upper[i]
    const nx = (x - cx) / 210
    pen(r, [[x, y], [x + nx * 14, y - 16]], 2, INK, rng, 0.2)
  }
  label(r, 'PUPIL', [cx + 18, cy + 14], [cx + 120, 360], rng, INK, 14)
  label(r, 'IRIS', [cx - 54, cy + 40], [100, 360], rng, TEAL, 14)
  arrow(r, [640, 150], [cx + 150, cy - 10], CLAY, rng)
  text(r, 'CONGESTION', 560, 118, 14, CLAY, rng)
  text(r, 'PERRLA - NORMAL', 470, 396, 14, GOLD, rng)
}

function sketchSkin(r, rng) {
  title(r, 'SKIN - LAYERS', rng)
  const x0 = 70, x1 = 520
  const surface = smooth(Array.from({ length: 10 }, (_, i) => [x0 + (i * (x1 - x0)) / 9, 120 + Math.sin(i * 1.3) * 4]), 8)
  const ridges = []
  for (let x = x0; x <= x1; x += 4) ridges.push([x, 160 + Math.sin((x - x0) / 14) * 10])
  pen(r, surface, 4, INK, rng, 0.6)
  pen(r, ridges, 2.2, INK, rng, 0.4)
  dashed(r, [[x0, 290], [x1, 290]], 2.4, GOLD, rng)
  pen(r, [[x0, 120], [x0, 390]], 2, INK, rng, 0.5)
  pen(r, [[x1, 120], [x1, 390]], 2, INK, rng, 0.5)
  // fat lobules
  for (let y = 312; y < 385; y += 26) for (let x = x0 + 22; x < x1 - 14; x += 30) {
    const ox = x + ((y / 26) % 2 ? 14 : 0)
    if (ox > x1 - 14) continue
    r.stroke(densify(smooth(Array.from({ length: 8 }, (_, i) => [ox + Math.cos((i / 8) * 6.283) * 12, y + Math.sin((i / 8) * 6.283) * 10]), 5, true)), 1.8, GOLD)
  }
  // hair follicle
  const fx = 200
  pen(r, [[fx - 5, 78], [fx, 120]], 3, INK, rng, 0.3)
  pen(r, smooth([[fx - 10, 122], [fx - 14, 200], [fx - 16, 262]], 8), 2.4, INK, rng, 0.5)
  pen(r, smooth([[fx + 10, 122], [fx + 14, 200], [fx + 16, 262]], 8), 2.4, INK, rng, 0.5)
  r.stroke(densify(smooth(Array.from({ length: 10 }, (_, i) => [fx + Math.cos((i / 10) * 6.283) * 20, 275 + Math.sin((i / 10) * 6.283) * 16]), 5, true)), 2.6, INK)
  // sweat gland
  const gx = 360
  pen(r, smooth([[gx, 120], [gx + 6, 170], [gx - 4, 215], [gx + 4, 256]], 8), 2, TEAL, rng, 0.4)
  const coil = []
  for (let t = 0; t < 6.283 * 3; t += 0.2) coil.push([gx + 4 + Math.cos(t) * 16 + t * 0.6, 268 + Math.sin(t) * 9])
  pen(r, coil, 2, TEAL, rng, 0.3)
  // blood vessel
  pen(r, Array.from({ length: 60 }, (_, i) => [x0 + 10 + i * 7.3, 228 + Math.sin(i / 3) * 6]), 2.4, CLAY, rng, 0.3)
  label(r, 'EPIDERMIS', [x1 - 6, 140], [570, 128], rng, INK, 14)
  label(r, 'DERMIS', [x1 - 6, 220], [570, 208], rng, INK, 14)
  label(r, 'HYPODERMIS', [x1 - 6, 340], [570, 330], rng, GOLD, 14)
  label(r, 'HAIR FOLLICLE', [fx - 16, 240], [80, 410], rng, INK, 13)
  label(r, 'SWEAT GLAND', [gx + 22, 276], [300, 410], rng, TEAL, 13)
}

export const SKETCHES = { ecg: sketchEcg, sutures: sketchSutures, heart: sketchHeart, lungs: sketchLungs, eye: sketchEye, skin: sketchSkin }

export function renderSketch(kind, seed) {
  const rng = makeRng(seed)
  const r = new Raster(SW, SH, CANVAS)
  SKETCHES[kind](r, rng)
  return r.toPNG()
}

/* ------------------------------------------------------------------ */
/* Clinical-style photos (PNG here; the caller converts to JPEG)       */
/* ------------------------------------------------------------------ */

function photoXray(rng) {
  const W = 640, H = 720
  const r = new Raster(W, H, [14, 14, 16])
  const cx = W / 2 + (rng() - 0.5) * 10
  r.fill(smooth([[cx - 290, 720], [cx - 280, 260], [cx - 230, 120], [cx - 90, 70], [cx + 90, 70], [cx + 230, 120], [cx + 280, 260], [cx + 290, 720]], 10), [92, 92, 96])
  r.fill(smooth([[cx - 36, 120], [cx - 150, 140], [cx - 225, 260], [cx - 230, 470], [cx - 170, 545], [cx - 40, 510]], 10), [26, 26, 30])
  r.fill(smooth([[cx + 36, 120], [cx + 150, 140], [cx + 225, 260], [cx + 230, 470], [cx + 170, 548], [cx + 70, 520], [cx + 30, 420]], 10), [26, 26, 30])
  r.blob(cx + 55, 430, 110, [150, 150, 154], 0.75)
  r.blob(cx + 10, 380, 70, [140, 140, 144], 0.5)
  r.stroke([[cx, 60], [cx, 720]], 34, [168, 168, 172], 0.85)
  for (let i = 0; i < 10; i++) {
    const y = 150 + i * 42
    for (const s of [-1, 1]) {
      r.stroke(smooth([[cx + s * 20, y], [cx + s * 120, y - 22], [cx + s * 210, y + 10], [cx + s * 230, y + 60]], 10), 9, [160, 160, 164], 0.42)
    }
  }
  for (const s of [-1, 1]) r.stroke(smooth([[cx + s * 30, 125], [cx + s * 130, 112], [cx + s * 240, 95]], 10), 13, [190, 190, 194], 0.7)
  r.fill(smooth([[cx - 260, 720], [cx - 240, 560], [cx - 120, 520], [cx - 30, 560], [cx + 40, 575], [cx + 140, 535], [cx + 245, 575], [cx + 265, 720]], 10), [120, 120, 124], 0.85)
  r.blur(4, 2)
  r.noise(12, rng)
  r.vignette(0.5)
  r.fill([[22, 22], [72, 22], [72, 72], [22, 72]], [235, 235, 235], 0.9)
  text(r, 'R', 34, 30, 34, [20, 20, 22], rng, 4)
  return r.toPNG()
}

function photoEcgPaper(rng) {
  const W = 900, H = 560
  const r = new Raster(W, H, [252, 236, 236])
  for (let x = 0; x < W; x += 10) r.stroke([[x, 0], [x, H]], x % 50 === 0 ? 1.6 : 0.8, [236, 160, 160], x % 50 === 0 ? 0.9 : 0.6)
  for (let y = 0; y < H; y += 10) r.stroke([[0, y], [W, y]], y % 50 === 0 ? 1.6 : 0.8, [236, 160, 160], y % 50 === 0 ? 0.9 : 0.6)
  const leads = ['I', 'II', 'V1']
  leads.forEach((name, li) => {
    const base = 150 + li * 150, period = 140 + Math.round(rng() * 20), scale = 0.55 + li * 0.08
    const pts = []
    for (let x = 60; x < W - 30; x += 1.2) {
      const t = (x - 60) % period
      pts.push([x, base + ecgBeat(t * 1.05, li === 1 ? 8 : 0) * scale + (rng() - 0.5) * 0.8])
    }
    r.stroke(pts, 2.2, [26, 26, 30])
    text(r, name, 20, base - 50, 20, [26, 26, 30], rng, 2.2)
  })
  // light falloff, like a phone photo of a printout
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const f = 1.04 - 0.12 * (x / W) - 0.1 * (y / H)
    const k = (y * W + x) * 3
    r.px[k] *= f; r.px[k + 1] *= f; r.px[k + 2] *= f
  }
  r.blur(1, 1)
  r.noise(6, rng)
  r.vignette(0.35, W * 0.4, H * 0.4)
  return r.toPNG()
}

function photoFundus(rng) {
  const W = 680, H = 680
  const r = new Raster(W, H, [6, 4, 4])
  const cx = W / 2, cy = H / 2
  r.ellipse(cx, cy, 300, 300, [176, 70, 34])
  r.blob(cx, cy, 260, [214, 104, 52], 0.65)
  const dx = cx + 95 + (rng() - 0.5) * 20, dy = cy - 10 + (rng() - 0.5) * 20
  const mx = cx - 110, my = cy + 10
  r.blob(mx, my, 55, [120, 40, 22], 0.7)
  // vessels from the disc
  const vessel = (ang, len, w, c) => {
    const pts = [[dx, dy]]
    let a = ang, x = dx, y = dy
    for (let i = 0; i < 22; i++) {
      a += (rng() - 0.5) * 0.35 + (ang > 0 ? -0.02 : 0.02)
      x += Math.cos(a) * (len / 22); y += Math.sin(a) * (len / 22)
      pts.push([x, y])
      if (i === 9 || i === 15) {
        const b = []
        let ba = a + (rng() > 0.5 ? 0.6 : -0.6), bx = x, bY = y
        for (let k = 0; k < 10; k++) { ba += (rng() - 0.5) * 0.3; bx += Math.cos(ba) * 13; bY += Math.sin(ba) * 13; b.push([bx, bY]) }
        r.stroke(smooth([[x, y], ...b], 4), w * 0.55, c, 0.9)
      }
    }
    r.stroke(smooth(pts, 4), w, c, 0.95)
  }
  for (const [ang, c] of [[-2.3, [110, 22, 18]], [2.4, [110, 22, 18]], [-2.6, [150, 40, 30]], [2.7, [150, 40, 30]], [-1.3, [140, 34, 26]], [1.2, [140, 34, 26]]]) vessel(ang, 260 + rng() * 60, 6, c)
  r.blob(dx, dy, 40, [252, 226, 160], 0.95)
  r.blob(dx + 6, dy - 2, 18, [255, 244, 210], 0.9)
  r.blur(1, 1)
  r.noise(7, rng)
  // circular field stop
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - cx, y - cy)
    if (d > 300) { const k = (y * W + x) * 3; const f = clamp01((d - 300) / 3); r.px[k] *= 1 - f; r.px[k + 1] *= 1 - f; r.px[k + 2] *= 1 - f }
  }
  return r.toPNG()
}

function photoDermoscopy(rng) {
  const W = 680, H = 680
  const r = new Raster(W, H, [222, 178, 152])
  const cx = W / 2 + (rng() - 0.5) * 30, cy = H / 2 - 20
  for (let i = 0; i < 1400; i++) r.ellipse(rng() * W, rng() * H, 1.2, 1.2, [196, 150, 126], 0.5)
  for (let i = 0; i < 9; i++) r.blob(cx + (rng() - 0.5) * 120, cy + (rng() - 0.5) * 110, 60 + rng() * 40, [128, 78, 52], 0.55)
  for (let i = 0; i < 260; i++) {
    const a = rng() * 6.283, d = Math.sqrt(rng()) * 110
    r.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.9, 2.5 + rng() * 2.5, 2.5 + rng() * 2.5, [78, 44, 30], 0.55)
  }
  for (let i = 0; i < 5; i++) r.blob(cx + (rng() - 0.5) * 60, cy + (rng() - 0.5) * 60, 14, [60, 34, 26], 0.6)
  r.blur(2, 1)
  // ruler
  r.fill([[150, 560], [530, 560], [530, 600], [150, 600]], [246, 246, 240], 0.95)
  for (let i = 0; i <= 38; i++) {
    const x = 160 + i * 9.7
    r.stroke([[x, 560], [x, 560 + (i % 10 === 0 ? 22 : i % 5 === 0 ? 15 : 9)]], 1.4, [30, 30, 30])
  }
  for (let i = 0; i <= 3; i++) text(r, String(i), 162 + i * 97, 584, 12, [30, 30, 30], rng, 1.6)
  r.noise(8, rng)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.hypot(x - W / 2, y - H / 2)
    if (d > 300) { const k = (y * W + x) * 3; const f = clamp01((d - 300) / 4); r.px[k] *= 1 - f; r.px[k + 1] *= 1 - f; r.px[k + 2] *= 1 - f }
  }
  r.vignette(0.35)
  return r.toPNG()
}

function photoSuturePad(rng) {
  const W = 820, H = 560
  const r = new Raster(W, H, [62, 112, 120])
  for (let i = -H; i < W; i += 6) r.stroke([[i, 0], [i + H, H]], 1, [80, 130, 138], 0.25)
  const pad = []
  const corners = [[680, 140, -Math.PI / 2], [680, 430, 0], [150, 430, Math.PI / 2], [150, 140, Math.PI]]
  for (const [ccx, ccy, a0] of corners) for (let i = 0; i <= 8; i++) {
    const a = a0 + (i / 8) * (Math.PI / 2)
    pad.push([ccx + Math.cos(a) * 26, ccy + Math.sin(a) * 26])
  }
  r.fill(pad.map(([x, y]) => [x + 14, y + 18]), [20, 40, 44], 0.6)
  r.blur(6, 2)
  r.fill(pad, [232, 176, 164])
  r.blob(330, 200, 120, [248, 214, 204], 0.35)
  r.blob(560, 380, 130, [210, 150, 140], 0.3)
  const wound = smooth([[210, 290], [350, 280], [480, 292], [620, 282]], 14)
  r.stroke(wound, 5, [150, 52, 50])
  r.stroke(wound.map(([x, y]) => [x, y + 3]), 2, [120, 36, 36], 0.6)
  for (let i = 0; i < 6; i++) {
    const [x, y] = wound[Math.round(((i + 0.5) / 6) * (wound.length - 1))]
    r.stroke([[x - 2, y - 28], [x + 2, y + 28]], 3.2, [30, 38, 90])
    r.ellipse(x + 8, y - 26, 4.5, 4.5, [24, 30, 76])
    r.stroke([[x + 8, y - 26], [x + 22, y - 40 + (rng() - 0.5) * 6]], 2, [30, 38, 90])
    r.stroke([[x + 8, y - 26], [x + 26, y - 24 + (rng() - 0.5) * 6]], 2, [30, 38, 90])
  }
  r.noise(6, rng)
  r.vignette(0.4)
  return r.toPNG()
}

export const PHOTOS = { xray: photoXray, ecgPaper: photoEcgPaper, fundus: photoFundus, dermoscopy: photoDermoscopy, suturePad: photoSuturePad }

export function renderPhoto(kind, seed) {
  return PHOTOS[kind](makeRng(seed))
}
