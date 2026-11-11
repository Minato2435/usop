import { useState } from 'react'
import type { LogType, MbbsYear } from '../../types'
import { BASE_DEPARTMENTS_BY_YEAR, MBBS_YEARS } from '../../lib/academicStructure'

export function CreateTemplateModal({
  departmentOptions,
  onCreate,
  onClose,
}: {
  // If omitted, falls back to the base MBBS year->department reference list
  // (used by Primary Admin authoring global templates). Institution Admin
  // passes their institution's actual configured departments.
  departmentOptions?: Record<MbbsYear, string[]>
  onCreate: (input: { logType: LogType; department: string; mbbsYear: MbbsYear; title: string }) => void
  onClose: () => void
}) {
  const options = departmentOptions ?? BASE_DEPARTMENTS_BY_YEAR
  const [logType, setLogType] = useState<LogType>('SSL')
  const [mbbsYear, setMbbsYear] = useState<MbbsYear>(1)
  const [department, setDepartment] = useState(options[1][0] ?? '')
  const [title, setTitle] = useState('')

  const deptChoices = options[mbbsYear] ?? []

  function submit() {
    if (!title.trim() || !department) return
    onCreate({ logType, department, mbbsYear, title: title.trim() })
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl p-6 w-full max-w-md">
        <h3 className="font-semibold text-slate-900 mb-4">New log template</h3>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Log type</label>
            <div className="flex gap-2">
              {(['SSL', 'SDL'] as LogType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setLogType(t)}
                  className={`flex-1 rounded-md border px-3 py-1.5 text-sm ${
                    logType === t
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-300 text-slate-700'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">MBBS Year</label>
            <select
              value={mbbsYear}
              onChange={(e) => {
                const y = Number(e.target.value) as MbbsYear
                setMbbsYear(y)
                setDepartment(options[y]?.[0] ?? '')
              }}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              {MBBS_YEARS.map((y) => (
                <option key={y} value={y}>
                  Year {y}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Department</label>
            <select
              value={department}
              onChange={(e) => setDepartment(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            >
              {deptChoices.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Log title (shown to students)
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={logType === 'SSL' ? 'e.g. Suturing Skills' : 'e.g. Self-Directed Learning'}
              className="w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <button
            onClick={submit}
            className="rounded-md bg-slate-900 text-white text-sm font-medium px-4 py-2 hover:bg-slate-800"
          >
            Create
          </button>
          <button onClick={onClose} className="text-sm text-slate-500 px-4 py-2">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
