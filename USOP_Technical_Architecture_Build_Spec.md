# Technical Architecture & Build Specification
## MBBS UG Logbook Management System (USOP)

**Purpose of this document:** This is the complete technical build specification for the project. It explains what the system is, its full architecture, every user role and exactly what each can do, and every module/feature in implementation-level detail. This document contains no commercial, contractual, or pricing information — it exists purely to define what needs to be built.

---

## 1. PROJECT SUMMARY

**What it is:** A cloud-based, role-based, department-driven web application that digitizes clinical and academic skill tracking for MBBS undergraduate students across all four years of the program. It replaces paper logbooks with a structured digital system where students log their learning activity, faculty review and evaluate it, and administrators/leadership monitor the whole process.

**Core design principle:** Every user's experience — what they see, what they can select, what data they can access — is automatically shaped by three dimensions:
1. **Role** (Student / Faculty / HOD / Principal / Institution Administrator / Primary Administrator)
2. **MBBS Year** (1st–4th)
3. **Department** (varies by year)

**Core outcomes the system must deliver:**
- Fully paperless documentation
- Standardized, repeatable workflows
- Transparency and accountability in evaluation
- Real-time access to data for all roles
- Strict, secure, role-based data access control

---

## 2. TECHNOLOGY STACK

| Layer | Technology |
|---|---|
| Frontend | React + Tailwind CSS |
| Authentication | Firebase Authentication |
| Database | Cloud Firestore (real-time, document-based) |
| File/Document Storage | Firebase Cloud Storage |
| Video Storage & Streaming | Private cloud video storage with role-based access control |
| Hosting | Firebase Hosting |
| Data Access Control | Firestore Security Rules, enforced server-side (not just UI-level) |

**Build requirements:**
- Fully responsive UI across all screens (mobile, tablet, desktop)
- Real-time data sync — no manual refresh required anywhere in the app
- Standard modern browser/device compatibility
- Approximately 80–100 distinct application screens across all roles

---

## 3. ROLE ARCHITECTURE

### 3.1 Role Hierarchy

```
Primary Administrator
        │
Institution Administrator
        │
     Principal
        │
        HOD ───────► directly owns/manages Students in their department
        │
     Faculty ───────► interacts with Students only via review & forms workflow
        │
     Student
```

Six roles exist in the system. Each needs its own login experience, dashboard, and permission set enforced both in the UI and at the Firestore security-rule level.

### 3.2 Role Definitions & Full Capability List

#### 🔑 Primary Administrator
**System role:** Top-level, full-authority account.

**Permissions & capabilities:**
- Create, edit, deactivate any user account, of any role, anywhere in the system
- Full global platform configuration
- Define and configure competencies (what gets assessed, under which form types)
- Monitor all activity across every institution, department, and role — nothing is hidden from this role
- Full control of the Video Tutorial Management System: upload, organize, categorize, and set access rules for all video content
- Access the most complete, unrestricted dashboard and reporting view in the system

**Build note:** This role should have unrestricted Firestore read/write access via security rules, gated only by role-check on the authenticated user's custom claim/field.

---

#### 🛠️ Institution Administrator
**System role:** Operational admin, scoped to one institution.

**Permissions & capabilities:**
- Create, activate, and deactivate user accounts within their own institution
- Manage department structures and academic year definitions for their institution
- Configure competencies within their institution's approved framework
- Monitor student, faculty, and HOD activity institution-wide
- Generate institution-level reports and run bulk operations (e.g., bulk account creation, bulk exports)
- Institution-level compliance oversight
- View an institution-scoped dashboard

**Build note:** Security rules should scope all reads/writes to documents tagged with this admin's `institutionId`.

---

#### 🎓 Principal
**System role:** Institutional leadership — read/monitoring focused.

**Permissions & capabilities:**
- View an institution-wide academic monitoring dashboard
- Review departmental performance data across all departments
- See real-time visualizations of student data, competency status, and activity trends
- Search and filter records by department, batch, academic year, activity type
- Generate and export institutional/departmental performance reports as PDF

**Build note:** This role is read-only against operational data (logs, forms, reviews) — no write/approval actions are part of this role's function. Build it as a reporting/analytics-only interface.

---

#### 🏥 HOD (Head of Department)
**System role:** Departmental controller — owns the student roster for their department.

