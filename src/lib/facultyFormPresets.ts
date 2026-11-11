import type { FacultyFormType, FormField, FormFieldType } from '../types'

// Exact field structure transcribed from the three reference forms the
// user supplied (attaching references/CBD_Form.html, MINI_CEX_Form.html,
// OSCE_Form.html — NMC CBME workplace-based-assessment forms). Primary
// Admin creates a FacultyFormTemplate from one of these presets rather
// than hand-building ~30 fields from an empty canvas each time; the
// preset is a starting point copied into the new template's own `fields`
// array, so Primary Admin can still reorder/edit/remove fields afterward
// in the Forms page the same way any other admin-authored content works.
//
// Adaptation notes (structure kept faithful, a few literal UI mechanics
// simplified to fit this app's existing FormField model):
// - every "DD / MM / YYYY" triplet of inputs becomes one `type: 'date'`
//   field — same data captured, native date input instead of 3 boxes.
// - the reference's "tick one box, click again to clear" single-choice
//   checkbox groups become `type: 'dropdown'` (this app's existing
//   single-select shape); genuine multi-select groups (Areas Discussed /
//   Clinical Task Observed / Checklist Compliance) stay `type: 'checkbox'`.
// - a "Setting: ... Other: ____" combo is flattened to an `'Other'`
//   dropdown option rather than a nested free-text box.
// - OSCE's live-recalculating totals (station marks → Result Summary) are
//   plain number fields here, filled by the faculty — the reference's
//   auto-sum is a print-sheet convenience, not data this app needs to
//   compute.

const RATING_OPTIONS = ['Below Expectation', 'Meets Expectation', 'Above Expectation']
const LEVEL_OPTIONS = ['Below Expected Level', 'Meets Expected Level', 'Exceeds Expected Level']

function f(id: string, type: FormFieldType, label: string, section: string, extra?: Partial<Pick<FormField, 'options' | 'required'>>): FormField {
  return {
    id,
    type,
    label,
    section,
    required: extra?.required ?? false,
    options: extra?.options ?? null,
    maxRating: null,
  }
}

// Shared across all three — identity fields auto-populated from the
// selected student at fill time (see StandardFormPreview's prefill), kept
// editable in case of a correction.
function studentDetailsSection(extraDateField?: FormField): FormField[] {
  const base = [
    f('student_name', 'text', 'Name', 'Student Details'),
    f('roll_number', 'text', 'Roll Number', 'Student Details'),
    f('batch_phase', 'text', 'Batch/Phase', 'Student Details'),
    f('department', 'text', 'Department', 'Student Details'),
  ]
  return extraDateField ? [...base, extraDateField] : base
}

function feedbackSection(includeActionPlan: boolean): FormField[] {
  const fields = [
    f('fb_strengths', 'textarea', 'Strengths', 'Feedback'),
    f('fb_areas_for_improvement', 'textarea', 'Areas for Improvement', 'Feedback'),
  ]
  if (includeActionPlan) fields.push(f('fb_agreed_action_plan', 'textarea', 'Agreed Action Plan', 'Feedback'))
  return fields
}

function facultyAndAckSections(logbookOptions: string[]): FormField[] {
  return [
    f('faculty_name', 'text', 'Name', 'Faculty Details'),
    f('faculty_designation', 'text', 'Designation', 'Faculty Details'),
    f('faculty_signature', 'text', 'Signature (typed name)', 'Faculty Details'),
    f('faculty_date', 'date', 'Date', 'Faculty Details'),
    f('student_signature', 'text', 'Student Signature (typed name)', 'Student Acknowledgement'),
    f('student_date', 'date', 'Date', 'Student Acknowledgement'),
    f('logbook_status', 'dropdown', 'Logbook Entry Status', 'Logbook Entry Status', { options: logbookOptions, required: true }),
  ]
}

export const CBD_FIELDS: FormField[] = [
  ...studentDetailsSection(),
  f('case_date', 'date', 'Date', 'Case Details', { required: true }),
  f('setting', 'dropdown', 'Setting', 'Case Details', { options: ['OPD', 'Ward', 'Emergency', 'ICU', 'Other'] }),
  f('case_summary', 'textarea', 'Case Summary (Brief)', 'Case Details'),
  f('case_complexity', 'dropdown', 'Case Complexity', 'Case Details', { options: ['Low', 'Moderate', 'High'] }),
  f('areas_discussed', 'checkbox', 'Areas Discussed', 'Areas Discussed', {
    options: [
      'History & Clinical Findings',
      'Differential Diagnosis',
      'Investigations & Interpretation',
      'Final Diagnosis',
      'Management Plan',
      'Follow-up / Prognosis',
      'Ethical / AETCOM Issues',
    ],
  }),
  f('rate_clinical_reasoning', 'dropdown', 'Clinical reasoning & problem solving', 'Performance Assessment', { options: RATING_OPTIONS }),
  f('rate_knowledge_application', 'dropdown', 'Knowledge application', 'Performance Assessment', { options: RATING_OPTIONS }),
  f('rate_interpretation_investigations', 'dropdown', 'Interpretation of investigations', 'Performance Assessment', { options: RATING_OPTIONS }),
  f('rate_decision_making', 'dropdown', 'Decision making / management planning', 'Performance Assessment', { options: RATING_OPTIONS }),
  f('rate_communication', 'dropdown', 'Communication & explanation', 'Performance Assessment', { options: RATING_OPTIONS }),
  f('rate_professionalism', 'dropdown', 'Professionalism / ethics', 'Performance Assessment', { options: RATING_OPTIONS }),
  f('overall', 'dropdown', 'Overall Performance', 'Overall Performance', { options: LEVEL_OPTIONS, required: true }),
  ...feedbackSection(true),
  f('discussion_time_min', 'number', 'Discussion Time (minutes)', 'Time Spent'),
  f('feedback_time_min', 'number', 'Feedback Time (minutes)', 'Time Spent'),
  ...facultyAndAckSections(['Completed', 'Needs Repeat Assessment']),
]

