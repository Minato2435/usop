export type Role =
  | 'primaryAdmin'
  | 'institutionAdmin'
  | 'principal'
  | 'hod'
  | 'faculty'
  | 'student'
  | 'skillLabDirector'

export const ROLES: Role[] = [
  'primaryAdmin',
  'institutionAdmin',
  'principal',
  'hod',
  'faculty',
  'student',
  'skillLabDirector',
]

export type MbbsYear = 1 | 2 | 3 | 4

export interface Institution {
  id: string
  name: string
  state: string
  city: string
  type: string
  establishedYear: number | null
  createdAt: number
}

export interface Department {
  id: string
  // "" (empty string, not null) for a shared-catalog department — Primary
  // Admin authors these on the Departments page and every institution gets
  // them by default (see InstitutionDepartmentOverride below for per-
  // institution include/exclude). A non-empty institutionId instead means
  // this department is *exclusive* to that one institution — created from
  // that institution's detail page (Institutions → click a card), not part
  // of the shared catalog. Same empty-string sentinel convention as
  // LogTemplate.institutionId, for the same reason.
  institutionId: string
  name: string
  mbbsYear: MbbsYear
  description: string
}

export interface AppUser {
  uid: string
  role: Role
  name: string
  email: string
  // 10-digit Indian mobile number, stored without the +91 prefix (the UI
  // renders the prefix as a fixed label beside the input). Unique across
  // the platform, enforced client-side at creation time.
  phone: string
  // `active` stays the sole field firestore.rules' isActive() reads to gate
  // access platform-wide — never repurpose or rename it. `rejected` is a
  // purely admin-facing refinement of *why* a user is inactive (a
  // deliberate pause that Resume reverses, vs. a rejected signup); a
  // rejected user always also has active === false. Active itself has no
  // separate "rejected === true" state.
  active: boolean
  rejected: boolean
  institutionId: string | null // null for primaryAdmin and skillLabDirector (both platform-wide)
  // faculty, hod only — one department each. A student has no department
  // field at all: they're bound by year only, and their departments are
  // derived live as every department enabled for their college in that
  // year (see lib/enabledDepartments.ts). Which one a given activity
  // belongs to is chosen per-submission on the Activities page and
  // stamped onto Submission.departmentId.
  departmentId: string | null // faculty, hod
  mbbsYear: MbbsYear | null // students only
  associatedMbbsYears: MbbsYear[] | null // faculty only
  rollNumber: string | null // students only
  assignedHOD: string | null // students only - uid of HOD
  // Students only: every year change made from the Promote students page,
  // oldest first. Absent until the student's first promotion.
  yearHistory?: YearChange[]
}

// One promotion (or its undo) of one student. `batchId` groups every
// student moved in the same action, so the whole batch can be undone.
export interface YearChange {
  batchId: string
  from: MbbsYear
  to: MbbsYear
  at: number
  byId: string
  byName: string
}

// --- Dynamic Form Engine (Phase 2) ---

export type LogType = 'SSL' | 'SDL'
export type TemplateScope = 'global' | 'institution'

export interface LogTemplate {
  id: string
  logType: LogType
  scope: TemplateScope
  // "" (empty string, not null) when scope === 'global'. Firestore list
  // queries must filter on every field a security rule checks (including
  // this one) or the query is denied outright — a plain string sentinel
  // avoids the extra edge cases of querying for null equality.
  institutionId: string
  department: string // department name, matches Department.name
  mbbsYear: MbbsYear
  title: string // top-level log title shown to students
  createdBy: string // uid
  createdAt: number
}

export type TreeNodeFieldType =
  | 'Section'
  | 'Short text'
  | 'Long text'
  | 'Number'
  | 'Date'
  | 'Dropdown'
  | 'Checklist'
  | 'Signature'