**Permissions & capabilities:**
- Students are assigned directly to the HOD upon registration (not to individual faculty) — HOD is the primary academic controller for all students in their department
- Oversee all faculty reviews happening within the department
- Monitor all SSL and SDL logs submitted within the department
- Full Faculty-level capabilities, plus department-wide scope:
  - Review student submissions
  - Approve / Request Revision / Reject any submission
  - Complete DOPS / Mini-CEX / CBD / OSCE evaluation forms
  - Provide structured feedback
- View department-wide dashboards, competency status, and activity reports

**Build note:** HOD's Firestore access should be scoped by `departmentId`, and the data model must reflect "student.assignedHOD" as a direct relationship distinct from faculty relationships (see Section 5, Data Model).

---

#### 👨‍⚕️ Faculty
**System role:** Front-line reviewer and evaluator.

**Permissions & capabilities:**
- Dashboard listing incoming student log submissions, auto-routed to them based on department + year (+ SSL sub-field) matching
- View full submission context: student name, roll number, department, MBBS year, log type, sub-field (if SSL), submission timestamp, all attached documents
- Approve, Request Revision, or Reject any submission
- Complete the DOPS evaluation form, which auto-populates several fields (see Section 6) and requires manual entry of: observation notes, rating, competency level, feedback, remarks, digital signature/approval
- Independently initiate evaluations through the Forms Management Module — search/filter students by department + year and submit a CBD, OSCE, Mini-CEX, or DOPS form directly, without requiring a prior student log submission
- Access faculty-specific video tutorials (form-completion guides, review workflow tutorials, navigation help)
- View their own complete review history with timestamps

**Build note:** Faculty's visible student pool must be dynamically computed from their registered `department` + `mbbsYear` mapping — this drives both what students they can search in Forms Management, and which submissions route to their dashboard.

---

#### 🎓 Student
**System role:** Primary content creator — the origin of all logged data.

**Permissions & capabilities:**
- Submit two distinct log types:
  - **SSL (Simulation Skill Lab) Log** — for procedure-based skill documentation
  - **SDL (Self-Directed Learning) Log** — for independent learning records
- Save any log entry as a draft, or submit it for review
- Track the status of every submission (pending / approved / revision requested / rejected)
- View faculty-completed evaluations instantly once submitted by faculty — reflected in real time in "My Records"
- Full access to the **My Records** module — the student's central repository, containing:
  - All SSL log submissions
  - All SDL log submissions
  - All faculty reviews
  - All completed DOPS, CBD, OSCE, Mini-CEX forms
  - All supporting attachments
  - All feedback and remarks from faculty
- Download, view, and print any individual record
- Bulk-select and export multiple records at once, as either PDF or ZIP
- Access video tutorials automatically filtered to their own registered MBBS Year + Department only — no access to other years/departments' content

**Build note:** Student's `mbbsYear` and `department` fields (set at registration) are the single source that drives both the faculty auto-filter logic and the video tutorial filter logic — treat this as a critical, immutable-after-registration (or admin-editable-only) pair of fields.

---

## 4. ACADEMIC STRUCTURE (Foundational Data Layer)

This is the reference data that every filtering and routing feature in the system depends on.

| MBBS Year | Departments |
|---|---|
| 1st Year | Anatomy, Physiology, Biochemistry |
| 2nd Year | Pathology, Pharmacology, Microbiology |
| 3rd Year | Community Medicine, ENT, Ophthalmology |
| 4th Year | General Medicine, Surgery, Pediatrics, OBG |

**Build requirements:**
- Every student record must store: `mbbsYear`, `department`
- Every faculty record must store: `department`, `associatedMbbsYear(s)`
- This year↔department mapping table should be admin-configurable (Institution Administrator level), not hardcoded, so departments/years can be adjusted without a code change
- All faculty-filtering, video-filtering, and form-routing logic reads from this mapping at query time

---

## 5. DATA MODEL — CORE ENTITIES & RELATIONSHIPS

The system needs strong relational integrity between the following entities, even within Firestore's document-oriented model (use structured collections/subcollections or denormalized reference fields as appropriate):

