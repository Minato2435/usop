import { useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { GhostButton, PrimaryButton, Skeleton } from '../roles/primary-admin/shell/ui'
import { Icon } from '../roles/primary-admin/shell/Icon'
import { FileAttachControl } from '../roles/primary-admin/shell/VideoShared'
import { watchUsers, watchInstitutionUsers } from '../lib/firestore/users'
import { watchInstitution, watchInstitutions } from '../lib/firestore/institutions'
import { watchCatalogDepartments, watchInstitutionDepartments, watchInstitutionDepartmentOverrides } from '../lib/firestore/departments'
import { adminBulkCreateUsers, accountErrorMessage } from '../lib/accounts'
import { normalizeMobile, isValidMobile } from '../auth/phoneOtp'
import { suggestEmailFix } from '../lib/emailTypos'
import { MBBS_YEARS } from '../lib/academicStructure'
import { sameRegNo } from '../lib/registrationNumber'
import type { AccountProfile, AppUser, Department, Institution, InstitutionDepartmentOverride, MbbsYear } from '../types'

// Bulk add: pick the college + role, paste rows from Excel / Google Sheets
// (or upload a CSV), fix anything flagged right in the table, then create
// every account on the server in chunks of 50. Each row succeeds or fails
// on its own; failed rows stay editable for a retry. Shared by Primary
// Admin and Institution Admin (Shell-parametrised, like the other editors).

type ShellProps = { eyebrow?: string; title: string; actions?: ReactNode; children: ReactNode }

const BORDER = 'color-mix(in srgb, var(--color-char-soft) 28%, var(--color-line) 72%)'
const ROW_BORDER = 'color-mix(in srgb, var(--color-char-soft) 16%, var(--color-line) 84%)'
const CARD_STYLE = { backgroundColor: 'var(--color-paper)', borderColor: BORDER }
const LABEL = 'font-display block mb-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em]'
const INPUT = 'w-full h-10 px-3 text-[13.5px] rounded-[6px] border bg-transparent'
const INPUT_STYLE = { borderColor: 'var(--color-line)', color: 'var(--color-char)' }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const CHUNK = 50
const MAX_ROWS = 1000

type ImportRole = 'student' | 'faculty' | 'hod' | 'principal'
type ColKey = 'name' | 'email' | 'mobile' | 'regNo' | 'year' | 'department' | 'years'

const ROLE_INFO: Record<ImportRole, { label: string; plural: string; columns: ColKey[] }> = {
  student: { label: 'Student', plural: 'students', columns: ['name', 'email', 'mobile', 'regNo', 'year'] },
  faculty: { label: 'Faculty', plural: 'faculty members', columns: ['name', 'email', 'mobile', 'regNo', 'department', 'years'] },
  hod: { label: 'HOD', plural: 'HODs', columns: ['name', 'email', 'mobile', 'regNo', 'department'] },
  principal: { label: 'Principal', plural: 'principals', columns: ['name', 'email', 'mobile', 'regNo'] },
}
const COL_LABEL: Record<ColKey, string> = {
  name: 'Full name',
  email: 'Email',
  mobile: 'Mobile',
  regNo: 'Reg. no.',
  year: 'Year',
  department: 'Department',
  years: 'Teaches years',
}
const COL_WIDTH: Record<ColKey, string> = {
  name: 'min-w-[170px] flex-[1.4]',
  email: 'min-w-[200px] flex-[1.6]',
  mobile: 'w-[130px] shrink-0',
  regNo: 'w-[130px] shrink-0',
  year: 'w-[96px] shrink-0',
  department: 'min-w-[160px] flex-1',
  years: 'w-[110px] shrink-0',
}
// Header names people actually use in their sheets (compared without
// spaces/punctuation, case-insensitive).
const COL_ALIASES: Record<ColKey, string[]> = {
  name: ['name', 'fullname', 'studentname', 'facultyname', 'nameofthestudent', 'candidatename'],
  email: ['email', 'emailid', 'emailaddress', 'mail', 'mailid'],
  mobile: ['mobile', 'mobileno', 'mobilenumber', 'phone', 'phoneno', 'phonenumber', 'contact', 'contactno', 'contactnumber', 'cell', 'whatsapp'],
  regNo: [
    'regno', 'registrationno', 'registrationnumber', 'regnumber', 'rollno', 'rollnumber', 'registerno', 'registernumber', 'universityregno', 'admissionno',
    'staffid', 'staffno', 'employeeid', 'employeeno', 'empid', 'empno', 'kmcno', 'kmcregno', 'mcino', 'nmcno', 'councilno', 'councilregno',
    'medicalcouncilno', 'medicalregistrationno', 'medicalregno',
  ],
  year: ['year', 'mbbsyear', 'batch', 'currentyear', 'yearofstudy'],
  department: ['department', 'dept', 'departmentname', 'subject'],
  years: ['years', 'teachesyears', 'mbbsyears', 'teachingyears', 'associatedyears', 'yearstaught'],
}
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

interface Row {
  key: string
  name: string
  email: string
  mobile: string
  regNo: string
  year: string
  department: string
  years: string
  status: 'pending' | 'created' | 'failed'
  serverError?: string
}
const emptyRow = (): Row => ({ key: crypto.randomUUID(), name: '', email: '', mobile: '', regNo: '', year: '', department: '', years: '', status: 'pending' })

interface Checked {
  issues: string[] // block creation
  notes: string[] // fine, just worth knowing
  profile: AccountProfile | null
}

// ── Parsing ─────────────────────────────────────────────────────────────

// CSV / TSV (what Excel and Google Sheets put on the clipboard), with
// quoted cells. Delimiter guessed from the first line.
function parseTable(raw: string): string[][] {
  const text = raw.replace(/^﻿/, '')
  const first = text.split(/\r?\n/, 1)[0] ?? ''
  const delim = first.includes('\t') ? '\t' : first.includes(';') && !first.includes(',') ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
    } else if (c === '"' && cell === '') quoted = true
    else if (c === delim) {
      row.push(cell)
      cell = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows.map((r) => r.map((s) => s.trim())).filter((r) => r.some((s) => s !== ''))
}

// First line is a header if it names at least two known columns; otherwise
// the columns are read in the template's order.
function toRows(table: string[][], role: ImportRole): { rows: Row[]; usedHeader: boolean; unknownHeaders: string[] } {
  if (table.length === 0) return { rows: [], usedHeader: false, unknownHeaders: [] }
  const header = table[0].map(squash)
  const map = new Map<number, ColKey>()
  const unknownHeaders: string[] = []
  header.forEach((h, i) => {
    const col = (Object.keys(COL_ALIASES) as ColKey[]).find((k) => COL_ALIASES[k].includes(h))
    if (col && ![...map.values()].includes(col)) map.set(i, col)
    else if (h) unknownHeaders.push(table[0][i])
  })
  const usedHeader = map.size >= 2
  const body = usedHeader ? table.slice(1) : table
  if (!usedHeader) {
    map.clear()
    ROLE_INFO[role].columns.forEach((c, i) => map.set(i, c))
  }
  const rows = body.map((cells) => {
    const r = emptyRow()
    map.forEach((col, i) => {
      r[col] = cells[i] ?? ''
    })
    return r
  })
  return { rows, usedHeader, unknownHeaders: usedHeader ? unknownHeaders : [] }
}

// "2", "Year 2", "II", "second" → 2
function parseYear(raw: string): MbbsYear | null {
  const s = raw.trim().toLowerCase()
  if (!s) return null
  const roman: Record<string, MbbsYear> = { i: 1, ii: 2, iii: 3, iv: 4, first: 1, second: 2, third: 3, fourth: 4, final: 4 }
  const word = s
    .replace(/^(mbbs\s*)?(year|yr)?[\s\-–:.]*/, '')
    .replace(/[\s\-–]*(year|yr)$/, '')
    .replace(/^([1-4])(st|nd|rd|th)$/, '$1') // "3rd" → "3" (only after a digit, so "first" stays intact)
    .trim()
  if (roman[word]) return roman[word]
  const n = Number(word.match(/[1-4]/)?.[0])
  return n >= 1 && n <= 4 && /^[^0-9]*[1-4][^0-9]*$/.test(s) ? (n as MbbsYear) : null
}
function parseYears(raw: string): MbbsYear[] | null {
  const parts = raw.split(/[,;/&+]|\band\b|\s{2,}/i).map((p) => p.trim()).filter(Boolean)
  if (parts.length === 0) return []
  const out = new Set<MbbsYear>()
  for (const p of parts) {
    // "1 2 3" in one cell
    const many = p.match(/^[1-4](\s+[1-4])+$/) ? p.split(/\s+/).map(Number) : null
    if (many) many.forEach((n) => out.add(n as MbbsYear))
    else {
      const y = parseYear(p)
      if (!y) return null
      out.add(y)
    }
  }
  return [...out].sort()
}

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}
function download(name: string, lines: string[][]) {
  const blob = new Blob(['﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ── Small view pieces ───────────────────────────────────────────────────

function StepHeader({ step, title, hint }: { step: string; title: string; hint?: string }) {
  return (
    <div className="flex items-baseline gap-3 flex-wrap mb-3">
      <span className="font-mono text-[11px] tracking-[0.14em] uppercase shrink-0" style={{ color: 'var(--color-gold)' }}>
        Step {step}
      </span>
      <h2 className="font-display text-[19px]" style={{ color: 'var(--color-char)' }}>
        {title}
      </h2>
      {hint && (
        <span className="text-[12.5px]" style={{ color: 'var(--color-char-soft)' }}>
          {hint}
        </span>
      )}
    </div>
  )
}

function Label({ children }: { children: ReactNode }) {
  return (
    <span className={LABEL} style={{ color: 'var(--color-char-soft)' }}>
      {children}
    </span>
  )
}

function Choice({ selected, onClick, title, hint, badge }: { selected: boolean; onClick: () => void; title: string; hint: string; badge?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left rounded-[8px] border px-4 py-3 transition-colors flex items-start gap-3"
      style={{
        borderColor: selected ? 'var(--color-gold)' : 'var(--color-line)',
        backgroundColor: selected ? 'color-mix(in srgb, var(--color-gold) 8%, transparent)' : 'transparent',
      }}
    >
      <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border flex items-center justify-center" style={{ borderColor: selected ? 'var(--color-gold)' : 'var(--color-line)' }}>
        {selected && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: 'var(--color-gold)' }} />}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2 text-[13.5px] font-medium" style={{ color: 'var(--color-char)' }}>
          {title}
          {badge && (
            <span className="px-1.5 py-px rounded-full text-[10px] font-medium uppercase tracking-[0.06em]" style={{ backgroundColor: 'var(--color-teal-soft)', color: 'var(--color-teal)' }}>
              {badge}
            </span>
          )}
        </span>
        <span className="block text-[12px] mt-0.5 leading-relaxed" style={{ color: 'var(--color-char-soft)' }}>
          {hint}
        </span>
      </span>
    </button>
  )
}

function SegGroup<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { v: T; l: string }[] }) {
  return (
    <div className="inline-flex border rounded-[3px] overflow-hidden" style={{ borderColor: 'var(--color-line)' }}>
      {options.map((o, i) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          className="px-2.5 py-1.5 text-[12.5px] font-medium transition-colors duration-150"
          style={{
            backgroundColor: value === o.v ? 'var(--color-ink)' : 'transparent',
            color: value === o.v ? 'var(--color-frost)' : 'var(--color-char-soft)',
            borderRight: i < options.length - 1 ? '1px solid var(--color-line)' : undefined,
          }}
        >
          {o.l}
        </button>
      ))}
    </div>
  )
}