// SSL templates are a recursive category tree, stored as a flat subcollection
// (logTemplates/{templateId}/nodes/{nodeId}) with parentId pointers rather
// than nested documents, since Firestore has no native nested-document tree.
export interface TreeNode {
  id: string
  templateId: string
  parentId: string | null // null = top-level child of the template root
  title: string
  order: number
  // What a student fills in for this specific field when logging against
  // it. 'Section' nodes are pure structure (no input of their own) — set
  // automatically the moment a node gains its first child.
  type: TreeNodeFieldType
  required: boolean
  // "Leaf" (no children) is derived client-side from the node list, not
  // stored — avoids a flag going stale as children are added/removed.
  // Separate from `type`/`required` above: this is the structured
  // evaluation form (DOPS-style) faculty fill out for this procedure, not
  // what the student enters. Currently unreachable from the tree editor UI
  // (dropped to match an exact design reference) but the data layer
  // (lib/firestore/formSchemas.ts, FormSchemaEditor.tsx) is intentionally
  // kept — this is spec'd future functionality, not dead code.
  formSchemaId: string | null
}

// SDL templates use a flat category list instead of a tree, and carry no
// attached evaluation form (faculty review is a plain Approve/Revision/Reject
// decision with free-text feedback, not a structured form).
export interface SdlCategory {
  id: string
  templateId: string
  title: string
  order: number
}

export type FormFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'dropdown'
  | 'checkbox'
  | 'rating'

export interface FormField {
  id: string
  type: FormFieldType
  label: string
  required: boolean
  options: string[] | null // dropdown/checkbox choice list
  maxRating: number | null // rating fields only
  // Pure display grouping — "Student Details" / "Performance Rating" /
  // etc. Optional and ignored by DopsChecklistPreview's own step-N/
  // rating-/feedback parsing, so existing DOPS schemas are unaffected;
  // only the standalone Faculty Forms (CBD/Mini-CEX/OSCE, see below) use
  // it, rendered by StandardFormPreview.
  section?: string | null
}

// Reusable evaluation-form schema, attached to an SSL tree leaf node (the
// "DOPS-style form" faculty fill out for that specific procedure). With 57+
// SSL leaf types each potentially distinct, schemas are admin-authored data,
// not hardcoded per procedure.
// GMER competency levels: Observed, Assisted, Performed under supervision,
// Independently performed.
export type CompetencyLevel = 'O' | 'A' | 'P' | 'I'

export interface FormSchema {
  id: string
  title: string
  fields: FormField[]
  createdBy: string
  createdAt: number
  // Identity metadata about the competency itself (not something faculty
  // fill in per-attempt) — optional/nullable since schemas created before
  // this existed won't have it.
  code: string | null // e.g. "GMER 2019, Table 11"
  setting: string | null // e.g. "Skills Lab – Suturing Pad/Task Trainer"
  level: CompetencyLevel | null
  domains: string[] | null // e.g. ["Psychomotor", "Cognitive"]
}

// --- Forms Management (Module 05 — faculty-initiated path) ---
//
// Independent of the SSL submission/review pipeline above: a faculty
// member picks a student directly (not tied to any prior Submission) and
// fills out a standardized workplace-based-assessment form themselves, as
// the record. Reuses FormField[]/FieldAnswerValue — same shape DOPS
// checklists use — but these forms have genuine section headers (grouped
// via FormField.section above) rather than DOPS's step-N conventions, so
// they're rendered by a separate generic StandardFormPreview component,
// not DopsChecklistPreview.
// 'Custom' covers any admin-built form that isn't one of the three fixed
// presets — picking it at creation starts from a blank canvas (no preset
// fields) built up entirely via FormEditorPage's add-section/add-field
// controls, since not every assessment format NMC CBME forms cover is
// one of CBD/Mini-CEX/OSCE.
export type FacultyFormType = 'CBD' | 'MiniCEX' | 'OSCE' | 'Custom'

// Primary-Admin-authored form TYPE (e.g. "Case-Based Discussion Form") —
// the structure faculty will fill out. Turned on for a college by adding
// that institution's id to enabledInstitutionIds directly on this doc,
// rather than a parallel per-institution override collection the way
// Department/LogTemplate toggles work — there's no "shared catalog vs.
// institution-exclusive" split to reconcile here, just a plain on/off
// per institution, so the simpler array-on-the-doc shape is enough.
export interface FacultyFormTemplate {
  id: string
  formType: FacultyFormType
  title: string
  fields: FormField[]
  enabledInstitutionIds: string[]
  createdBy: string
  createdAt: number
}