| Entity | Key Fields | Relationships |
|---|---|---|
| **User** | `uid`, `role`, `name`, `email`, `institutionId`, `departmentId`, `mbbsYear` (students only), `associatedMbbsYears` (faculty only) | Role determines which of the below entities this user can create/access |
| **Student** (extends User) | `rollNumber`, `assignedHOD` (direct reference), `mbbsYear`, `department` | Has many Submissions, Forms, Records |
| **Faculty** (extends User) | `department`, `associatedMbbsYears` | Reviews many Submissions; independently creates Forms |
| **Submission** | `studentId`, `logType` (SSL/SDL), `sslSubField` (if SSL), `facultyId`, `status` (draft/pending/approved/revision/rejected), `attachments[]`, `submittedAt` | Belongs to one Student, routed to one Faculty |
| **Form** (DOPS / CBD / OSCE / Mini-CEX) | `studentId`, `facultyId`, `formType`, `sourceSubmissionId` (nullable — null if faculty-initiated), `autoPopulatedFields{}`, `manualFields{}` (observation, rating, competency level, feedback, remarks, signature) | Belongs to one Student; created by one Faculty; optionally linked to a Submission |
| **VideoTutorial** | `title`, `targetRole` (student/faculty), `department`, `mbbsYear`, `storagePath`, `accessRules{}` | Filtered by department + mbbsYear + role at query time |
| **Department** | `name`, `mbbsYear`, `institutionId` | Reference data, admin-configurable |

**Critical build note:** The Submission → Form relationship must support two distinct creation paths:
1. **Log-triggered:** Student submits → Faculty opens it → Form auto-populates from Submission
2. **Faculty-initiated:** Faculty opens Forms Management → selects a student directly → Form has no linked Submission

Both paths must result in the Form appearing identically in the student's My Records.

---

## 6. MODULE-BY-MODULE FEATURE SPECIFICATION

### Module 1 — User Management & Authentication
- Firebase Authentication–based secure login for all 6 roles
- Role-based access control enforced via Firestore Security Rules, not just client-side routing
- User profile management (view/edit own profile per role)
- Account lifecycle management: creation, activation, deactivation (performed by Admin/Institution Admin depending on scope)

### Module 2 — Academic Structure Management
- CRUD interface (Institution Admin level) for departments and MBBS years
- Enforces the year↔department mapping described in Section 4

### Module 3 — Activity/Log Management (SSL & SDL)

**SSL (Simulation Skill Lab) Log submission flow:**
1. Student selects "SSL Log"
2. Student selects an SSL sub-field
3. System auto-filters and displays only faculty matching student's department + year + selected sub-field
4. Student selects a faculty member from the filtered list
5. Student completes all mandatory fields
6. Student uploads supporting documents/attachments
7. Student submits → entry routes instantly to selected faculty's dashboard

**SDL (Self-Directed Learning) Log submission flow:**
1. Student selects "SDL Log"
2. Student enters a title and detailed description of the learning activity
3. Student uploads supporting documents/attachments
4. System auto-filters faculty by department + year (no sub-field step)
5. Student selects faculty from filtered list
6. Student submits → routes to faculty dashboard

**Draft support:** Both log types must support save-as-draft before final submission.

**Faculty Auto-Selection Logic (build this as a reusable filtering function):**
```
Input: student.department, student.mbbsYear, (optional) selectedSubField
Output: list of Faculty where faculty.department == student.department 
        AND student.mbbsYear ∈ faculty.associatedMbbsYears
        AND (if SSL) faculty is eligible for selectedSubField
```

### Module 4 — Review & Evaluation Workflow

**Faculty/HOD dashboard — submission detail view must display:**
- Student name and roll number
- Department and MBBS year
- Log type (SSL/SDL) and sub-field if applicable
- Submission date/time
- Full submitted content and all attachments

**DOPS form auto-population — build this to fire automatically when faculty opens a log-linked form:**

| Field | Auto-filled from |
|---|---|
| Student Name | Student's registration profile |
| Roll Number | Student's registration profile |
| MBBS Year | Student's registration profile |
| Department | Student's registration profile |
| Log Type | The linked Submission |
| SSL Sub-field | The linked Submission (if SSL) |
| Submission Date | System timestamp of the Submission |
| Faculty Details | Currently logged-in faculty's profile |

**Manual fields faculty must complete to finish a review:**
- Observation notes (free text)
- Rating (numerical or categorical scale)
- Competency level achieved (classification)
- Feedback (free text)
- Remarks (free text)
- Digital signature / approval action

**Decision actions on any submission:** Approve / Request Revision / Reject.

**On save:** The completed review/form must write instantly to the student's My Records — build this as a real-time Firestore listener on the student side, not a polling mechanism.

### Module 5 — Forms Management Module (Faculty-Initiated Path)

Independent of the log-review flow — this is a second way for a Form to be created.

**Supported form types:** DOPS, Mini-CEX, CBD, OSCE.

**Faculty flow:**
1. Navigate to Forms Management Module
2. Select form type
3. Search/filter the student list by department + MBBS year
4. Select a student
5. Complete the form (observations, feedback, remarks, and other applicable fields per form type)
6. Submit directly to the selected student