function Stat({ n, label, color }: { n: number; label: string; color?: string }) {
  return (
    <div className="px-5 py-4">
      <div className="font-display text-[28px] leading-none tabular-nums" style={{ color: color ?? 'var(--color-char)' }}>
        {n}
      </div>
      <div className="mt-1.5 text-[10.5px] uppercase tracking-[0.08em]" style={{ color: 'var(--color-char-soft)' }}>
        {label}
      </div>
    </div>
  )
}

// ── Page ────────────────────────────────────────────────────────────────

export function BulkUserImportPage({
  Shell,
  lockedInstitutionId,
  backTo,
}: {
  Shell: ComponentType<ShellProps>
  lockedInstitutionId?: string // Institution Admin: always their own college
  backTo: string
}) {
  const navigate = useNavigate()
  const locked = lockedInstitutionId !== undefined

  // Reference data
  const [institutions, setInstitutions] = useState<Institution[] | null>(null)
  const [users, setUsers] = useState<AppUser[] | null>(null)
  const [catalogDepts, setCatalogDepts] = useState<Department[]>([])
  const [ownDepts, setOwnDepts] = useState<Department[]>([])
  const [overrides, setOverrides] = useState<InstitutionDepartmentOverride[]>([])

  // Step 01
  const [institutionId, setInstitutionId] = useState(lockedInstitutionId ?? '')
  const [role, setRole] = useState<ImportRole>('student')
  const [defaultYear, setDefaultYear] = useState<MbbsYear | 0>(1) // 0 = from the Year column
  const [defaultDept, setDefaultDept] = useState('') // '' = from the Department column

  // Step 02
  const [inputMode, setInputMode] = useState<'paste' | 'file'>('paste')
  const [pasted, setPasted] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [readNote, setReadNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)

  // Step 03
  const [rows, setRows] = useState<Row[]>([])
  const [view, setView] = useState<'all' | 'problems' | 'ready'>('all')

  // Step 04
  const [signIn, setSignIn] = useState<'otp' | 'password'>('otp')
  const [password, setPassword] = useState('')

  // Creating
  const [creating, setCreating] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [runError, setRunError] = useState<string | null>(null)
  const [finished, setFinished] = useState<{ created: number; failed: number } | null>(null)
  const resultsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (locked) {
      if (!lockedInstitutionId) return
      return watchInstitution(lockedInstitutionId, (i) => setInstitutions(i ? [i] : []))
    }
    return watchInstitutions(setInstitutions)
  }, [locked, lockedInstitutionId])
  useEffect(() => {
    if (locked) {
      if (!lockedInstitutionId) return
      return watchInstitutionUsers(lockedInstitutionId, setUsers)
    }
    return watchUsers(setUsers)
  }, [locked, lockedInstitutionId])
  useEffect(() => watchCatalogDepartments(setCatalogDepts), [])
  useEffect(() => {
    if (!institutionId) {
      setOwnDepts([])
      setOverrides([])
      return
    }
    const a = watchInstitutionDepartments(institutionId, setOwnDepts)
    const b = watchInstitutionDepartmentOverrides(institutionId, setOverrides)
    return () => {
      a()
      b()
    }
  }, [institutionId])

  const institution = institutions?.find((i) => i.id === institutionId) ?? null
  const sortedInstitutions = useMemo(() => [...(institutions ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [institutions])

  // Departments switched on for this college (catalog + its own).
  const departments = useMemo(() => {
    const off = new Set(overrides.filter((o) => !o.enabled).map((o) => o.departmentId))
    return [...catalogDepts, ...ownDepts]
      .filter((d) => (d.institutionId === '' || d.institutionId === institutionId) && !off.has(d.id))
      .sort((a, b) => a.mbbsYear - b.mbbsYear || a.name.localeCompare(b.name))
  }, [catalogDepts, ownDepts, overrides, institutionId])
  const deptLabel = (d: Department) => `${d.name} (Year ${d.mbbsYear})`
  const deptName = useMemo(() => new Map(departments.map((d) => [d.id, deptLabel(d)])), [departments])

  // A department cell → one department. Accepts "Anatomy" or "Anatomy (Year 1)";
  // `years` breaks a tie when the same name exists in several years.
  function resolveDept(raw: string, years: MbbsYear[] | null): { dept: Department | null; error: string | null } {
    const m = raw.trim().match(/^(.*?)[\s\-–(]*(?:year|yr)\s*([1-4])\)?$/i)
    const name = squash(m ? m[1] : raw)
    const year = m ? (Number(m[2]) as MbbsYear) : null
    let hits = departments.filter((d) => squash(d.name) === name)
    if (hits.length === 0) return { dept: null, error: `No department called “${raw.trim()}” is switched on for this college.` }
    if (year) hits = hits.filter((d) => d.mbbsYear === year)
    else if (hits.length > 1 && years?.length) {
      const inYears = hits.filter((d) => years.includes(d.mbbsYear))
      if (inYears.length) hits = inYears
    }
    if (hits.length === 0) return { dept: null, error: `“${raw.trim()}” isn’t a Year ${year} department here.` }
    if (hits.length > 1) return { dept: null, error: `“${raw.trim()}” exists in Years ${hits.map((d) => d.mbbsYear).join(', ')} — write e.g. “${hits[0].name} (Year ${hits[0].mbbsYear})”.` }
    return { dept: hits[0], error: null }
  }

  const usesDeptColumn = (role === 'faculty' || role === 'hod') && defaultDept === ''
  // Columns shown in the table: the role's columns, minus ones a default covers.
  const columns = ROLE_INFO[role].columns.filter((c) => !(c === 'department' && !usesDeptColumn) && !(c === 'year' && role === 'student' && defaultYear !== 0 && !rows.some((r) => r.year.trim())))

  // ── Check every row ──
  const checked = useMemo(() => {
    const out = new Map<string, Checked>()
    const live = rows.filter((r) => r.status !== 'created')
    const count = (key: (r: Row) => string) => {
      const m = new Map<string, number>()
      live.forEach((r) => {
        const k = key(r)
        if (k) m.set(k, (m.get(k) ?? 0) + 1)
      })
      return m
    }
    const emails = count((r) => r.email.trim().toLowerCase())
    const mobiles = count((r) => normalizeMobile(r.mobile))
    const regs = count((r) => r.regNo.trim().replace(/\s+/g, ' ').toLowerCase())
    const existing = users ?? []
    const hodByDept = new Map(existing.filter((u) => u.role === 'hod' && u.institutionId === institutionId && u.departmentId).map((u) => [u.departmentId!, u.name]))
    const hodRowsByDept = new Map<string, number>()
    const principalExists = existing.some((u) => u.role === 'principal' && u.institutionId === institutionId)

    // Resolve departments first (HOD duplicates need them all).
    const deptOf = new Map<string, { dept: Department | null; error: string | null; years: MbbsYear[] | null }>()
    for (const r of live) {
      if (role !== 'faculty' && role !== 'hod') continue
      const years = role === 'faculty' ? parseYears(r.years) : null
      if (!usesDeptColumn) {
        const d = departments.find((x) => x.id === defaultDept) ?? null
        deptOf.set(r.key, { dept: d, error: d ? null : 'Pick the department in Step 01.', years })
      } else if (!r.department.trim()) deptOf.set(r.key, { dept: null, error: 'Department is missing.', years })
      else deptOf.set(r.key, { ...resolveDept(r.department, years), years })
      const d = deptOf.get(r.key)!.dept
      if (role === 'hod' && d) hodRowsByDept.set(d.id, (hodRowsByDept.get(d.id) ?? 0) + 1)
    }

    for (const r of rows) {
      if (r.status === 'created') {
        out.set(r.key, { issues: [], notes: [], profile: null })
        continue
      }
      const issues: string[] = []
      const notes: string[] = []
      const name = r.name.trim().replace(/\s+/g, ' ')
      const email = r.email.trim().toLowerCase()
      const phone = normalizeMobile(r.mobile)
      if (!name) issues.push('Name is missing.')
      if (!email) issues.push('Email is missing.')
      else if (!EMAIL_RE.test(email)) issues.push('Email doesn’t look right.')
      else {
        if ((emails.get(email) ?? 0) > 1) issues.push('This email appears more than once in the list.')
        if (existing.some((u) => u.email.toLowerCase() === email)) issues.push('An account with this email already exists.')
        const fix = suggestEmailFix(email)
        if (fix) notes.push(`Did you mean ${fix}?`)
      }
      if (!r.mobile.trim()) issues.push('Mobile is missing.')
      else if (!isValidMobile(phone)) issues.push('Mobile must be a 10-digit Indian number.')
      else {
        if ((mobiles.get(phone) ?? 0) > 1) issues.push('This mobile appears more than once in the list.')
        if (existing.some((u) => u.phone === phone)) issues.push('An account with this mobile already exists.')
      }

      let mbbsYear: MbbsYear | null = null
      let departmentId: string | null = null
      let associatedMbbsYears: MbbsYear[] | null = null

      // Every role has one (student reg. no., council no., staff ID).
      const rollNumber = r.regNo.trim().replace(/\s+/g, ' ')
      if (!rollNumber) issues.push('Registration number is missing.')
      else {
        if ((regs.get(rollNumber.toLowerCase()) ?? 0) > 1) issues.push('This registration number appears more than once.')
        const owner = existing.find((u) => sameRegNo(u.rollNumber, rollNumber))
        if (owner) issues.push(`This registration number is already used by ${owner.name}.`)
      }

      if (role === 'student') {
        if (r.year.trim()) {
          mbbsYear = parseYear(r.year)
          if (!mbbsYear) issues.push(`Year “${r.year}” isn’t 1–4.`)
        } else if (defaultYear) mbbsYear = defaultYear
        else issues.push('Year is missing.')
      }

      if (role === 'faculty' || role === 'hod') {
        const d = deptOf.get(r.key)!
        if (d.error) issues.push(d.error)
        departmentId = d.dept?.id ?? null
        if (role === 'hod' && d.dept) {
          if (hodByDept.has(d.dept.id)) issues.push(`${d.dept.name} already has an HOD (${hodByDept.get(d.dept.id)}).`)
          else if ((hodRowsByDept.get(d.dept.id) ?? 0) > 1) issues.push(`More than one HOD for ${d.dept.name} in this list.`)
        }
        if (role === 'faculty') {
          if (d.years === null) issues.push(`Teaches years “${r.years}” isn’t a list like 1, 2.`)
          else {
            const ys = new Set(d.years)
            if (d.dept && !ys.has(d.dept.mbbsYear)) {
              if (d.years.length) notes.push(`Year ${d.dept.mbbsYear} added (their department’s year).`)
              ys.add(d.dept.mbbsYear)
            }
            associatedMbbsYears = [...ys].sort()
            if (associatedMbbsYears.length === 0) issues.push('Teaches years is missing.')
          }
        }
      }
      if (role === 'principal') {
        if (principalExists) notes.push('This college already has a Principal.')
        if (live.length > 1) notes.push('More than one Principal in this list.')
      }
      if (r.status === 'failed' && r.serverError) issues.unshift(r.serverError)

      const profile: AccountProfile | null =
        issues.length === 0 && institutionId
          ? { role, name, email, phone, institutionId, departmentId, mbbsYear, associatedMbbsYears, rollNumber, assignedHOD: null }
          : null
      if (!institutionId && issues.length === 0) issues.push('Pick the college in Step 01.')
      out.set(r.key, { issues, notes, profile })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, users, role, institutionId, departments, defaultYear, defaultDept, usesDeptColumn])

  const pendingRows = rows.filter((r) => r.status !== 'created')
  const readyRows = pendingRows.filter((r) => checked.get(r.key)?.profile)
  const problemRows = pendingRows.filter((r) => !checked.get(r.key)?.profile)
  const createdCount = rows.filter((r) => r.status === 'created').length
  const shownRows = rows.filter((r) =>
    view === 'all' ? true : view === 'ready' ? r.status !== 'created' && !!checked.get(r.key)?.profile : r.status !== 'created' && !checked.get(r.key)?.profile,
  )
  const passwordOk = signIn === 'otp' || password.length >= 6

  // Changing who you're adding re-reads the columns; start the list over.
  function changeRole(next: ImportRole) {
    if (next === role) return
    setRole(next)
    setDefaultDept('')
    setRows((rs) => rs.filter((r) => r.status === 'created'))
    setReadNote(null)
  }

  function addFromTable(table: string[][], source: string) {
    const { rows: parsed, usedHeader, unknownHeaders } = toRows(table, role)
    if (parsed.length === 0) {
      setReadNote({ tone: 'error', text: `No rows found in ${source}.` })
      return
    }
    const room = MAX_ROWS - rows.length
    const taken = parsed.slice(0, Math.max(0, room))
    setRows((rs) => [...rs, ...taken])
    setFinished(null)
    const bits = [`Added ${taken.length} ${taken.length === 1 ? 'row' : 'rows'} from ${source}`]
    bits.push(usedHeader ? 'columns matched by their headings' : `no headings found, so columns were read in this order: ${ROLE_INFO[role].columns.map((c) => COL_LABEL[c]).join(', ')}`)
    if (unknownHeaders.length) bits.push(`ignored: ${unknownHeaders.join(', ')}`)
    if (taken.length < parsed.length) bits.push(`only ${MAX_ROWS} rows fit in one import`)
    setReadNote({ tone: 'ok', text: bits.join(' · ') + '.' })
    setView('all')
  }

  async function readFile(f: File | null) {
    setFile(f)
    if (!f) return
    if (/\.(xlsx|xls|ods|numbers)$/i.test(f.name)) {
      setReadNote({ tone: 'error', text: 'That’s a spreadsheet file. Save it as CSV (File → Save As / Download → CSV), or select the cells, copy and paste them instead.' })
      return
    }
    addFromTable(parseTable(await f.text()), f.name)
  }

  function updateRow(key: string, col: ColKey, value: string) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, [col]: value, status: r.status === 'failed' ? 'pending' : r.status, serverError: undefined } : r)))
  }

  function templateLines(): string[][] {
    return [ROLE_INFO[role].columns.map((c) => COL_LABEL[c])]
  }

  async function createAll() {
    const batch = readyRows.map((r) => ({ key: r.key, profile: checked.get(r.key)!.profile! }))
    if (batch.length === 0 || !passwordOk) return
    setCreating(true)
    setRunError(null)
    setFinished(null)
    setProgress({ done: 0, total: batch.length })
    let created = 0
    let failed = 0
    try {
      for (let i = 0; i < batch.length; i += CHUNK) {
        const part = batch.slice(i, i + CHUNK)
        const { results } = await adminBulkCreateUsers({ rows: part, ...(signIn === 'password' ? { password } : {}) })
        const byKey = new Map(results.map((x) => [x.key, x]))
        created += results.filter((x) => x.ok).length
        failed += results.filter((x) => !x.ok).length
        setRows((rs) =>
          rs.map((r) => {
            const res = byKey.get(r.key)
            if (!res) return r
            return res.ok ? { ...r, status: 'created', serverError: undefined } : { ...r, status: 'failed', serverError: res.error ?? 'Couldn’t create this account.' }
          }),
        )
        setProgress({ done: Math.min(i + CHUNK, batch.length), total: batch.length })
      }
    } catch (err) {
      setRunError(accountErrorMessage(err, 'The server stopped answering. Accounts already created are marked ✓ — press Create again for the rest.'))
    } finally {
      setCreating(false)
      setFinished({ created, failed })
      setView(failed ? 'problems' : 'all')
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
  }

  function downloadResults() {
    const cols = ROLE_INFO[role].columns
    download(`USOP-${ROLE_INFO[role].label}-import-results.csv`, [
      [...cols.map((c) => COL_LABEL[c]), 'Result', 'Reason'],
      ...rows.map((r) => {
        const c = checked.get(r.key)
        const result = r.status === 'created' ? 'Created' : 'Not created'
        const reason = r.status === 'created' ? '' : (c?.issues ?? []).join(' ')
        return [...cols.map((col) => r[col]), result, reason]
      }),
    ])
  }

  const loading = institutions === null || users === null

  return (
    <Shell eyebrow="People" title="Bulk add users">
      <div className="max-w-[1100px] mx-auto">
        <button
          onClick={() => navigate(backTo)}
          className="inline-flex items-center gap-1.5 mb-6 text-[12.5px] font-medium transition-colors hover:text-[var(--color-gold)]"
          style={{ color: 'var(--color-char-soft)' }}
        >
          <Icon name="chevron" className="h-3 w-3 rotate-180" />
          All users
        </button>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-28" />
            <Skeleton className="h-48" />
          </div>
        ) : (
          <>
            {/* 01 — Who */}
            <StepHeader step="01" title="Who you’re adding" hint="One college and one role per import." />
            <div className="rounded-[10px] border p-5 mb-9" style={CARD_STYLE}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <Label>College</Label>
                  {locked ? (
                    <div className="h-10 px-3 flex items-center text-[13.5px] rounded-[6px] border" style={{ ...INPUT_STYLE, backgroundColor: 'color-mix(in srgb, var(--color-line) 30%, transparent)' }}>
                      {institution?.name ?? '—'}
                    </div>
                  ) : (
                    <select value={institutionId} onChange={(e) => setInstitutionId(e.target.value)} className={INPUT} style={INPUT_STYLE} disabled={creating}>
                      <option value="">Choose a college…</option>
                      {sortedInstitutions.map((i) => (
                        <option key={i.id} value={i.id}>
                          {i.name}
                          {i.city ? ` — ${i.city}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div>
                  <Label>Role</Label>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(ROLE_INFO) as ImportRole[]).map((r) => (
                      <button
                        key={r}
                        type="button"
                        disabled={creating}
                        onClick={() => changeRole(r)}
                        className="h-10 px-4 rounded-[6px] border text-[13px] font-medium transition-colors"
                        style={{
                          borderColor: role === r ? 'var(--color-gold)' : 'var(--color-line)',
                          backgroundColor: role === r ? 'color-mix(in srgb, var(--color-gold) 10%, transparent)' : 'transparent',
                          color: role === r ? 'var(--color-gold)' : 'var(--color-char)',
                        }}
                      >
                        {ROLE_INFO[r].label}
                      </button>
                    ))}
                  </div>
                </div>

                {role === 'student' && (
                  <div>
                    <Label>MBBS year</Label>
                    <select value={defaultYear} onChange={(e) => setDefaultYear(Number(e.target.value) as MbbsYear | 0)} className={INPUT} style={INPUT_STYLE}>
                      {MBBS_YEARS.map((y) => (
                        <option key={y} value={y}>
                          Everyone is Year {y}
                        </option>
                      ))}
                      <option value={0}>Read it from a Year column</option>
                    </select>
                    <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
                      {defaultYear ? 'A Year column in your sheet, if present, wins for that row.' : 'Each row needs a Year (1–4).'}
                    </p>
                  </div>
                )}
                {(role === 'faculty' || role === 'hod') && (
                  <div>
                    <Label>Department</Label>
                    <select value={defaultDept} onChange={(e) => setDefaultDept(e.target.value)} className={INPUT} style={INPUT_STYLE} disabled={!institutionId}>
                      <option value="">Read it from a Department column</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          Everyone in {deptLabel(d)}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1.5 text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
                      {!institutionId
                        ? 'Choose the college first.'
                        : defaultDept
                          ? `Every ${ROLE_INFO[role].label} in this import joins ${deptName.get(defaultDept)}.`
                          : 'Write the department name as it appears in USOP, e.g. “Anatomy”.'}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* 02 — Add the list */}
            <StepHeader step="02" title="Add the list" hint="Copy rows from Excel or Google Sheets, or upload a CSV." />
            <div className="rounded-[10px] border p-5 mb-9" style={CARD_STYLE}>
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <SegGroup
                  value={inputMode}
                  onChange={setInputMode}
                  options={[
                    { v: 'paste', l: 'Paste from a sheet' },
                    { v: 'file', l: 'Upload CSV' },
                  ]}
                />
                <GhostButton onClick={() => download(`USOP-${ROLE_INFO[role].label}-template.csv`, templateLines())}>
                  <Icon name="download" className="h-3.5 w-3.5" />
                  Download template
                </GhostButton>
              </div>

              {/* The columns, as a mini sheet */}
              <div className="mb-4 rounded-[8px] border overflow-x-auto" style={{ borderColor: 'var(--color-line)' }}>
                <div className="flex text-[11.5px] min-w-max">
                  {ROLE_INFO[role].columns.map((c, i) => {
                    const optional = (c === 'year' && defaultYear !== 0) || (c === 'department' && !usesDeptColumn) || c === 'years'
                    return (
                      <div key={c} className="px-3 py-2 border-r last:border-r-0 min-w-[120px]" style={{ borderColor: 'var(--color-line)' }}>
                        <div className="font-mono text-[10px]" style={{ color: 'var(--color-char-soft)' }}>
                          {String.fromCharCode(65 + i)}
                        </div>
                        <div className="font-medium" style={{ color: 'var(--color-char)' }}>
                          {COL_LABEL[c]}
                          {optional && <span style={{ color: 'var(--color-char-soft)' }}> · optional</span>}
                        </div>
                        <div className="font-mono text-[11px] mt-0.5" style={{ color: 'var(--color-char-soft)' }}>
                          {c === 'regNo' ? (role === 'student' ? 'MB2024001' : 'KMC-123456') : { name: 'Priya Sharma', email: 'priya@college.edu', mobile: '98765 43210', regNo: '', year: '1', department: 'Anatomy', years: '1, 2' }[c]}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {inputMode === 'paste' ? (
                <>
                  <textarea
                    value={pasted}
                    onChange={(e) => setPasted(e.target.value)}
                    rows={6}
                    placeholder={`Select the cells in your sheet (with or without the heading row), copy, and paste here.\n\nPriya Sharma\tpriya@college.edu\t9876543210\t…`}
                    className="w-full px-3 py-2.5 text-[12.5px] font-mono rounded-[6px] border bg-transparent resize-y"
                    style={INPUT_STYLE}
                    disabled={creating}
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <PrimaryButton
                      disabled={!pasted.trim() || creating}
                      onClick={() => {
                        addFromTable(parseTable(pasted), 'the pasted text')
                        setPasted('')
                      }}
                    >
                      <Icon name="plus" className="h-3.5 w-3.5" />
                      Add these rows
                    </PrimaryButton>
                    <GhostButton disabled={creating || rows.length >= MAX_ROWS} onClick={() => setRows((rs) => [...rs, emptyRow()])}>
                      Type one by hand
                    </GhostButton>
                  </div>
                </>
              ) : (
                <FileAttachControl accept=".csv,.tsv,.txt,text/csv" file={file} onChange={readFile} label="Choose a CSV file" hint="Excel: File → Save As → CSV. Google Sheets: File → Download → CSV." />
              )}

              {readNote && (
                <p className="mt-3 text-[12.5px] leading-relaxed" style={{ color: readNote.tone === 'ok' ? 'var(--color-teal)' : 'var(--color-clay)' }}>
                  {readNote.text}
                </p>
              )}
            </div>

            {/* 03 — Check */}
            <StepHeader step="03" title="Check the list" hint="Fix anything flagged right here — click a cell to edit it." />
            {rows.length === 0 ? (
              <div className="rounded-[10px] border border-dashed p-8 mb-9 text-center" style={{ borderColor: BORDER }}>
                <Icon name="users" className="h-6 w-6 mx-auto mb-2" style={{ color: 'var(--color-char-soft)' }} />
                <p className="text-[13.5px]" style={{ color: 'var(--color-char-soft)' }}>
                  Rows you add in Step 02 appear here, checked one by one.
                </p>
              </div>
            ) : (
              <div className="mb-9">
                <div
                  className="grid grid-cols-2 sm:grid-cols-4 border rounded-[6px] overflow-hidden divide-x divide-y sm:divide-y-0 mb-4"
                  style={{ ...CARD_STYLE, borderColor: BORDER }}
                >
                  <Stat n={rows.length} label="In the list" />
                  <Stat n={readyRows.length} label="Ready" color="var(--color-teal)" />
                  <Stat n={problemRows.length} label="Need fixing" color={problemRows.length ? 'var(--color-clay)' : undefined} />
                  <Stat n={createdCount} label="Created" color={createdCount ? 'var(--color-gold)' : undefined} />
                </div>

                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <SegGroup
                    value={view}
                    onChange={setView}
                    options={[
                      { v: 'all', l: `All ${rows.length}` },
                      { v: 'problems', l: `Need fixing ${problemRows.length}` },
                      { v: 'ready', l: `Ready ${readyRows.length}` },
                    ]}
                  />
                  <span className="flex-1" />
                  {problemRows.length > 0 && !creating && (
                    <GhostButton tone="danger" onClick={() => setRows((rs) => rs.filter((r) => r.status === 'created' || checked.get(r.key)?.profile))}>
                      Remove rows that need fixing
                    </GhostButton>
                  )}
                  {!creating && (
                    <GhostButton onClick={() => setRows((rs) => rs.filter((r) => r.status === 'created'))} disabled={pendingRows.length === 0}>
                      Clear list
                    </GhostButton>
                  )}
                </div>

                <div className="rounded-[10px] border overflow-hidden" style={CARD_STYLE}>
                  <div className="overflow-x-auto">
                    <div className="min-w-[860px]">
                      <div
                        className="flex items-center gap-3 px-4 py-2.5 border-b text-[10.5px] font-semibold uppercase tracking-[0.08em]"
                        style={{ borderColor: BORDER, color: 'var(--color-char-soft)' }}
                      >
                        <div className="w-[34px] shrink-0">#</div>
                        {columns.map((c) => (
                          <div key={c} className={COL_WIDTH[c]}>
                            {COL_LABEL[c]}
                          </div>
                        ))}
                        <div className="w-[96px] shrink-0">Status</div>
                        <div className="w-[28px] shrink-0" />
                      </div>
                      {shownRows.length === 0 ? (
                        <p className="px-4 py-6 text-[13px] text-center" style={{ color: 'var(--color-char-soft)' }}>
                          Nothing here.
                        </p>
                      ) : (
                        shownRows.map((r) => {
                          const c = checked.get(r.key)!
                          const done = r.status === 'created'
                          const ok = !!c.profile
                          return (
                            <div key={r.key} className="border-b last:border-0" style={{ borderColor: ROW_BORDER, backgroundColor: done ? 'color-mix(in srgb, var(--color-teal) 5%, transparent)' : undefined }}>
                              <div className="flex items-center gap-3 px-4 py-1.5">
                                <div className="w-[34px] shrink-0 font-mono text-[11px]" style={{ color: 'var(--color-char-soft)' }}>
                                  {rows.indexOf(r) + 1}
                                </div>
                                {columns.map((col) => (
                                  <div key={col} className={COL_WIDTH[col]}>
                                    <input
                                      value={r[col]}
                                      onChange={(e) => updateRow(r.key, col, e.target.value)}
                                      readOnly={done || creating}
                                      placeholder={col === 'year' && defaultYear ? String(defaultYear) : col === 'years' ? 'auto' : '—'}
                                      className="w-full h-8 px-2 text-[13px] rounded-[4px] border border-transparent bg-transparent outline-none transition-colors hover:border-[var(--color-line)] focus:border-[var(--color-gold)] read-only:hover:border-transparent"
                                      style={{ color: 'var(--color-char)', fontFamily: col === 'name' || col === 'department' ? undefined : 'var(--font-mono)', fontSize: col === 'name' || col === 'department' ? 13 : 12 }}
                                    />
                                  </div>
                                ))}
                                <div className="w-[96px] shrink-0">
                                  <span
                                    className="inline-flex items-center gap-1.5 text-[12px] font-medium"
                                    style={{ color: done ? 'var(--color-teal)' : ok ? 'var(--color-teal)' : 'var(--color-clay)' }}
                                  >
                                    <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: 'currentColor' }} />
                                    {done ? 'Created ✓' : ok ? 'Ready' : r.status === 'failed' ? 'Failed' : 'Fix'}
                                  </span>
                                </div>
                                <div className="w-[28px] shrink-0">
                                  {!done && !creating && (
                                    <button
                                      onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
                                      title="Remove row"
                                      className="h-7 w-7 flex items-center justify-center rounded-[3px] transition-colors hover:bg-black/[0.06]"
                                      style={{ color: 'var(--color-char-soft)' }}
                                    >
                                      <Icon name="close" className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                              {!done && (c.issues.length > 0 || c.notes.length > 0) && (
                                <div className="pl-[62px] pr-4 pb-2 -mt-0.5 text-[11.5px] leading-relaxed">
                                  {c.issues.map((m) => (
                                    <div key={m} style={{ color: 'var(--color-clay)' }}>
                                      ● {m}
                                    </div>
                                  ))}
                                  {c.notes.map((m) => (
                                    <div key={m} style={{ color: 'var(--color-gold)' }}>
                                      ○ {m}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                </div>
                {locked && (
                  <p className="mt-2 text-[11.5px]" style={{ color: 'var(--color-char-soft)' }}>
                    Emails and mobiles used at other colleges are checked when the accounts are created.
                  </p>
                )}
              </div>
            )}

            {/* 04 — Sign-in */}
            <StepHeader step="04" title="How they’ll sign in" />
            <div className="rounded-[10px] border p-5 mb-9" style={CARD_STYLE}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Choice
                  selected={signIn === 'otp'}
                  onClick={() => setSignIn('otp')}
                  title="Mobile number + OTP"
                  badge="Recommended"
                  hint="No password to hand out. They sign in with their mobile and the SMS code, and can set a password any time with “Forgot password?”."
                />
                <Choice
                  selected={signIn === 'password'}
                  onClick={() => setSignIn('password')}
                  title="A starting password"
                  hint="Everyone in this import gets the same password for email sign-in. Share it privately; mobile + OTP works too."
                />
              </div>
              {signIn === 'password' && (
                <div className="mt-4 max-w-[340px]">
                  <Label>Starting password</Label>
                  <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" className={INPUT} style={INPUT_STYLE} autoComplete="off" />
                  {password && password.length < 6 && (
                    <p className="mt-1.5 text-[12px]" style={{ color: 'var(--color-clay)' }}>
                      At least 6 characters.
                    </p>
                  )}
                </div>
              )}
              <p className="mt-4 text-[12px]" style={{ color: 'var(--color-char-soft)' }}>
                Emails you add here are trusted — no verification link is sent.
              </p>
            </div>

            {/* Create */}
            <div ref={resultsRef} className="rounded-[10px] border p-5 mb-10" style={{ ...CARD_STYLE, borderColor: 'var(--color-gold-line)' }}>
              {creating ? (
                <>
                  <div className="flex items-baseline justify-between mb-2">
                    <span className="font-display text-[18px]" style={{ color: 'var(--color-char)' }}>
                      Creating accounts…
                    </span>
                    <span className="font-mono text-[12px]" style={{ color: 'var(--color-char-soft)' }}>
                      {progress.done} / {progress.total}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-line)' }}>
                    <div className="h-full transition-all duration-300" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%`, backgroundColor: 'var(--color-gold)' }} />
                  </div>
                  <p className="mt-2 text-[12px]" style={{ color: 'var(--color-char-soft)' }}>
                    Keep this page open until it finishes.
                  </p>
                </>
              ) : (
                <>
                  {finished && (
                    <div
                      className="mb-4 rounded-[8px] px-4 py-3 text-[13px]"
                      style={{ backgroundColor: finished.failed ? 'var(--color-clay-soft)' : 'var(--color-teal-soft)', color: 'var(--color-char)' }}
                    >
                      <span className="font-medium" style={{ color: finished.failed ? 'var(--color-clay)' : 'var(--color-teal)' }}>
                        {finished.created} {finished.created === 1 ? 'account' : 'accounts'} created
                        {finished.failed ? ` · ${finished.failed} couldn’t be created` : ''}.
                      </span>{' '}
                      {finished.failed ? 'The reason is under each row above — fix it and press Create again.' : 'They can sign in now.'}
                    </div>
                  )}
                  {runError && (
                    <p className="mb-3 text-[12.5px]" style={{ color: 'var(--color-clay)' }}>
                      {runError}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <PrimaryButton onClick={createAll} disabled={readyRows.length === 0 || !passwordOk || !institutionId}>
                      <Icon name="users" className="h-3.5 w-3.5" />
                      Create {readyRows.length} {readyRows.length === 1 ? 'account' : 'accounts'}
                    </PrimaryButton>
                    {rows.length > 0 && (
                      <GhostButton onClick={downloadResults}>
                        <Icon name="download" className="h-3.5 w-3.5" />
                        {createdCount ? 'Download results' : 'Download list'}
                      </GhostButton>
                    )}
                    {createdCount > 0 && <GhostButton onClick={() => navigate(backTo)}>Done</GhostButton>}
                    <span className="text-[12.5px]" style={{ color: 'var(--color-char-soft)' }}>
                      {!institutionId
                        ? 'Choose the college in Step 01.'
                        : !passwordOk
                          ? 'Enter the starting password in Step 04.'
                          : problemRows.length > 0 && readyRows.length > 0
                            ? `${problemRows.length} ${problemRows.length === 1 ? 'row needs' : 'rows need'} fixing and will be skipped.`
                            : readyRows.length === 0 && pendingRows.length > 0
                              ? 'Fix the flagged rows first.'
                              : readyRows.length === 0
                                ? 'Add people in Step 02.'
                                : `${ROLE_INFO[role].label} accounts at ${institution?.name ?? 'this college'}, active straight away.`}
                    </span>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </Shell>
  )
}