// One filled-and-sent instance of a FacultyFormTemplate. One-shot by
// design (no draft/edit-after-send flow in this pass, matching "these are
// for the faculty only" — no HOD/student write path at all): a faculty
// member fills it out and sending IS creating the doc.
export interface FacultyForm {
  id: string
  formTemplateId: string
  formType: FacultyFormType
  title: string // denormalized from the template, survives a later rename
  institutionId: string
  departmentId: string
  facultyId: string
  studentId: string
  answers: Record<string, FieldAnswerValue>
  createdAt: number // also "sent at" — there's no later status transition
}

// Per-institution visibility toggle for a global template. Absence of a
// document for (institutionId, templateId) means "enabled" (the default);
// an explicit doc with enabled === false hides that global template from
// that institution's students. Global templates themselves are never
// editable/deletable by an Institution Admin, only toggleable.
export interface InstitutionTemplateOverride {
  id: string // `${institutionId}_${templateId}`
  institutionId: string
  templateId: string
  enabled: boolean
}

// Same absence-means-enabled pattern as InstitutionTemplateOverride above,
// but for a shared-catalog Department: every institution gets every
// catalog department by default, and an explicit enabled === false doc
// excludes one department from one institution.
export interface InstitutionDepartmentOverride {
  id: string // `${institutionId}_${departmentId}`
  institutionId: string
  departmentId: string
  enabled: boolean
}

// Same pattern again, one level more granular: toggles a single SSL
// competency (a TreeNode under a *global* SSL template) on/off for one
// institution's faculty/students, independent of whether the department
// itself or the whole template is enabled for that institution.
export interface InstitutionCompetencyOverride {
  id: string // `${institutionId}_${nodeId}`
  institutionId: string
  nodeId: string
  enabled: boolean
}

// Per-institution fork of a global competency's evaluation form. Absence
// means the institution uses the global FormSchema as-is; presence points
// at a FormSchema doc that is a private copy for that institution only —
// created by cloning the global form's fields on first edit. Editing this
// never touches the global FormSchema the node itself points at, so every
// other institution (and the global Competencies page) keeps seeing the
// original, unmodified form.
export interface InstitutionCompetencyFormOverride {
  id: string // `${institutionId}_${nodeId}`
  institutionId: string
  nodeId: string // the global TreeNode this overrides
  formSchemaId: string // this institution's own cloned FormSchema doc
}

// --- Video Tutorials (Module 07) ---

export type VideoAudience = 'student' | 'faculty'
export type VideoSource = 'upload' | 'link'

// Primary-Admin-authored content — same shared-catalog + institution-
// exclusive convention as Department (see its `institutionId` comment):
// "" means part of the shared catalog, a real institution id means this
// video belongs exclusively to that institution. `audience` splits every
// video into one of two tracks: a department's students only ever see that
// department's 'student' videos, its faculty only its 'faculty' videos.
export interface VideoTutorial {
  id: string
  title: string
  description: string
  source: VideoSource
  // Storage download URL when source === 'upload', or the external link
  // (YouTube/Vimeo/Drive/direct file) when source === 'link'.
  url: string
  // `videoTutorials/{id}/{fileName}` — set only for source === 'upload', so
  // the file can be deleted from Storage when the doc is deleted.
  storagePath: string | null
  // Admin-uploaded custom thumbnail image — independent of `source`, so
  // both a link-sourced and an upload-sourced video can have one. When
  // set, it takes priority over the auto-derived thumbnail (YouTube's own
  // image, or the client-side first-frame capture for uploads). Always an
  // uploaded file at `videoTutorials/{id}/thumbnail`, never an external
  // link — a "thumbnail" is inherently an image someone picked, not a URL
  // to embed.
  thumbnailUrl: string | null
  thumbnailStoragePath: string | null
  institutionId: string
  // Department.name it's published to, or '' = every department (all
  // students of `mbbsYear` / all faculty, regardless of department).
  department: string
  // Students only — faculty videos aren't tied to a year (stored, ignored).
  mbbsYear: MbbsYear
  audience: VideoAudience
  // Publish switch, owned by whoever authored the video (Primary Admin for
  // catalog videos, the college for its own). false = hidden from every
  // student/faculty viewer, kept in the admin list. Read as `active !==
  // false` (isVideoActive) so a doc without the field counts as on.
  active: boolean
  createdBy: string
  createdAt: number
}

