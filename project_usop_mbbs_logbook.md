---
name: project-usop-mbbs-logbook
description: USOP - MBBS UG Logbook Management System architecture/build details and clarified decisions
metadata: 
  node_type: memory
  type: project
  originSessionId: 0b9dd9b9-4d22-4062-b5ff-19cff5c65fab
  modified: 2026-08-16T18:42:31.390Z
---

USOP is a cloud-based React + Tailwind + Firebase (Auth, Firestore, Cloud Storage, Hosting) SPA that digitizes MBBS undergraduate clinical/academic skill logbooks. Base architecture is fully specified in `/Users/sunny/Downloads/usop/USOP_Technical_Architecture_Build_Spec.md` (6 roles: Primary Admin, Institution Admin, Principal, HOD, Faculty, Student; SSL/SDL log submission; DOPS/CBD/OSCE/Mini-CEX review forms; My Records; Video Tutorials; role-scoped Firestore security rules). Built in phases: Foundation (auth/role/routing pipeline, Firestore data-access layer, security rules) and Dynamic Form Engine (SSL tree + SDL flat category templates, formSchemas, institution override toggles) are DONE as of 2026-08-17. Student Submission, Review & Evaluation, Forms Management/My Records, and Video Tutorials/Reporting are NOT yet implemented — this supersedes the earlier "no code exists yet" state noted below.

**Why:** User wants the base spec extended with features it didn't cover, then a complete architecture design, then phased implementation (per role/feature) starting one at a time.

**Clarified additions beyond the base spec doc (as of 2026-08-16):**

1. **Dynamic SSL/SDL form builder** — Primary Admin operates globally and creates SSL/SDL log templates by selecting which department(s) + year(s) they apply to. Institution Admin is scoped only to their own institution: can add institution-specific SSL/SDL log templates, and can **toggle (enable/disable) global templates per institution** but **cannot edit or delete** a global template created by Primary Admin. A disabled global template simply won't appear to students at that institution when submitting an activity.
2. **Departments are college-specific**, not one shared global list — Primary Admin can create department structures suitable for a specific college (Institution Admin also manages their own department/year structure per the base spec's Module 2).
3. **Canvas drawing + image attachment** on activity submission (student can attach images and freehand-draw) — exact scope (markup-on-image vs. blank canvas vs. both) not yet decided.
4. **Edit-before-review lock** — student can edit an activity's details/description before faculty review; exact lock trigger point (on faculty open vs. on faculty decision vs. on submit) not yet decided.
5. User has indicated there are more features to discuss beyond these — expect this list to grow. Update this memory as new decisions are confirmed.

**How to apply:** Treat the base spec doc as the foundation and this memory as the delta/amendments on top of it. When resuming design work, read both. See [[feedback_communication_style]] for how to pace clarifying questions with this user.