export const MINI_CEX_FIELDS: FormField[] = [
  ...studentDetailsSection(),
  f('encounter_date', 'date', 'Date', 'Encounter Details', { required: true }),
  f('setting', 'dropdown', 'Setting', 'Encounter Details', { options: ['OPD', 'Ward', 'Emergency', 'ICU', 'Other'] }),
  f('patient_type', 'dropdown', 'Patient Type', 'Encounter Details', { options: ['New', 'Follow-up'] }),
  f('case_complexity', 'dropdown', 'Case Complexity', 'Encounter Details', { options: ['Low', 'Moderate', 'High'] }),
  f('clinical_task', 'checkbox', 'Clinical Task Observed', 'Clinical Task Observed', {
    options: ['History Taking', 'Physical Examination', 'Clinical Reasoning / Diagnosis', 'Counseling / Communication', 'Management Planning'],
  }),
  f('rate_history_taking', 'dropdown', 'History Taking', 'Performance Rating', { options: RATING_OPTIONS }),
  f('rate_physical_examination', 'dropdown', 'Physical Examination', 'Performance Rating', { options: RATING_OPTIONS }),
  f('rate_clinical_judgment', 'dropdown', 'Clinical Judgment', 'Performance Rating', { options: RATING_OPTIONS }),
  f('rate_communication_skills', 'dropdown', 'Communication Skills', 'Performance Rating', { options: RATING_OPTIONS }),
  f('rate_professionalism', 'dropdown', 'Professionalism', 'Performance Rating', { options: RATING_OPTIONS }),
  f('rate_organization_efficiency', 'dropdown', 'Organization & Efficiency', 'Performance Rating', { options: RATING_OPTIONS }),
  f('overall', 'dropdown', 'Overall Performance', 'Overall Performance', { options: LEVEL_OPTIONS, required: true }),
  ...feedbackSection(true),
  f('observation_time_min', 'number', 'Observation Time (minutes)', 'Time Spent'),
  f('feedback_time_min', 'number', 'Feedback Time (minutes)', 'Time Spent'),
  ...facultyAndAckSections(['Completed', 'Needs Repeat Assessment']),
]

const OSCE_STATIONS = [1, 2, 3, 4, 5, 6]

export const OSCE_FIELDS: FormField[] = [
  ...studentDetailsSection(f('osce_date', 'date', 'Date', 'Student Details', { required: true })),
  f('number_of_stations', 'number', 'Number of Stations', 'OSCE Structure'),
  f('maximum_marks', 'number', 'Maximum Marks', 'OSCE Structure'),
  f('osce_type', 'dropdown', 'Type', 'OSCE Structure', { options: ['Clinical', 'Procedural', 'Communication', 'AETCOM'] }),
  ...OSCE_STATIONS.flatMap((n) => [
    f(`s${n}_skill`, 'text', `Station ${n} — Skill Assessed`, 'Station-wise Assessment'),
    f(`s${n}_obtained`, 'number', `Station ${n} — Marks Obtained`, 'Station-wise Assessment'),
    f(`s${n}_max`, 'number', `Station ${n} — Max Marks`, 'Station-wise Assessment'),
    f(`s${n}_initial`, 'text', `Station ${n} — Examiner Initial`, 'Station-wise Assessment'),
  ]),
  f('global_rating', 'dropdown', 'Global Rating (Overall Competence)', 'Global Rating', { options: LEVEL_OPTIONS, required: true }),
  f('checklist_compliance', 'checkbox', 'Checklist Compliance', 'Checklist Compliance', {
    options: ['Standardized checklist used for all stations', 'Uniform marking scheme followed'],
  }),
  ...feedbackSection(false),
  f('total_obtained', 'number', 'Total Marks Obtained', 'Result Summary'),
  f('total_max', 'number', 'Total Maximum', 'Result Summary'),
  f('percentage', 'number', 'Percentage', 'Result Summary'),
  f('result_status', 'dropdown', 'Status', 'Result Summary', { options: ['Pass', 'Needs Improvement'], required: true }),
  ...facultyAndAckSections(['Completed', 'Repeat Required']),
]

export const PRESET_LABELS: Record<FacultyFormType, string> = {
  CBD: 'Case-Based Discussion (CBD)',
  MiniCEX: 'Mini-Clinical Evaluation Exercise (Mini-CEX)',
  OSCE: 'Objective Structured Clinical Examination (OSCE)',
  Custom: 'Custom — start from a blank form',
}

// 'Custom' deliberately returns no fields — FormEditorPage's own
// add-section/add-field controls build the structure from nothing,
// rather than this function faking a starter section.
export function getPresetFields(type: FacultyFormType): FormField[] {
  if (type === 'CBD') return CBD_FIELDS
  if (type === 'MiniCEX') return MINI_CEX_FIELDS
  if (type === 'OSCE') return OSCE_FIELDS
  return []
}

// Fields a faculty member shouldn't have to type by hand — prefilled from
// the selected student's profile / the signed-in faculty's own profile
// the moment a fill form opens, same "auto-populated identity fields"
// idea the build spec describes for DOPS, applied here to the field ids
// every one of these three presets actually uses.
export const STUDENT_AUTOFILL_IDS = ['student_name', 'roll_number', 'department', 'student_signature'] as const
export const FACULTY_AUTOFILL_IDS = ['faculty_name', 'faculty_signature'] as const