// Per-institution include/exclude toggle for a shared-catalog video, same
// absence-means-enabled pattern as InstitutionCompetencyOverride.
export interface InstitutionVideoOverride {
  id: string // `${institutionId}_${videoId}`
  institutionId: string
  videoId: string
  enabled: boolean
}

// The subset of VideoTutorial's fields needed purely to *display* a
// video — thumbnail + preview player — independent of where that video
// actually lives. A real VideoTutorial already satisfies this trivially
// (structural typing); VideoBatch's own embedded video (below) builds one
// of these on the fly without ever being a VideoTutorial document itself.
export type VideoPreviewable = Pick<
  VideoTutorial,
  'title' | 'description' | 'department' | 'mbbsYear' | 'audience' | 'source' | 'url' | 'thumbnailUrl'
>

// One video embedded directly on a VideoBatch — never a VideoTutorial
// document (see VideoBatch's own comment below for why). `id` is a
// client-generated uuid (crypto.randomUUID(), same convention
// FormEditorPage.tsx/CompetencyEditorPage.tsx use for their own locally-
// keyed list items) — it's what namespaces this item's Storage path
// (`videoBatches/{batchId}/{videoItemId}/{fileName}`) and lets a single
// item be removed/replaced without disturbing its siblings.
export interface BatchVideoItem {
  id: string
  title: string
  description: string
  source: VideoSource
  // Storage download URL when source === 'upload', or the external link
  // (YouTube/Vimeo/Drive/direct file) when source === 'link'.
  url: string
  // `videoBatches/{batchId}/{videoItemId}/{fileName}` — set only for
  // source === 'upload', so the file can be deleted from Storage when
  // this item (or the whole batch) is removed.
  storagePath: string | null
  thumbnailUrl: string | null
  thumbnailStoragePath: string | null
}

// A temporary, scheduled grant of one or more specific videos to a hand-
// picked group of students or faculty — independent of any shared-catalog
// video's department/mbbsYear/audience tags. These videos are *not*
// VideoTutorial document references — each is uploaded/linked directly
// onto the batch itself (see BatchVideoItem above). That was a deliberate
// correction: an earlier version referenced an existing `videoId` from the
// catalog, which meant a video that happened to already match the target
// cohort's own department/year/audience stayed visible to them through the
// ordinary catalog the whole time, batch or no batch — the batch's
// schedule had nothing to gate. Giving every batch its own video(s), never
// entered into `videoTutorials`, makes that collision structurally
// impossible: none of these can ever be returned by
// watchStudentVideos/watchFacultyVideos. Multiple videos per batch (rather
// than one batch per video) was a direct follow-up ask — the same cohort/
// schedule/member list usually applies to a small set of videos together,
// not just one.
// "Auto-closes itself" is computed, not scheduled: there is no Cloud
// Function/cron in this project, so nothing flips a status field at
// `endAt` — videoBatchStatus() in lib/firestore/videoBatches.ts derives
// scheduled/active/expired from `startAt`/`endAt` vs. the current time,
// every time it's read. The batch document itself is never auto-deleted
// when it expires — it just stops granting access and its status badge
// reads "Expired"; only an explicit admin delete removes it (and every
// video's Storage files — see deleteVideoBatchAndFiles).
export interface VideoBatch {
  id: string
  title: string // admin-facing label, e.g. "Dermatology Year 2 — Nov batch"
  videos: BatchVideoItem[]
  institutionId: string
  departmentId: string
  mbbsYear: MbbsYear
  audience: VideoAudience
  memberIds: string[] // uids of the specific students/faculty clubbed into this batch
  startAt: number // epoch ms — videos become visible to members at this instant
  endAt: number // epoch ms — videos stop being visible to members after this instant
  createdBy: string
  createdAt: number
}

export type VideoBatchStatus = 'scheduled' | 'active' | 'expired'

// --- Student Submission / Faculty Review (Module 3 + 4, SSL only) ---

export type SubmissionStatus = 'draft' | 'submitted' | 'approved' | 'revisionRequested' | 'rejected'