**Build note:** This path creates a Form document with `sourceSubmissionId: null` — it must still render identically in the student's My Records as a log-triggered form.

### Module 6 — My Records (Student Central Repository)

Single consolidated view for the student, aggregating:

| Record Type | Source |
|---|---|
| SSL Log Submissions | Module 3 |
| SDL Log Submissions | Module 3 |
| Faculty Reviews | Module 4 |
| DOPS Forms | Module 4 & 5 |
| CBD Forms | Module 5 |
| OSCE Forms | Module 5 |
| Mini-CEX Forms | Module 5 |
| Supporting Attachments | All uploaded files across all record types |
| Feedback & Remarks | Extracted/aggregated from all reviews and forms |

**Output/export functionality to build:**
- Individual record view, download, and print
- Multi-select bulk export → generates either a combined PDF or a ZIP archive of selected records
- Print-formatted rendering for all record types (clean, professional layout suitable for physical printing)

### Module 7 — Video Tutorial Management System

**Student-facing:**
- Tutorial list auto-filtered to exactly the student's `mbbsYear` + `department` — no other content should be queryable or visible, enforce this at the security-rule level, not just UI filtering

**Faculty-facing:**
- Separate content track containing: DOPS completion guides, student review workflow tutorials, log review procedure guides, system navigation/documentation tutorials

**Admin-facing (Video Management Module):**
- Upload interface for video content
- Organize/categorize by Department + MBBS Year + User Role
- Access control configuration per video (which roles/departments/years can view)
- Maintain fully separate content tracks for student vs. faculty audiences

**Infrastructure to build:**
- Private cloud storage for video files — must not be publicly accessible via direct URL
- Role-based, access-controlled streaming (signed URLs or equivalent access-token mechanism)
- Delivery optimized for smooth playback, scoped strictly to authorized/authenticated users

### Module 8 — Dashboard & Reporting (All Roles)
- Distinct, role-customized dashboard for each of the 6 roles
- Real-time visualization components: student data, competency status, activity trends
- Universal search/filter capability by role, department, batch, academic year, activity type
- Export functionality: logbooks, competency records, assessment forms, activity reports — all as PDF
- Institutional and departmental performance report generation

### Module 9 — Administrative Controls
- User and role management interface (scoped by admin tier — see Section 3)
- Institution, department, and academic year management
- Competency configuration interface
- Cross-role activity monitoring dashboard
- General system/platform configuration screens

### Module 10 — System Automation Logic (Cross-Cutting, applies across modules)

Build these as core, reusable services rather than one-off feature code, since they're used in multiple modules:

| Automation | Trigger | Effect |
|---|---|---|
| Automatic Faculty Filtering | Student begins a log submission | Filters faculty list to eligible department/year(/sub-field) matches only |
| SSL Sub-field Faculty Refinement | Student selects an SSL sub-field | Further narrows the already-filtered faculty list |
| DOPS Form Auto-Population | Faculty opens a log-linked DOPS form | Pre-fills all derivable fields from Student + Submission data |
| Review Auto-Reflection | Faculty submits a completed review/form | Real-time write/sync to the student's My Records — no manual refresh needed |
| Department-Based Video Filtering | Student authenticates/loads tutorial section | Filters video list to their exact year + department |

---

## 7. SECURITY & ACCESS CONTROL REQUIREMENTS

- All role-based restrictions must be enforced at the **Firestore Security Rules** level — client-side hiding of UI elements is not sufficient on its own
- Students must only be able to read/write their own Submissions, Forms, and Records
- Faculty must only be able to read Submissions/Students within their own department + associated MBBS year(s)
- HOD must have read/write scope across their entire department (superset of a single Faculty's scope)
- Institution Administrator scope must be bounded to their own `institutionId`
- Primary Administrator has unrestricted access, gated by role-check only
- Video content access must be enforced server-side (not just filtered in the UI query) to prevent unauthorized cross-department/year access

---

## 8. NON-FUNCTIONAL REQUIREMENTS

- Fully responsive design across all ~80–100 screens (mobile, tablet, desktop breakpoints)
- Real-time data synchronization throughout — Firestore listeners over one-time fetches wherever live status matters (submission status, review results, dashboard counts)
- Standard modern browser/device compatibility
- Performance: navigation and data loading must remain smooth despite the large number of screens and real-time listeners running concurrently
- Data integrity: strict validation on all form submissions (mandatory fields, valid file types/sizes for attachments)
