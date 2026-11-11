# Role Creation Order & Feature Map

Source: `USOP_Technical_Architecture_Build_Spec.md` + `project_usop_mbbs_logbook.md` (clarified amendments).
This lists the order in which role accounts/logins should be created (based on data/hierarchy
dependencies), and the features each role owns.

---

## 1️⃣ Primary Administrator — create first
*Top of hierarchy, unrestricted access, seeds everything below.*

- Create/edit/deactivate any user account, any role, any institution
- Create institutions
- Global platform configuration
- Define competencies (what gets assessed, under which form types)
- **Dynamic SSL/SDL template builder (global scope)** — select department(s) + year(s) a template applies to *(amendment #1 — built, Dynamic Form Engine)*
- Department structure templates, college-specific *(amendment #2)*
- Video Tutorial Management: upload/organize/categorize/set access rules *(Module 7 — not built)*
- Unrestricted dashboard + full reporting across every institution

## 2️⃣ Institution Administrator — create second
*Needs an institution to exist, created by Primary Admin.*

- Create/activate/deactivate users within own institution
- Manage own institution's department + academic year structures (Module 2)
- **Toggle global SSL/SDL templates on/off per institution** — cannot edit/delete Primary Admin's global templates *(amendment #1 — built)*
- Author institution-specific SSL/SDL templates *(built)*
- Configure competencies within approved framework
- Institution-wide monitoring dashboard
- Institution-level reports, bulk account creation/export

## 3️⃣ Principal
*Read-only leadership view — no creation dependency on Institution Admin beyond data existing.*

- Institution-wide academic monitoring dashboard (read-only, no approvals)
- Departmental performance data across all departments
- Real-time visualizations: student data, competency status, activity trends
- Search/filter by department, batch, year, activity type
- Export institutional/departmental PDF reports

## 4️⃣ HOD
*Owns the department's student roster — needs department + faculty pool to exist.*

- Students assigned directly to HOD at registration (not to individual faculty)
- Oversee all faculty reviews within department
- Monitor all SSL/SDL logs submitted department-wide
- Full Faculty-level review powers **plus** department-wide scope:
  - Approve / Request Revision / Reject any submission
  - Complete DOPS / Mini-CEX / CBD / OSCE forms
  - Structured feedback
- Department-wide dashboards, competency status, activity reports

## 5️⃣ Faculty
*Peer to HOD in build order, but logically comes after HOD since HOD owns the roster faculty reviews against.*

- Dashboard of incoming submissions, auto-routed by department + year (+ SSL sub-field)
- Full submission context view (student, roll no., dept, year, log type, attachments)
- Approve / Request Revision / Reject
- Complete DOPS form — auto-populated fields (student profile, submission data) + manual fields (observation, rating, competency level, feedback, remarks, signature)
- **Forms Management Module** — independently search students by dept+year and submit CBD/OSCE/Mini-CEX/DOPS directly, with no prior submission required
- Faculty-specific video tutorials
- Own review history

## 6️⃣ Student — create last
*Depends on department, year, and HOD/faculty assignment already existing, plus active templates to log against.*

- Submit **SSL log**: select sub-field → auto-filtered faculty (dept+year+subfield) → select faculty → fill fields → attach docs → submit/draft
- Submit **SDL log**: title + description → attach docs → auto-filtered faculty (dept+year, no subfield) → submit/draft
- **Canvas drawing + image attachment** on submissions *(amendment #3 — scope undecided: markup-on-image vs blank canvas vs both)*
- **Edit-before-review lock** *(amendment #4 — trigger point undecided: on faculty open / on faculty decision / on submit)*
- Track submission status (pending/approved/revision/rejected)
- View faculty evaluations in real time
- **My Records**: all SSL/SDL logs, faculty reviews, DOPS/CBD/OSCE/Mini-CEX forms, attachments, feedback
- Download/view/print individual records
- Bulk-select export as PDF or ZIP
- Video tutorials filtered strictly to own year + department

---

## Cross-cutting build status (per CLAUDE.md, as of 2026-08-17)

| Phase | Status |
|---|---|
| Foundation (auth/role/routing, Firestore data layer, security rules) | ✅ done |
| Dynamic Form Engine (SSL tree + SDL templates, formSchemas, overrides) | ✅ done |
| Student Submission | ⬜ not built — includes the 2 open amendment decisions |
| Review & Evaluation (Faculty/HOD forms) | ⬜ not built |
| Forms Management / My Records | ⬜ not built |
| Video Tutorials / Reporting | ⬜ not built |