// Whether this is the student's first time performing the skill, a repeat
// attempt, or a remedial attempt (redone after an earlier failed/rejected
// attempt) — distinct from `SubmissionStatus`, which tracks review state,
// not attempt history.
export type AttemptType = 'first' | 'repeat' | 'remedial'

// A checklist question's captured answer — dropdown/text/textarea store a
// string, checkbox a string[] (selected options), rating a number, and null
// means "not yet answered."
export type FieldAnswerValue = string | number | string[] | null

// The student's own SSL activity log: they browse their department's SSL
// template tree down to a leaf (a TreeNode with no children), fill out that
// leaf's attached DOPS-style checklist themselves as the record of what they
// did, and submit it to one faculty member in their own department. Faculty
// then review the *student's* filled checklist read-only and layer their own
// evaluation + decision on top (see the facultyX fields below) — they never
// rewrite `answers` (firestore.rules enforces this on update).
export type SubmissionImageKind = 'photo' | 'sketch'
export interface SubmissionImage {
  id: string
  kind: SubmissionImageKind
  url: string // Storage download URL
  path: string // Storage path ('' only for a legacy inline image)
}

export interface Submission {
  id: string
  studentId: string
  institutionId: string
  departmentId: string
  mbbsYear: MbbsYear
  logType: 'SSL' // SDL submission isn't built yet — see CLAUDE.md
  templateId: string // logTemplates/{id}
  nodeId: string // the leaf TreeNode chosen
  nodeTitle: string // denormalized so history still reads if the node is later renamed/removed
  // The FormSchema actually used — resolves an institution's forked copy
  // (InstitutionCompetencyFormOverride) ahead of the node's own global
  // formSchemaId, same precedence CompetencyEditorPage already applies.
  formSchemaId: string
  facultyId: string
  status: SubmissionStatus
  // True from the moment a student resubmits a submission that was sent
  // back `revisionRequested`, through to the faculty/HOD's next decision —
  // `status` itself goes straight back to 'submitted' on resubmit (so the
  // item correctly re-enters the normal pending-review queue/counts
  // unchanged), but without this flag a reviewer has no way to tell "this
  // is a first-time submission" apart from "this already came back once
  // and was just fixed" at a glance. `StatusPill` renders the Revision
  // Requested look (not Submitted) while `status === 'submitted' &&
  // resubmittedAfterRevision`, purely a display override — every pending-
  // queue filter/count still keys off the real `status` field, untouched.
  // Cleared back to false on every faculty/HOD decision (approve/reject/
  // request revision again), so the cycle can repeat indefinitely.
  resubmittedAfterRevision: boolean
  // Date the activity was actually performed (ISO 'YYYY-MM-DD', student-
  // picked, defaults to today) — distinct from `createdAt`/`submittedAt`,
  // which are write timestamps, not when the procedure happened.
  activityDate: string
  // '' until the student picks one — same required-before-submit pattern
  // as facultyId/leafNode.
  attemptType: AttemptType | ''
  answers: Record<string, FieldAnswerValue> // keyed by FormField.id
  // Student's own free-text write-up of the activity, as rich-text HTML from
  // the description editor on the New Activity page — separate from
  // `answers` (the structured checklist marks); never touched by faculty.
  description: string | null
  // Attached photos/sketches. The files themselves live in Firebase Storage
  // (submissions/{studentId}/{submissionId}/…); the doc only keeps these
  // small entries. Read through normalizeSubmissionImages() — very old docs
  // stored base64 data-URL strings here instead.
  images: SubmissionImage[]
  facultyFeedback: string | null
  facultyRemarks: string | null
  facultyRating: number | null
  competencyLevel: CompetencyLevel | null
  // Who actually recorded the latest decision — the assigned faculty, or the
  // department's HOD (who can decide any submission in their department).
  // Stored by name so the student's activity export can print it (students
  // don't need to read reviewer profiles). Absent on older submissions —
  // fall back to the assigned faculty.
  reviewedById?: string | null
  reviewedByName?: string | null
  reviewedByRole?: 'faculty' | 'hod' | null
  // The student's name and register number, copied on every save. After a
  // student is promoted to the next year, Year N staff can no longer read
  // their profile (profile reads are year-scoped), so reviewers fall back to
  // these. Absent on activities saved before this existed.
  studentName?: string | null
  studentRollNumber?: string | null
  submittedAt: number | null // set when status first becomes 'submitted'
  reviewedAt: number | null // set when faculty first records a decision
  createdAt: number
  updatedAt: number
}

// --- Certificates (new module) ---

// One preset of required SSL competencies per (institutionId, department, mbbsYear) — same
// global-vs-institution-exclusive split Department/LogTemplate/VideoTutorial already use:
// institutionId === '' means the shared-catalog preset for that department name+year (applies to
// any institution whose own department of that name has no institution-exclusive preset of its
// own); a real institutionId means this preset is exclusive to that one institution's own
// department of that name. watchCertificateSkillPreset() looks up the institution-exclusive one
// first, falling back to the global one.
export interface CertificateSkillPreset {
  id: string
  institutionId: string
  department: string // matches Department.name / LogTemplate.department
  mbbsYear: MbbsYear
  // Denormalized nodeId+title+templateId triples — same denormalization reasoning as
  // Submission.nodeTitle: a later rename/removal of the competency node doesn't retroactively
  // change what a student has already completed toward, or what an already-decided
  // CertificateRequest recorded as its own frozen snapshot (below).
  requiredSkills: { nodeId: string; nodeTitle: string; templateId: string; templateTitle?: string }[]
  createdBy: string
  createdAt: number
  updatedAt: number
}

export type CertificateDecision = 'pending' | 'approved' | 'rejected'

// One document PER (STUDENT, DEPARTMENT) FOR LIFE — doc id ===
// `${studentId}_${departmentId}` (see certificateRequestId() in
// lib/firestore/certificates.ts). A student is bound by year only and can
// be assigned several departments at once, so they can independently
// qualify for — and request — a certificate per department; this is NOT
// one document per student. Mirrors Submission's own single-evolving-
// document resubmission cycle (see the "Resubmission-after-revision
// labeling" section further down this file's comments / CLAUDE.md) rather
// than one row per attempt: a rejection by either approver resets BOTH
// decision fields back to 'pending' on this same document once the
// student resubmits — there is one "the story of this student's
// certificate for this department," not a history of discrete requests.
// `requiredSkills` is a frozen snapshot taken at request/resubmit time, so
// an admin later editing the live preset never silently rewrites what an
// already-decided request was judged against. Overall status is NEVER
// stored — see certificateRequestStatus() in lib/firestore/certificates.ts,
// same "derive, don't store" discipline as videoBatchStatus().
export interface CertificateRequest {
  id: string // === `${studentId}_${departmentId}`
  studentId: string
  institutionId: string
  departmentId: string
  department: string // denormalized name, matches the preset's own `department`
  mbbsYear: MbbsYear
  presetId: string
  requiredSkills: { nodeId: string; nodeTitle: string; templateId: string; templateTitle?: string }[]
  skillLabDirectorDecision: CertificateDecision
  skillLabDirectorBy: string | null
  skillLabDirectorAt: number | null
  skillLabDirectorRemarks: string | null
  // Approver display names, saved with the decision — students can't read
  // admin profiles, but the issued certificate shows who signed it.
  skillLabDirectorName?: string | null
  primaryAdminDecision: CertificateDecision
  primaryAdminBy: string | null
  primaryAdminAt: number | null
  primaryAdminRemarks: string | null
  primaryAdminName?: string | null
  requestedAt: number // reset on every resubmit-after-rejection
  updatedAt: number
}

export type CertificateRequestStatus = 'pending' | 'issued' | 'rejected'

// --- Platform Configuration (Module 09) ---

export type PlatformTheme =
  | 'inkGold'
  | 'clinicalTeal'
  | 'emeraldLedger'
  | 'monochrome'
  | 'deepBlue'
  | 'midnight'
  | 'classical'
  | 'spruceAmber'
  | 'clarity'

// A true singleton doc (platformConfig/settings), not a collection — the
// one global color theme applied across the whole Primary Admin panel via
// a `data-theme` attribute on <html> (see src/index.css and
// src/app/ThemeSync.tsx). Absence of this doc means the default theme
// ('inkGold', the original palette).
export interface PlatformConfig {
  id: string
  theme: PlatformTheme
  updatedAt: number
  updatedBy: string
}
