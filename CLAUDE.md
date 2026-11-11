# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

USOP is a React + TypeScript SPA on Firebase that digitizes MBBS undergraduate clinical/academic
skill logbooks. Six roles (Primary Admin → Institution Admin → Principal / HOD → Faculty → Student)
each get their own dashboard and permission scope. Students log SSL (Simulation Skill Lab) and SDL
(Self-Directed Learning) activities against admin-authored templates; faculty/HOD review and
evaluate them. The full feature spec — every role's capabilities, the data model, and all planned
modules — is in `USOP_Technical_Architecture_Build_Spec.md`; read it before extending the role or
permission model, since decisions made there (e.g. exact field lists, review workflow rules) aren't
otherwise discoverable from the code.

The build proceeds in phases (Foundation → Dynamic Form Engine → Student Submission → Review &
Evaluation → Forms Management/My Records → Video Tutorials/Reporting). Foundation and the Dynamic
Form Engine are built. On top of that, the **Primary Administrator panel**, the **Institution
Administrator panel**, the **Student panel**, the **Faculty panel**, and now the **Principal panel**
and **HOD panel** have all had a full UI design pass — see their sections below for exactly what's
built vs. stubbed. SDL submission, file attachments on an SDL record (SSL already has them),
exports, and a dedicated reporting/analytics module beyond what Principal's dashboard already shows
are not implemented for any role — see the Student & Faculty section for exactly what SSL
submission covers today, and the Principal & HOD section for what those two roles can do.

## Commands

```bash
npm run dev       # start Vite dev server (localhost:5173)
npm run build     # tsc -b (typecheck) && vite build
npx tsc -b        # typecheck only, no build output
npm run lint      # oxlint
```

There is no test suite configured yet.

### Firebase

The project runs against the **live** Firebase project `usop-38351` — there is no emulator setup
(a deliberate choice; don't add `connectFirestoreEmulator`/`connectAuthEmulator` calls back in
without checking with the user first). `src/lib/firebase.ts` reads config from `.env`
(`VITE_FIREBASE_*`, see `.env.example`).

```bash
firebase use usop-38351                        # if no project is currently active
firebase deploy --only firestore:rules          # after editing firestore.rules
firebase deploy --only storage                  # after editing storage.rules
```

Security rules changes must be deployed manually — nothing deploys them automatically.

## Architecture

### Auth → role → routing pipeline

Firebase Auth only proves identity; **role and all scoping data live in Firestore**
(`users/{uid}` — see `AppUser` in `src/types/index.ts`), not in Auth custom claims. `AuthContext`
(`src/auth/AuthContext.tsx`) wires the two together: it listens to `onAuthStateChanged`, then opens
a real-time listener on the matching `users/{uid}` doc. `RequireRole` (`src/app/RequireRole.tsx`)
reads that context to guard routes and redirect to the right role-home path. If sign-in succeeds
but no profile doc exists or it fails to load, this is surfaced as a visible error (`profileError`
in `AuthContext`) rather than silently bouncing back to `/login` — that silent-bounce was a real bug
once, don't reintroduce it. Routes are defined per role under `/admin`, `/institution-admin`,
`/principal`, `/hod`, `/faculty`, `/student` in `src/app/AppRouter.tsx`.

### Firestore data-access layer

One file per collection under `src/lib/firestore/` (`users.ts`, `institutions.ts`,
`departments.ts`, `logTemplates.ts`, `formSchemas.ts`), each exporting `watch*` (real-time
`onSnapshot`), `get*`, `create*`, `update*`, `delete*` functions. Components never call the
Firestore SDK directly — they go through these. Real-time listeners are the default everywhere
(per the spec's non-functional requirement of no manual refresh), not one-time fetches.

### Critical Firestore rules gotcha: list queries need filter-complete queries

Firestore denies a `list`/query request outright — not just filters out disallowed docs — unless
the query's `where` filters cover every field the security rule reads for that collection. A `get`
by known document ID is unaffected; this only bites list/query reads. This is why
`logTemplates.ts` exports two separate functions, `watchGlobalTemplates` and
`watchInstitutionTemplates`, each always filtering on both `scope` and `institutionId` (the exact
fields `firestore.rules`' `canReadTemplateData()` checks), instead of one function with optional
filters. When adding a new collection with scoped read rules, follow this pattern: figure out
exactly which resource fields the rule depends on, and make sure every list query filters on all of
them. Get requests, and writes targeting a single known document, don't have this constraint — only
list/query reads do. Rules for `logTemplates/{id}/nodes` and `/categories` are deliberately relaxed
to "any active user" rather than re-checking the parent template's scope via a cross-document
`get()`, because that same list-query constraint can't be satisfied by a cross-document check —
taxonomy titles aren't sensitive, so this was an acceptable relaxation; don't apply that reasoning
to genuinely sensitive collections (submissions, PII) without thinking it through.

### Dynamic Form Engine (`src/components/formEngine/`, `src/lib/firestore/logTemplates.ts`)

- `logTemplates/{id}`: one per (logType SSL|SDL, department, mbbsYear, scope). `scope` is
  `'global'` (authored by Primary Admin, applies platform-wide) or `'institution'` (authored by an
  Institution Admin, applies only to their institution). **Global templates store
  `institutionId: ""`** (empty string, not `null`) — this is a deliberate sentinel to avoid
  Firestore's null-equality query edge cases; preserve it if you touch this code.
- SSL templates are a recursive category tree stored as a **flat subcollection**
  (`logTemplates/{id}/nodes/{nodeId}`) with `parentId` pointers, not nested documents — Firestore
  has no native document nesting. `TreeBuilder` reconstructs the tree client-side from the flat
  list. "Leaf" is derived (no children in the list), not a stored flag.
- Any tree node can carry an attached `formSchemaId` — the evaluation form (`formSchemas/{id}`)
  faculty fill out for that specific procedure. With 50+ SSL procedure types expected, each
  potentially has its own evaluation form — this is why forms are schema-driven
  (`FormField[]` with `type`, `options`, etc. in `src/types/index.ts`) rather than hardcoded forms.
- SDL templates use a flat `categories` subcollection instead of a tree, and never carry an
  attached form — SDL review is plain approve/revision/reject with free-text feedback, not a
  structured evaluation.
- Institution Admins can't edit or delete a global template. `institutionTemplateOverrides/{institutionId}_{templateId}`
  (whole-template on/off) still exists in the data layer but **nothing writes it anymore** — the
  Institution Admin Log Templates page's per-log title toggle, and the Primary Admin Institution
  Management portal's SSL Logs master toggle, both operate purely on `institutionCompetencyOverrides`
  (per-skill), staging every one of a log's skill nodes at once. A log reads as "on" while *any*
  skill is still included and flips "off" only when all are excluded (`.some`, not `.every`), so
  the two surfaces stay in sync. (`institutionTemplateOverrides` is only still read by the
  Institution Admin Dashboard's rough "active templates" count, which now effectively counts all of
  them.)
- `TemplateDetailPage` (`src/components/formEngine/TemplateDetailPage.tsx`) is role-agnostic and
  reused under both `/admin/log-templates/:id` and `/institution-admin/log-templates/:id` — access
  is enforced by Firestore rules based on the template's own `scope`/`institutionId`, not by which
  route renders it. Follow this pattern for future shared editors rather than duplicating per role.

### Role-based structure

`src/roles/<role-kebab-case>/` holds role-specific pages (mostly thin wrappers composing shared
components from `src/components/`). Shared, reusable pieces that aren't truly role-specific (like
`TemplateDetailPage` above) belong in `src/components/`, not duplicated per role.

## Primary Administrator panel

Everything under `src/roles/primary-admin/` got a full, deliberate visual design pass — a custom
shell, a small design-token system, a shared UI kit, and five functional pages plus three honest
"not built yet" pages, all wrapped in `<PrimaryAdminShell>`. This section is the map: read it
before touching anything under `/admin/*` so new work matches the existing system instead of
drifting into ad hoc styling. **Nothing under here is shared with the other five roles** —
`AppShell.tsx` (the plain generic shell used by Institution Admin/Principal/HOD/Faculty/Student) is
untouched by any of this. One exception within `primary-admin/` itself: `TemplateDetail.tsx` (the
per-template editor) still renders the shared `TemplateDetailPage` inside the *old* `AppShell`, not
`PrimaryAdminShell` — it wasn't re-skinned because it's shared with Institution Admin's route (see
the Dynamic Form Engine section above). Navigating there from the new Log Templates list page will
visibly drop back to the old chrome; that's a known, not-yet-closed seam, not a bug.

### Design system

Tokens live in `src/index.css` as a Tailwind v4 `@theme` block (`--color-*`, `--font-*`), so they
resolve to ordinary Tailwind utilities (`bg-ink`, `text-gold`, `font-display`, …) everywhere.
Fonts are loaded via Google Fonts `<link>` tags in `index.html` (Cormorant Garamond, Lora, IBM
Plex Mono) — not npm packages.

- **Palette**: `--color-ink` (#0B1220, near-black navy) for the sidebar/command layer;
  `--color-paper` (#F4F2EC, warm off-white) for the content canvas; `--color-gold` (#B8863B,
  antique brass) as the one accent color, used for active states, primary numerals, and the one
  signature ring/stripe per page; `--color-teal` / `--color-clay` as the only other signal colors
  (positive/active vs. destructive/inactive — see `Badge` tones). Deliberately not the generic
  cream+terracotta or black+neon-accent look — see the palette comment in `src/index.css`.
- **Type** (swapped from the original Fraunces/Public Sans pairing per a later user request —
  every `--font-*` token consumer picked this up automatically, no per-component font-family
  overrides needed except `Field`'s label, which didn't inherit `--font-display` before and had to
  be opted in explicitly): `Cormorant Garamond` (`--font-display` — headings, page titles, field
  labels, the big stat numerals; keep weight at 600/semibold max, bold is deliberately avoided),
  `Lora` (`--font-sans` — body text, table cells, inputs, small-caps-style kickers), `IBM Plex
  Mono` (`--font-mono`, unchanged — timestamps, counts, IDs, "Year N" tags — anything that reads
  as data rather than prose).
- **Shape**: two motifs, used deliberately, not interchangeably:
  - `.chamfer` / `.chamfer-sm` (defined in `src/index.css`) — a single cut top-right corner via
    `clip-path`. Reserved for primary chrome: buttons, stat tiles, modals, the sidebar brand mark,
    empty-state cards. This is the "notch" identity of the panel.
  - Plain `rounded-[10px]` rectangles — used for **content cards that hold user-typed data**
    (department cards, institution cards). This was a deliberate later correction: chamfered
    corners were tried on those cards first and dropped in favor of a plainer box shape, after the
    user pointed at a reference file (`Departments.dc.html`, still in the repo root) showing a
    simpler title/meta/divider/description card layout they preferred. See "Design references"
    below — don't reintroduce chamfering on department/institution cards without checking first.
- **Motion**: `.fade-up` (defined in `src/index.css`) for entrance animation, applied with a small
  per-item `animationDelay` stagger (`index * 35-40ms`) on card grids. `useCountUp`
  (`shell/useCountUp.ts`) eases stat-tile numbers up from 0 on data change. Sidebar width and mobile
  drawer both animate via CSS `transition`, no animation library is installed — everything here is
  hand-built CSS/inline SVG, deliberately avoiding new npm dependencies.
- **Icons**: `shell/Icon.tsx` — a hand-drawn inline-SVG icon set (`IconName` union type), 24×24,
  1.6px stroke, `strokeLinecap`/`strokeLinejoin: square`/`miter` (not round) to match the
  rectilinear shape language. No icon library is installed; add new icons here by adding a new
  `IconName` variant and a `case` in the switch — don't reach for a library.

### Shell (`shell/PrimaryAdminShell.tsx`)

Every `/admin/*` page wraps its content in `<PrimaryAdminShell eyebrow title actions>`. It owns:

- **Layout lock**: the outer container is `h-screen overflow-hidden` with only `<main>` scrolling
  (`overflow-y-auto`) — this was a deliberate fix (the sidebar used to scroll away with page
  content because the outer container was only `min-h-screen`). If you add a new full-height
  layout anywhere, replicate this pattern, not `min-h-screen`.
- **Desktop sidebar** (`md:` and up): static, collapsible between 272px (labelled) and 76px
  (icon-only) via a toggle button next to the brand mark at the *top* of the sidebar (not the
  bottom — this was also a deliberate move after user feedback). State persists to
  `localStorage` under `usop.admin.sidebarCollapsed`.
- **Mobile sidebar** (below `md`): a completely different mode, not just a narrow version of
  desktop — an off-canvas drawer (`fixed`, slides in via `transform`), opened by a hamburger button
  in the topbar, closed by backdrop-tap, an X button, or automatically on navigation. Always
  renders at full width with labels regardless of the desktop `collapsed` state (`showLabels =
  mobileOpen || !collapsed`) — collapsing to icon-only doesn't make sense inside a temporary
  overlay.
- **Nav structure**: a `NAV` array of grouped links (Overview / People & Institutions / Academic
  Structure / Content / System) — add new admin pages here, not by hand-editing the JSX list.
- **Topbar**: page eyebrow + title (from props) on the left, a live clock (updates every 30s,
  hidden below `lg`) and the page's `actions` slot (usually the primary "+ New X" button) on the
  right.
- Both the topbar's inner row and `<main>`'s content are wrapped in a `max-w-[1180px] mx-auto`
  container so content sits centered with breathing room on wide screens instead of hugging the
  sidebar (another deliberate fix after user feedback — the first version had content flush left).

### Shared UI kit (`shell/ui.tsx`)

Reusable primitives every admin page should use rather than re-styling inline:
`StatTile` (dashboard stat cards with count-up), `Card` (plain bordered container), `SectionLabel`,
`PrimaryButton` / `GhostButton` (chamfered vs. plain-bordered buttons), `Badge` (pill, tones:
`gold`/`teal`/`clay`/`neutral`), `Skeleton` (shimmer loading placeholder), `Modal` (backdrop +
chamfered panel, Esc-to-close), `Field` + `inputClass` (form field wrapper/shared input styling),
`RoadmapPanel` (the "this module isn't built yet" card — see Competencies/Video Tutorials/Platform
Config below).

### Pages — what's real vs. placeholder

All Firestore reads/writes below work under the **existing, unmodified** `firestore.rules` —
every new `watch*`/`create*`/`update*`/`delete*` function added this round was checked against the
rules first and needed no redeploy, because Primary Admin's rule branches don't depend on
`resource.data` (see the list-query gotcha section above). If you add a *write* surface for a
non-primary-admin role later, you will need a rules change + manual `firebase deploy`.

- **Dashboard** (`/admin`, `Dashboard.tsx`) — real-time stat tiles (institution count, total users
  + student sub-count, global log template count split SSL/SDL, department catalog count), an
  institutions list (name, created date, user count), and a workforce-by-role horizontal bar
  breakdown. All numbers are live Firestore data, nothing is mocked.
- **Institutions** (`/admin/institutions`, `InstitutionsPage.tsx`) — full CRUD-minus-delete: list,
  search (name/city/state), segmented type filter, create. The `Institution` type
  (`src/types/index.ts`) now carries `state`, `city`, `type`, `establishedYear` on top of the
  original `name`/`createdAt`. `state` is a dropdown sourced from `src/lib/indianStates.ts`
  (all 28 states + 8 union territories, grouped via `<optgroup>` — keep this file in sync if
  India's state list ever changes). `type` is one of a fixed 5-option list defined inline in
  `InstitutionsPage.tsx` (`INSTITUTION_TYPES`: Government/Private Medical College, Deemed
  University, Autonomous Institute, Trust/Society) — not stored anywhere else, edit that one array
  to change the options. Cards show a ringed initial-letter avatar, name, location, the type as a
  badge **on its own row below the name** (not beside it — an earlier version put it beside the
  name and it visually overflowed into the neighboring card because our type strings are much
  longer than a typical one-word type; don't put it back next to the title), then a three-column
  Admins/Users/Est. stat footer. Editing (name/state/city/type/established year) is available via a
  hover-reveal edit icon on each card/row (`InstitutionCard`/`InstitutionListRow`'s `onEdit`), which
  opens the same create-institution `Modal` pre-filled — a `formTarget: 'create' | Institution |
  null` dual-purpose state, the same convention the Video Tutorials pages already use, rather than
  a second modal. `updateInstitution()` in `lib/firestore/institutions.ts` is a plain `updateDoc` —
  no rules change was needed since `institutions/{id}`'s existing `write` rule
  (`isPrimaryAdmin()`) already covers update, not just create. No delete UI exists yet.
- **Departments** (`/admin/departments`, `DepartmentsPage.tsx`) — full CRUD: create, edit, delete
  (inline confirm-on-card, not a native `confirm()` dialog), search by name, filter by MBBS year,
  sort (name A–Z/Z–A, year 1→4/4→1). **Important architecture decision made mid-session**:
  departments are *not* institution-scoped here. They're authored as a shared catalog
  (name + MBBS year + description), with `institutionId` always written as `""` — the same
  empty-string sentinel convention `LogTemplate` already uses for global scope (see the type
  comment on `Department` in `src/types/index.ts`). The original design had an institution picker
  on this page and showed per-institution department counts elsewhere; both were removed when the
  user redirected department↔institution assignment to happen from the Institutions page instead
  — **that assignment UI does not exist yet**. If you build it, it'll need `institutionId` to
  become meaningful again, and the `firestore.rules` department read rule (currently scoped by
  `sameInstitution(resource.data.institutionId)` for non-primary-admin roles) will need the same
  "global readable by any active user" relaxation `logTemplates`'s rule already has, or list
  queries for institution-scoped departments will be denied outright for that role.
- **Users** (`/admin/users`, `UsersPage.tsx`) — list (all users platform-wide), role filter chips, a
  three-state status model (Active/Paused/Rejected — see below), and a shared **New user / Edit
  user** form (`shell/UserFormModal.tsx`, dual-purpose via an optional `editingUser` prop).
  Provisioning a user for someone else means creating *their* Firebase Auth account —
  `createUserWithEmailAndPassword` signs in as whoever it just created, which would kick the admin
  out of their own session if run on the app's shared `auth` instance. Solved without a Cloud
  Function: `createUserAccount()` (`lib/firestore/users.ts`) spins up a second, separately named
  Firebase App (its own isolated Auth instance, same project config), creates the account there,
  signs that instance back out, tears it down, then writes the `users/{uid}` profile doc via the
  primary admin's normal (already-permitted) Firestore session. Editing an existing user
  (`updateUserProfile()`) only ever touches the Firestore profile doc — email and password are
  deliberately not editable from this form, since rewriting either for a *different* user's Auth
  account needs either that user's own re-auth or the Admin SDK/a Cloud Function, neither of which
  exists here; faking it client-side would silently desync Auth from the profile doc. `AppUser` now
  also carries `phone` (10-digit Indian mobile, `+91` rendered as a fixed UI prefix rather than
  stored) and `rejected` (boolean). **Status model**: `active` stays the one field
  `firestore.rules`' `isActive()` reads to gate access platform-wide — never rename or repurpose it.
  `rejected` is a purely admin-facing refinement of *why* a user is inactive, always written
  together with `active` via the single `setUserStatus()` function so the two can't drift into a
  nonsensical combination: **Active** (`active: true`), **Paused** (`active: false, rejected:
  false`, reversible via Resume), **Rejected** (`active: false, rejected: true`, also reversible via
  Resume — Resume always clears `rejected` regardless of which inactive state a user was in). Email
  uniqueness is enforced by Firebase Auth itself (caught as `auth/email-already-in-use`); phone and
  `rollNumber` uniqueness are checked client-side against the already-loaded platform-wide user
  list — there's no Firestore-level uniqueness constraint, so this is a UI-layer guard, not a hard
  guarantee under concurrent writes. Whenever the Institution field isn't locked (i.e. Primary
  Admin creating/editing any role, most usefully Student given how many institutions can exist
  platform-wide), a **State** dropdown appears above it (`INDIAN_STATES`/`INDIAN_UNION_TERRITORIES`
  from `lib/indianStates.ts`, same source `InstitutionsPage` uses) that narrows the Institution
  list to that state's institutions; picking a state that doesn't contain the currently-selected
  institution clears the Institution/Department/Assigned-HOD picks so they can't disagree. It's
  local UI-only filtering — `Institution.state` already existed on every institution, nothing new
  was added to the data model. Institution Admin's own form never shows it, since their Institution
  field is already locked to their one institution.
- **Log Templates** (`/admin/log-templates`, `LogTemplatesPage.tsx`) — pre-existing Dynamic Form
  Engine page, re-skinned to the new shell/design language this session; its actual logic
  (global SSL/SDL template creation, per-department/year grouping) is untouched. Clicking into a
  template still goes to `TemplateDetail.tsx` → the shared `TemplateDetailPage.tsx`, which is
  **not** re-skinned (it's shared with Institution Admin's route — see the Dynamic Form Engine
  section above for why it isn't forked per role).
- **Competencies / Video Tutorials / Platform Configuration** (`/admin/competencies`,
  `/admin/video-tutorials`, `/admin/settings`) — each just renders `RoadmapPanel` with a module
  tag, description, and a "Not yet built" badge. These correspond to Module 09 (competency config,
  general platform settings) and Module 07 (video tutorials) in the build spec, neither of which
  has a data model or backend yet. Don't build fake CRUD for these — replace the `RoadmapPanel`
  with real functionality only once the underlying Firestore collection/rules exist.

### Design references (repo root, not part of the app bundle)

Two example files were dropped in the project root during design iteration — `Departments.dc.html`
and `Institution Management.html` (also `Screenshot 2026-08-19 at 1.02.40 AM.png`, a bug repro).
They're Design-Canvas mockups the user liked stylistically and asked to adapt (not copy verbatim —
colors/fonts/shell stayed ours, structural ideas were borrowed):

- `Departments.dc.html` → the department card's plain rounded-box shape (title → meta line →
  divider → description), replacing an earlier chamfered "monogram medallion" card design.
- `Institution Management.html` → the institution card's ringed initial-letter avatar, the type
  tag placement, the three-stat centered footer, the search+segmented-type-filter toolbar, and the
  "Established year" field (this field didn't exist before that reference).

These files are large (the `.dc.html` ones embed base64 fonts, 500KB+) and safe to delete once
you're confident no further design iteration needs them — they aren't imported or referenced by
any source file.

### Mobile responsiveness

Built in as a dedicated pass, not incidentally: the sidebar becomes an off-canvas drawer (see
Shell above); stat tile grids drop to 1 column below `sm`; the Users table wraps in a horizontal
`overflow-x-auto` container (`min-w-[560px]`) rather than crushing columns; header/main padding
scales down (`px-4 py-6` vs `px-8 py-10`); the topbar clock hides below `lg`. Card layouts use
`min-w-0 flex-1` on any text sibling that shares a flex row with a fixed-width element (an icon
button, a badge) — flex items default to `min-width: auto` and refuse to shrink below their
content's natural width otherwise, which caused a real overflow bug (long institution/department
names pushing siblings out of their card) fixed this session. Follow this pattern for any new
title-plus-fixed-thing row: wrap the flexible text in `min-w-0 flex-1` (and add `break-words` if
the text has no guaranteed spaces).

## Institution Administrator panel

`src/roles/institution-admin/` — six pages (Dashboard, Departments, Competencies, Log Templates,
Video Tutorials, Users), all under `<InstitutionAdminShell>`, everything scoped to the signed-in
admin's own `institutionId`. No Platform Configuration page — the color theme is a primary-admin-
only, platform-wide setting, and applies here automatically via the same `ThemeSync` mechanism
(it's gated on `isActive()`, not role).

- **Shell reuse, deliberately cross-role**: `InstitutionAdminShell.tsx` imports `Icon`, `ui.tsx`
  (Card/Modal/Field/Button/Badge/Skeleton/StatTile/etc.), `ThemeToggle`, `VideoShared.tsx`'s
  `ToggleSwitch`, and `UserFormModal` directly from `src/roles/primary-admin/shell/` rather than
  duplicating them — they're genuinely role-agnostic (no primary-admin-specific behavior baked
  in), and copying a few hundred lines of hand-drawn icon SVGs and shared primitives just to avoid
  an import across role folders isn't worth it. This is a known architectural wart (importing from
  a sibling role's folder rather than a true shared `src/shell/`) — acceptable for now since fixing
  it means touching every existing primary-admin import, which wasn't worth the risk in the same
  pass as building this whole panel. `InstitutionAdminShell` itself, and everything under
  `institution-admin/`, is not shared back the other way.
- **Toggle pattern**: the four content pages (Departments/Competencies/Log Templates/Video
  Tutorials) all follow the same draft-then-save interaction the Primary Admin Institution
  Management portal (`InstitutionDetailPage.tsx`) established for its own tabs — a local `draft`
  map of pending overrides, a `SaveChangesBar` (nothing writes to Firestore until "Save changes"),
  Select all/Deselect all, master `ToggleSwitch` per row. **Every `institution*Overrides` toggle
  is read/written by the same collection on both the Primary Admin portal and the Institution
  Admin page**, so an action in one shows up in the other: `institutionDepartmentOverrides`
  (catalog *and* institution-only departments — the Institution Admin's "own" sub-tab has the
  toggle too, not just the catalog one), `institutionCompetencyOverrides` (per-skill, used by
  *both* the Log Templates title toggle and the Competencies page — see the Dynamic Form Engine
  section), `institutionVideoOverrides` (catalog *and* institution-specific videos),
  `institutionCompetencyFormOverride` (the "Customized" fork — the badge shows on the Institution
  Admin Competencies page). `institutionTemplateOverrides` is the one exception: nothing writes it
  anymore (see Dynamic Form Engine section). `shell/toggleUi.tsx` holds the small
  shared pieces (`SaveChangesBar`, `ToggleRow`, `SubTabBar`) built fresh for this panel rather than
  extracted from `InstitutionDetailPage.tsx` — that file is a single ~2,300-line component with
  nothing exported for reuse, and refactoring it apart carried real risk of breaking Primary
  Admin's already-working per-institution portal. These pages are faithful to the *interaction
  pattern*, not a byte-for-byte port of every feature in that file. The Log Templates page's cards
  mirror the admin portal's SSL Logs cards fully: each log shows every one of its skill nodes as
  its own small `ToggleSwitch` row underneath the title (all nodes, not just leaves — same shape
  the admin portal's cards use), for both the Global and Institution-specific sub-tabs.
  **Competencies** (`institution-admin/CompetenciesPage.tsx`) instead mirrors a *different* Primary
  Admin page — the standalone catalog browser at `/admin/competencies`
  (`primary-admin/CompetenciesPage.tsx`), not the SSL Logs tab: a shared `CompetencyLibrary`
  component reproduces that page's collapsible department sidebar, 3-stat strip, search +
  grid/list toolbar, and grouped-by-department cards/rows (monogram avatar, hover-lift shadow),
  used by both sub-tabs — with a `ToggleSwitch` worked into every card/row (the admin catalog page
  never needed one; it authors the global catalog, it doesn't enable/disable it per institution).
  Global sub-tab cards show a "Customized" badge and link to `/institution-admin/competencies/
  global/:templateId/:nodeId` (Customize/Edit); own sub-tab cards link to `/own/:templateId/
  :nodeId` (Edit) — both routes into the shared `CompetencyEditorPage` (see above).
- **Editing a competency's checklist** (Institution Admin) reuses the *entire* Primary Admin
  `CompetencyEditorPage.tsx` rather than reimplementing it. That component grew three optional
  props (`variant`, `ShellComponent`, `forkForInstitution`, all defaulting to the primary-admin
  behavior so its existing route is untouched); `institution-admin/CompetencyEditorPage.tsx` is a
  ~15-line wrapper that injects `InstitutionAdminShell` and keeps every back-nav inside
  `/institution-admin`. Two routes disambiguate the mode via the URL rather than any fragile
  `template.scope` inference: `/institution-admin/competencies/global/:templateId/:nodeId` forks
  the global competency's form for this institution (`institutionCompetencyFormOverride` + a
  cloned private `FormSchema`, created on first edit — global and every other institution
  untouched; a "Remove institution-specific version" action reverts), and
  `/institution-admin/competencies/own/:templateId/:nodeId` edits a node in one of the
  institution's own SSL logs directly. Both are already permitted by the unmodified
  `firestore.rules` (`institutionCompetencyFormOverrides` write → `isInstitutionAdminFor`,
  `formSchemas` write → any institution admin). The Competencies page marks forked procedures with
  a "Customized" badge (from `watchInstitutionCompetencyFormOverrides`).
- **Users** (`/institution-admin/users`) — reuses `UserFormModal` via two additive props it didn't
  need before: `allowedRoles` (here, `principal`/`hod`/`faculty`/`student` — an institution admin
  can't create a peer or superior admin account) and automatic institution-locking (passing a
  single-item `institutions` array disables the picker, since there's nothing to choose). Same
  three-state status model (Active/Paused/Rejected) as the Primary Admin Users page.
- **Two `firestore.rules` gaps fixed to make this possible, not just look right** (both deployed
  together with this panel, not before):
  - `departments/{departmentId}` read was `isPrimaryAdmin() || sameInstitution(resource.data.institutionId)`
    — `sameInstitution('')` is only true for a user whose *own* `institutionId` is `''`, which no
    real institution admin ever has, so an institution admin's own Departments page couldn't even
    list the shared catalog to decide what to include. Added an `isActive() && resource.data.institutionId == ''`
    branch, same relaxation `logTemplates` already has for its global scope. New
    `watchCatalogDepartments()` in `lib/firestore/departments.ts` queries that shape explicitly
    (`watchAllDepartments()` stays primary-admin-only — an unfiltered list query the rule can't
    satisfy for anyone else).
  - `videoTutorials/{videoId}` write was `isPrimaryAdmin()` only, unlike every sibling content type
    (departments, logTemplates, competency/video overrides), which all already let an institution
    admin manage their own `institutionId`-scoped content. Split into `create`/`update, delete`
    mirroring `logTemplates`'s exact pattern, so an institution admin can now author their own
    institution-exclusive videos, not just toggle catalog ones.
  - Also added `watchInstitutionUsers(institutionId, ...)` to `lib/firestore/users.ts` — the
    existing `watchUsers()` is an unfiltered list query, fine for primary admin (whose rule branch
    doesn't depend on `resource.data`) but denied outright for an institution admin, whose branch
    does.

## Student & Faculty panels

`src/roles/student/` and `src/roles/faculty/` cover SSL activity submission and review end to end
— **SSL only** (no SDL submission yet) and **no file attachments** (both deliberately out of scope
for this pass; `storage.rules` still just has a placeholder comment for the latter). Built on the
*real* Dynamic Form Engine (`logTemplates` → recursive `nodes` tree → a leaf's attached
`formSchemaId` DOPS checklist), not the older build spec's flat `sslSubField` description — the
spec predates this engine.

- **Flow**: the entire "log an activity" experience is **one page**
  (`student/ActivitiesPage.tsx`, route `/student/activities`) — not a browse page that hands off to
  a separate fill-and-submit route. It's a progressive, numbered-step form ("Step 01" / "Step 02" /
  ... — the same kicker language `CompetencyEditorPage`'s `StepHeader` uses in the admin panel,
  reused verbatim here on purpose): **01** pick a log from a `<select>`; **02** a *cascading chain*
  of `<select>` dropdowns walks the tree one level at a time — each dropdown's options are the
  children of whatever was picked in the one above, a new dropdown only appears once the current
  pick itself has children, and the chain stops the moment a pick is a leaf (zero children); **03**
  pick a faculty member from a dropdown, scoped to the student's own department; **04** an optional
  rich-text description. Save draft or Submit. **The student never sees or fills the DOPS
  checklist** — that's the faculty's own reviewing tool (see the reversal note just below), so the
  submit button is disabled (with an inline note) whenever the resolved leaf has no checklist
  configured at all, since there'd be nothing for the faculty to review it against. That faculty
  sees it in their inbox and layers their own evaluation (the checklist itself,
  feedback/remarks/rating/competency level) plus a decision — Approve / Request Revision / Reject —
  on top. A revision request sends it back to the student as an editable draft (same doc, same id,
  `?submissionId=` resumes it on the same page — reconstructing every cascading dropdown's
  selection from the saved leaf via `buildPathToNode()`, which walks `parentId` back to the root)
  rather than starting over.
  - **Reversed mid-build, twice**: the very first pass had the student fill the DOPS checklist
    themselves as their own activity record, faculty reviewing it read-only. The user corrected
    this — the checklist is the *faculty's* reviewing instrument, filled during review, never shown
    to the student — so `ActivitiesPage.tsx`'s checklist step (`DopsChecklistPreview mode="fill"`)
    was removed outright, `answers` is now always written as `{}` at submission-creation time and
    never touched again by the student. **This was completed in a later pass** — see "Faculty
    review flow completion" further below for `ReviewSubmissionPage.tsx` actually letting faculty
    fill the checklist (`mode="fill"`) and the matching `firestore.rules` flip.
  - **Earlier version, also replaced**: before that, the first pass split log-selection into a
    card-based, breadcrumb-driven `TreeBrowser` browse page plus a separate
    `/student/activities/:templateId/:nodeId` fill route. The user rejected that shape too (wanted
    dropdowns cascading in place on one page) — `TreeBrowser.tsx` and `SubmitActivityPage.tsx` were
    deleted, not kept as unused alternatives.
  - **Design reference**: `attaching references/New Activity.dc.html` — a Design-Canvas mockup the
    user pointed at and asked to adapt (not copy verbatim; same "borrow the structure, keep our own
    colors/fonts/tokens" treatment as the root-level `Departments.dc.html`/`Institution
    Management.html` references documented under the Primary Admin panel above). What was actually
    adopted into `ActivitiesPage.tsx`: the `FRow` two-column layout (a quiet large display-font
    numeral + small uppercase kicker on the left, title/hint/control on the right); every step
    rendering *always*, with `locked` muting whichever ones aren't reachable yet (dashed border, no
    shadow, faded) rather than conditionally hiding them; the cascade dropdowns' row layout with a
    fixed-width "Category"/"Level N" label per row; the `TrailChips` breadcrumb summary of the
    resolved path; the dynamic `submitHint` line next to the bottom action buttons; and the
    character count under the description editor.
  - **Iterated past the reference's own layout, twice, on direct feedback**: the reference (and the
    first pass here) separated steps with hairline rules on one flat sheet. A follow-up request
    then wrapped the *whole* sheet in one bordered, shadowed cream-tinted card — reverted just as
    quickly on "didn't like it, make it look like before." The version that stuck is a third shape,
    requested right after: **each `FRow` is now its own lifted rounded-16 card** (`fade-up` with a
    per-index stagger), not one flat sheet and not one big box. Each card also carries a computed
    `active` state — a gold-tinted ground, gold-line border, soft gold glow, and a small "Current
    step" flag on whichever step the student should act on next (step 1 until a log is picked, step
    2 until the tree resolves to a leaf, step 3 until faculty is picked, step 4 once everything
    required is done) — the one deliberate spot of color as you scan down the page. An inactive
    card's background is the same `color-mix(in srgb, var(--color-paper-raised) 58%, var(--color-
    paper) 42%)` tint every institution/department card in the Primary Admin panel already uses,
    not flat white — a pure-white card read as "too white" against this warm palette. The bottom
    Save/Submit bar picked up the same card treatment (tint included) for consistency. Don't
    re-flatten this back into hairline-divided rows, a single wrapping box, or plain white cards
    without checking first — all were tried and moved past.
  - **Card sizing went through several rounds and landed back at the original size** — worth
    knowing the history so it doesn't get re-litigated. In order: "make it bigger" (enlarged every
    card uniformly) → "only the description card, so the Quill toolbar fits on one line" (a `large`
    prop on `FRow`, only step 04) → "make steps 01–03 match step 04" (`large` removed again, its
    sizing folded into `FRow`'s only style, all four cards *and* the bottom Save/Submit bar sharing
    one enlarged size with a symmetric break wider than the shared 860px column) → "add some
    graphics" (each card got a large watermark `Icon` plus a small solid-icon circle badge,
    `folder`/`target`/`cap`/`edit` per step) → "revert the graphics" and, in the same pass, "make
    the toolbar fit one line via the card, not by resizing the card" — realizing the *actual* need
    was never a bigger card, just a toolbar that doesn't wrap. **Where it landed**: `FRow` is back
    to its original size (148px numeral column, `p-6 md:p-7`, no icon graphics) for steps 01–03,
    and `RichTextEditor.tsx`'s `.ql-toolbar.ql-snow` gets `white-space: nowrap; overflow-x: auto` —
    every format group stays on one row regardless of card width, scrolling sideways if it doesn't
    fit, so toolbar layout is no longer coupled to card width at all. What follows is a short chain
    of the same width break-out (`md:w-[calc(100%+220px)] md:-ml-[110px]`) being applied to
    different scopes across three requests: "extend the Quill editor horizontally" → a `wide` prop
    on `FRow`, only step 04 got it; "every card needs to be in matching style" → the `wide` prop
    removed entirely rather than left unused, all four cards back to the plain 860px width for
    consistency; "make it like [the width break-out] previously, increase all cards a little" → the
    exact same break-out folded straight into `FRow`'s one shared class (no prop at all now) *and*
    onto the bottom Save/Submit bar, so it's applied uniformly rather than as an optional variant.
    **Current, settled state**: every card and the action bar share one size — `p-8 md:p-10`, 160px
    numeral column, 38px numeral, 21px title, *and* the same `md:w-[calc(100%+220px)]
    md:-ml-[110px]` width break-out — no per-step differences of any kind. If a future request
    wants one step sized or widthed differently again, that cuts against "every card matching,"
    which was explicit, recent feedback — confirm before reintroducing an asymmetry.
    What was **not** adopted from the reference itself: its checklist-and-rating section (removed
    from the student's page per the reversal above), and its "My Activity / New Activity"
    breadcrumb line (would duplicate what the shell's own eyebrow+title header already shows on
    every other page in the app). Its Quill-based rich-text toolbar, initially skipped in favor of
    a hand-built editor, **was** adopted right after on explicit request — see `RichTextEditor.tsx`
    below. Its image-attachment/canvas-sketch-pad feature was *also* initially scoped out, then
    explicitly requested and built afterward — see "Attach image / Draw a sketch" below.
- **Data model**: `submissions/{id}` collection (`src/types/index.ts`'s `Submission` type,
  `src/lib/firestore/submissions.ts`). `status` is `draft | submitted | approved |
  revisionRequested | rejected`. `answers` is the *faculty's* checklist responses (see the reversal
  above — always `{}` from the student, meaningful only once the faculty-fill capability is built),
  keyed by `FormField.id`; `description` is the student's own rich-text write-up (raw HTML from
  `RichTextEditor`, see below). `firestore.rules`' `submissions` update rule currently still checks
  `request.resource.data.answers == resource.data.answers` on the faculty branch (i.e. still
  *blocks* faculty from writing it) — stale relative to the reversal above, needs flipping once
  `ReviewSubmissionPage.tsx` actually lets faculty fill the checklist. The student can edit
  `description`/`facultyId`/the tree selection while `draft` or `revisionRequested`; every other status is
  frozen for them. Two more student-editable fields were added on a later request ("select the date
  and the [attempt type]... first, repeat, remedial"): `activityDate` (ISO `'YYYY-MM-DD'`, the date
  the procedure was actually performed — distinct from `createdAt`/`submittedAt`, which are write
  timestamps — defaults to today, capped at today via the date input's `max` so it can't be
  future-dated) and `attemptType` (`AttemptType = 'first' | 'repeat' | 'remedial'`, `''` until
  chosen — deliberately not defaulted to `'first'`, since silently defaulting could mask a genuine
  repeat/remedial attempt; the student must pick explicitly). Named `attemptType` rather than
  reusing "log type" (the user's own phrase for it) specifically to avoid colliding with the
  already-established, unrelated meaning of "Log Type" elsewhere in this codebase (SSL vs SDL, on
  `LogTemplate`) — same field, different concept, needed a different name. Both fields live in
  `ActivitiesPage.tsx`'s existing Step 03 card ("Send to faculty") as two side-by-side inputs below
  the faculty `<select>`, rather than as their own numbered step — grouped there as "submission
  metadata," alongside who to send it to, rather than expanding the 01–04 step count. Both gate
  Step 04's `active` state and the Submit button the same way `facultyId` already did (Save draft
  stays low-friction and doesn't require them, matching the existing facultyId-optional-for-drafts
  behavior). Shown back on the "details" side: `MyActivityPage.tsx`'s and
  `ReviewSubmissionPage.tsx`'s detail views render both next to the status pill / student meta line
  (`ATTEMPT_LABELS` map + a small local `formatDate()`, duplicated in each file rather than shared —
  a two-line formatting helper, not worth a shared module). No `firestore.rules` change was needed
  — the student's update branch has no field-level allowlist beyond the `answers`/faculty
  constraints already documented above.
- **`RichTextEditor.tsx` (`src/components/`)** — wraps **React Quill**, specifically the
  `react-quill-new` package (not the original `react-quill`, which pins its peer dep to React
  ≤18 and relies on `findDOMNode`, removed entirely in React 19 — this app is on React 19).
  First pass was a dependency-free hand-built `contentEditable` + `document.execCommand` editor,
  matching this codebase's usual preference for hand-built UI over a new npm package; the user
  explicitly asked for React Quill specifically afterward, which is a deliberate, acknowledged
  exception to that preference, not a default to repeat elsewhere without being asked. Toolbar
  started minimal (size, bold/italic/underline, link, clean), then was deliberately expanded on a
  follow-up "more options/features" request to headers (H2/H3), strikethrough, text color +
  highlight, ordered/bullet lists, blockquote, and alignment — `TOOLBAR_MODULES` in the component
  lists exactly what's enabled; add a control there first if a future request wants still more, so
  the sanitizer allowlist (next) can be extended to match rather than silently stripping it. Editor
  body sized generously (`min-height: 260px`, grows with typing, caps at `max-height: 340px` then
  scrolls internally) after two rounds of "make it bigger" feedback — don't shrink it back down
  without checking first. Styled via a scoped `.usop-quill` block (ink toolbar, gold hover/active
  states) rather than Quill's default theme colors. Stores/returns raw HTML.
  **`src/lib/sanitizeHtml.ts`'s `sanitizeRichText()`** strips anything outside a tag/attribute
  allowlist before that HTML is written to Firestore *and* again before every
  `dangerouslySetInnerHTML` render (`MyActivityPage.tsx`, `ReviewSubmissionPage.tsx`) — defense in
  depth, since a submission's fields are writable straight through the Firestore SDK by whoever
  owns the doc, not only through this editor's own toolbar, so a stored-XSS payload in `description`
  could otherwise land in a faculty member's browser session. The allowlist was widened alongside
  the toolbar expansion above: `H2`/`H3`/`S`/`STRIKE`/`UL`/`OL`/`LI`/`BLOCKQUOTE` tags; an
  `inline style` attribute on any surviving element, but only ever kept if it matches a
  `color`/`background-color` (hex or `rgb()`) or `text-align` declaration — never let through
  wholesale, since Quill implements color/highlight/alignment as inline style rather than a class;
  `class` stays SPAN-only, restricted to a `ql-size-*`/`ql-align-*`/`ql-indent-*` pattern match
  (Quill's own size format is a class, not a `<font size>`). Whenever the toolbar in
  `RichTextEditor.tsx` grows again, this allowlist needs a matching update or the new formatting
  will just get silently stripped on save — check both files together.
- **Attach image / Draw a sketch (`RichTextEditor.tsx`)** — added on explicit follow-up request,
  reversing the earlier "file attachments out of scope this pass" scope call above. Deliberately
  **no Firebase Storage**: images are compressed client-side and kept as base64 `data:` URIs — but
  **not embedded inside `description`'s HTML**. First pass did insert them into the Quill document
  via `insertEmbed`; the user corrected this on sight ("don't show the images on the quill editor,
  show them in the preview bar") — attachments are now a wholly separate `Submission.images:
  string[]` field, rendered in their own "Attachments" gallery card (on My Activity / Review),
  never inline in the rich text. Went a step further on the very next request ("don't attach the
  [buttons] to the quill editor, make them separate and look aesthetic"): inside `RichTextEditor`
  itself, the Quill box (toolbar + editor) and the attachments UI are now two visually distinct
  cards, not one shared bordered container — the Quill box is exactly `<ReactQuill>` alone in its
  own `rounded-[10px] border` box, and everything attachment-related (the "Attach image"/"Draw a
  sketch" buttons, the thumbnail strip, the sketch pad) lives in a separate `rounded-[14px]` card
  below it (`mt-4` gap), gold-lined, with its own small header (a circular gold-tinted icon badge,
  "Attachments" title + subtitle, and an `n / MAX_IMAGES` counter on the right) — the same card-tint
  formula (`color-mix(... paper-raised 58%, paper 42%)`) used by every other card in the student
  panel. "Attach image" is now a solid gold pill (was outline) and "Draw a sketch" a gold-lined
  outline pill, both larger/friendlier than the original small ghost-style buttons.
  `RichTextEditor` takes `images`/`onImagesChange` as controlled props alongside `value`/`onChange`
  — same controlled pattern, just a second piece of state — and no longer touches the Quill editor
  instance at all for image insertion (the `quillRef`/`insertEmbed` plumbing from the first pass
  was removed outright, not left dead). `imageCount` is simply `images.length` now (no longer
  parsed out of HTML, since images don't live there anymore). Capped at `MAX_IMAGES = 5`; the file
  input and sketch-pad's "Add drawing" both disable once the cap is hit; each thumbnail in the
  strip carries its own × remove button. `compressImage()` downscales to `MAX_IMAGE_DIMENSION =
  900px` on the long edge and re-encodes as JPEG, stepping quality down from 0.72 (floor 0.3) while
  the resulting data URL exceeds `MAX_IMAGE_DATA_URL_LENGTH = 300_000` chars — keeps five images
  comfortably under Firestore's 1MB document cap. The sketch pad is a plain `<canvas>` with pointer
  events (works for mouse and touch/pen alike), pen color swatches (`PEN_COLORS`), S/M/L size
  buttons (`PEN_SIZES`), an eraser toggle, Clear, and "Add drawing" (`canvas.toDataURL('image/png')`,
  appended to `images` the same way as an uploaded photo). Reused the existing `upload`/`edit`
  icons rather than adding new ones. **Confirmed, not changed**: the 5-image cap (`MAX_IMAGES`) is
  shared across photos and drawings together, not 5 of each — a follow-up request explicitly asked
  for this, and it was already the built behavior (both paths append to the same `images` array).
  **Enlarged and given undo/redo + a full color picker** on a later request ("make the drawing
  canvas larger... add redo and undo... include the color picker tool where all the colors will be
  available"): canvas height went from `240` to `440`px. Undo/redo is a snapshot stack, not stroke
  replay — `history: { stack: string[], index: number }` holds full-canvas PNG data URLs (cheap at
  this canvas size); a snapshot is pushed on `pointerUp` (stroke completed) and on Clear, and
  opening the sketch pad resets the stack to a single blank-canvas snapshot after `sizeCanvas()`
  runs (canvas backing-store dimensions can change on open/resize, so old snapshots from a
  different size shouldn't be restorable across that boundary). `restoreSnapshot()` temporarily
  resets the canvas transform to draw the snapshot in raw pixel space, then restores the prior
  (DPR-scaled) transform for further drawing — `undo`/`redo` just move `history.index` and call it.
  New `undo`/`redo` icons added to the shared `IconName` union (`primary-admin/shell/Icon.tsx`),
  same pattern as always, sitting in their own toolbar row below the color/size row. The color
  picker is a native `<input type="color">` (opens the OS picker, so genuinely any color is
  reachable) styled as a small rainbow conic-gradient swatch button (the `<input>` itself is
  transparent and overlaid on top) — sits alongside, not instead of, the 5 quick `PEN_COLORS`
  swatches, which stay as one-tap shortcuts for the common case.
  **Thumbnail strip fixed and extended** on a follow-up bug report + two more requests ("the
  cancel cross button is cutting [off]... when we click them they need to show the preview...
  for the drawing before submitting provide the edit facility too"):
  - *Clipping bug*: each thumbnail's outer `div` used to carry `rounded-[10px] overflow-hidden`
    itself, with the × button positioned half outside it (`-top-1.5 -right-1.5`) — the parent's own
    `overflow-hidden` was clipping the corner of that badge. Fixed by moving `overflow-hidden` onto
    an *inner* element (a `<button>` wrapping just the `<img>`, for rounded corners), leaving the
    outer `div` un-clipped and padded (`p-1.5`) so the corner badges sit in that padding, fully
    visible, never cut off. Same root cause and fix pattern as the earlier Quill toolbar clipping
    bug (see `RichTextEditor.tsx`'s CSS comments above) — a scroll/clip container hiding content
    positioned at its own edge.
  - *Click-to-preview*: clicking a thumbnail (not its badges) now opens the same full-screen
    lightbox the read-only gallery uses. Extracted into a new shared **`src/components/
    ImageLightbox.tsx`** (`{ src, alt, onClose }`) so `RichTextEditor.tsx`'s in-progress attachment
    strip and `AttachmentGallery.tsx`'s read-only gallery render the exact same overlay instead of
    two hand-rolled copies — `AttachmentGallery.tsx` was refactored to use it too.
  - *Edit a drawing before submitting*: a sketch attachment now gets its own small gold "edit"
    badge (bottom-left corner, alongside the × at top-right) that reopens the sketch pad with that
    drawing loaded onto the canvas, so further strokes continue from it rather than starting blank.
    Distinguishing a drawing from an uploaded photo needed no new field: uploaded photos are always
    re-encoded JPEG (`compressImage`) and sketches are always saved PNG
    (`canvas.toDataURL('image/png')`) — that existing mime-type difference is a reliable `isDrawing
    (src)` check (`src.startsWith('data:image/png')`) on its own. `editingIndex: number | null`
    tracks which `images` entry is being edited; `addDrawing()` replaces that entry in place
    instead of appending when set, and the sketch pad's header/save-button labels flip to "Editing
    sketch"/"Save changes" while active. Opening a *fresh* sketch via the main "Draw a sketch"
    toggle always clears `editingIndex` first, so it can't accidentally overwrite a previous edit
    target.
  **Two more follow-up fixes on this same strip**:
  - *Lightbox clipping to the attachments card, not the viewport*: `ImageLightbox` is `position:
    fixed`, but the attachments card it was rendered inside carries the `.fade-up` entrance
    animation, which sets `transform` — any element with a `transform` (even only via a
    running/finished CSS animation) becomes the containing block for its `position: fixed`
    descendants per spec, so the "full-screen" overlay was actually centering and clipping to that
    card's box, not the real viewport. Fixed by having `ImageLightbox` render through
    `createPortal(..., document.body)` instead of in place — now true regardless of what animated/
    transformed ancestor it's opened from. Same fix applies to `AttachmentGallery.tsx`'s use of it.
  - *Photos and sketches shared one pool of 5*: a later request explicitly separated them — "the
    drawing sketch is different and the image upload is different." `MAX_IMAGES` (one shared cap)
    became `MAX_PER_KIND = 5` applied independently to each: `uploadedCount`/`drawingCount` (via
    `isDrawing()`) each get their own `remainingUploadSlots`/`remainingDrawingSlots`, their own
    limit flags (`atUploadLimit`/`atDrawLimit`) gating the "Attach image" input and the "Draw a
    sketch" toggle separately, and the header counter is now two badges ("Photos n/5" · "Sketches
    n/5") instead of one combined `n/5`. Total possible attachments on one submission therefore
    doubled from 5 to 10 — which meant the earlier per-image size budget no longer safely fit
    Firestore's 1MB document cap (5 images at the old `MAX_IMAGE_DATA_URL_LENGTH = 300_000` chars
    was already close to 1.4MB on its own), so that constant was tightened to `90_000` chars
    (~65KB decoded) so 10 attachments at the max size still comfortably fit. This wasn't asked for
    directly but follows directly from doubling the cap — flagged here so it isn't mistaken for an
    unrelated quality regression in uploaded photos.
  **Photos and sketches visually split** ("split the drawings with the image attachment[s]... in a
  beautiful aesthetic view") rather than one flat mixed row — a small `AttachmentGroup` (icon +
  uppercase label, "Photos" / "Sketch") wraps each kind's own thumbnails. The thumbnail markup
  itself was extracted into a module-scope `AttachmentThumb` (preview/remove/edit-if-a-drawing) so
  it isn't duplicated across groups. Grouping is derived, not stored: `indexed = images.map((src,
  i) => ({ src, i }))` is filtered by `isDrawing()` into `photoEntries`/`drawingEntries`, keeping
  each entry's original index into the single underlying `images` array so
  removeImage/setPreviewIndex/setEditingIndex still address the right element after the split.
  Refined on an immediate follow-up ("revamp this split view... only can draw one sketch") into
  two more changes:
  - *A true side-by-side split, not stacked*: when both photos and a sketch exist, they render as
    two columns (`grid grid-cols-2`) divided by a vertical hairline (`border-r`), not one group
    above the other — an actual split view. Either kind alone still just gets the full width
    (there's nothing to divide against). The old stacked-with-a-horizontal-divider layout and the
    `AttachmentGroup` `divider` prop that drove it were removed outright, not left dead.
  - *Sketches capped at exactly 1, not 5*: the shared `MAX_PER_KIND = 5` constant was split into
    `MAX_PHOTOS = 5` and `MAX_SKETCHES = 1` — a sketch is meant to be one running canvas you keep
    revising via its own "Edit drawing" badge (see above), not a small gallery of separate
    drawings, so once one exists the main "Draw a sketch" toggle disables (same `atDrawLimit`
    mechanism as the photo cap) and further edits go through that badge instead. Halving the
    maximum possible attachment count (5 photos + 1 sketch = 6, down from the previous 5+5=10)
    meant the per-image size budget could relax back up — `MAX_IMAGE_DATA_URL_LENGTH` went from
    `90_000` to `150_000` chars, since 6 attachments at that size still comfortably fit Firestore's
    1MB document cap.
  **Split-view columns weighted toward photos**: the two-column grid was an even `grid-cols-2`
  (50/50) at first; a follow-up request ("give more space to the images... than the drawing") 
  changed it to `gridTemplateColumns: 'minmax(0,2fr) minmax(0,1fr)'` — photos get roughly 2/3 of
  the row, the sketch column 1/3, matching that photos can hold up to 5 thumbnails while the
  sketch column only ever holds the one.
  **New shared `src/components/AttachmentGallery.tsx`** renders a submission's `images` on both
  `MyActivityPage.tsx` and `ReviewSubmissionPage.tsx` (a thumbnail grid, click-to-enlarge via
  `ImageLightbox.tsx` above) — built once in `src/components/` rather than duplicated per role,
  same reuse convention as `RichTextEditor.tsx` itself. Every entry is
  filtered through `isSafeImageDataUrl()` (exported from `sanitizeHtml.ts`) before ever reaching an
  `<img src>`, since `images` — like `description` — is writable straight through the Firestore
  SDK by whoever owns the submission, not only through the editor's own controls.
  `sanitizeHtml.ts`'s `ALLOWED_TAGS` does **not** include `IMG` (there's nothing for the rich-text
  sanitizer to allow — images never appear in that HTML); `isSafeImageDataUrl()` is the standalone
  check the gallery uses instead, restricted to
  `SAFE_IMAGE_SRC = /^data:image\/(png|jpe?g|gif|webp);base64,.../` — deliberately never a remote
  `http(s)` src, since that would let a hand-crafted `images` entry smuggle in a
  tracking-pixel-style remote image. **`firestore.indexes.json` gained a `fieldOverrides` entry
  excluding `submissions.images`** (alongside the pre-existing `description` override) from
  Firestore's automatic per-field indexing: every field is auto-indexed by default with a
  1,500-byte cap on indexed string values, and a ~200KB base64 image in that array would otherwise
  fail the write outright. This needs `firebase deploy --only firestore:indexes` to take effect on
  the live project — ask before running it, same as any other `firebase deploy`.
- **`firestore.rules` additions**: the `submissions` block (read: primary admin, the owning
  student, or the assigned faculty; create: the student themself only; update: split by who's
  writing, as above). Also widened `users/{uid}` read with one more branch —
  `isActive() && sameInstitution(...) && sameDepartment(resource.data.departmentId)` — so a student
  can read faculty profiles in their own department (the faculty picker) and a faculty member can
  read a submitting student's profile (the inbox); this is what finally put the long-unused
  `sameDepartment()` helper to work. Both new list queries (`submissions` by `studentId`/`facultyId`,
  `users` by `institutionId`+`departmentId`) filter on exactly the fields their rule branches read,
  so neither hits the list-query-filter-completeness gotcha.
- **`DopsChecklistPreview.tsx` grew a `mode` prop** (`'preview' | 'fill' | 'review'`, default
  `'preview'` — every existing admin call site is untouched) plus controlled `value`/`onChange`.
  Preview mode is exactly what it always was (local scratch state, admin previewing a checklist
  design). Fill/review modes are backed by the caller's own state instead. **Originally** fill/
  review only rendered the step-by-step checklist — the "Global Rating & Outcome" and "Feedback &
  Sign-off" sections were gated to preview-only, since at that point nothing in fill/review mode
  had real data for them (the checklist was still, at that point in the build, conceived as
  something the *student* would fill, before that was reversed — see above). **This was completed
  in the "Faculty review flow completion" pass below**: all three sections now render in every
  mode, and the feedback textarea / signature inputs / "Additional Fields" inputs — previously
  decorative and unwired even in preview — are now properly bound to `values`/`setFieldValue` (via
  `DopsOtherField` gaining `value`/`onChange`/`readOnly` props, and `RatingOptionPicker` gaining
  `readOnly`) so real answers actually persist and redisplay. `mode="review"` renders every input
  disabled/read-only, same as before.
- **New data-access functions**: `watchFacultyForDepartment()` in `users.ts`;
  `watchStudentVideos()`/`watchFacultyVideos()` in `videoTutorials.ts` (student is department +
  mbbsYear + `audience:'student'` scoped per spec; faculty is role-scoped only, no department/year
  filter, also per spec). Effective-FormSchema resolution (an institution's forked copy via
  `institutionCompetencyFormOverrides` ahead of the node's own global `formSchemaId`) is resolved
  inline on `ActivitiesPage.tsx` by combining two existing watchers, not a new lib function.
- **New icons** added to the shared `IconName` union in `primary-admin/shell/Icon.tsx` (same file,
  same pattern as always): `folder` (unused after the `TreeBrowser` deletion above, left in the
  icon set rather than pulled back out — same reasoning as any other currently-unused icon already
  in that union), `target`, `inbox`, `checkCircle`, `flag`, `link`.
- **Design system — explicitly follows Primary/Institution Admin's, not a separate identity**: an
  earlier pass gave Student/Faculty their own "Field Log"/"Review Bench" shape language (rail nav,
  soft rounded-14 cards, teal accent). The user redirected this — Student and Faculty should look
  and feel like the *same product* as the admin panels, not a different one. `StudentShell.tsx` is
  now structurally the same shell as `PrimaryAdminShell.tsx`/`InstitutionAdminShell.tsx`: ink
  sidebar, gold accent, chamfer brand mark, collapsible desktop rail + mobile drawer, topbar clock
  (own `localStorage` key `usop.student.sidebarCollapsed`). `FacultyShell.tsx` was brought in line
  the same way right after (own key `usop.faculty.sidebarCollapsed`, own nav items/kicker
  "Faculty") — both shells are now structurally identical to `PrimaryAdminShell.tsx`, same 272px/
  76px expanded/collapsed widths included. **Still pending** (not yet redone in this pass): each
  role's `shell/ui.tsx` primitives and individual pages beyond Student's New Activity flow and (as
  of a later pass — see "My Activity redesign" below) My Activity itself — Faculty's `Card`/
  `StatTile`-equivalents are still its own denser/flatter local kit, not yet re-pointed at
  `primary-admin/shell/ui.tsx` the way Student's was; Student's own Dashboard/Videos pages are also
  still on their prior styling. Don't take any of that as the intended final state — it's
  unfinished, not a deliberate difference.
  `student/shell/ui.tsx` re-exports `Card`/`StatTile`/`PrimaryButton`/`GhostButton`/`Badge`/
  `Skeleton`/`Modal`/`Field`/`inputClass` straight from `primary-admin/shell/ui.tsx` (added an
  optional `disabled` prop to that shared `GhostButton` while doing this, additive/backward
  compatible) rather than keeping a parallel styled kit; only genuinely new pieces (`StatusPill`,
  `statusRailColor`, `ProgressRing`) stay local. `VideoThumbnail`/`VideoPreviewModal` are imported
  straight from `primary-admin/shell/VideoShared` — but the admin `VideoCard` itself is *not*
  reused for Student/Faculty video browsing, since it unconditionally renders admin edit/delete
  controls a student or faculty viewer must never see; both roles get a small fresh read-only card
  built from `VideoThumbnail` instead.
- **My Activity redesign** (`StudentMyActivityPage`, `src/roles/student/MyActivityPage.tsx`) — a
  later pass, adapted from a second design reference the user pointed at,
  `attaching references/My Activity.dc.html` (same "borrow the structure, keep our own
  colors/fonts/tokens" treatment as every other `.dc.html` reference in this codebase). Replaced
  the page's old shape — a flat list of rows that navigated to a *separate full-page* detail view
  on click — with a month-grouped, **expand-in-place accordion**: clicking a row expands its review
  outcome, checklist, note, and attachments inline (only one entry open at a time, `openId` state),
  no navigation away. The reference's static "steps observed / competence / supervision /
  complexity" figures and a "self-rating" field don't correspond to anything in this app's data
  model (there's no student self-rating, and real per-step scoring already lives in the DOPS
  checklist itself) — deliberately dropped rather than faked, replaced with what actually exists:
  the checklist (`DopsChecklistPreview mode="review"`, unchanged), the attempt-type badge (`first`/
  `repeat`/`remedial`, see the Activity date/attempt type section above), and the real
  `facultyFeedback`/`facultyRemarks`/`facultyRating`/`competencyLevel` fields.
  - **Two new lazy, cached lookups**, since a `Submission` only stores `facultyId`/`templateId`,
    not the reviewer's display name or the log's title, both of which the entry row and expanded
    panel need: a `facultyNames: Record<string,string>` map (one-shot `getAppUser()` per distinct
    `facultyId` across the loaded submissions, same pattern `ReviewSubmissionPage.tsx` already uses
    for the student's own name) and a `templateTitles: Record<string,string>` map (`watchTemplate()`
    per distinct `templateId`, real-time like everything else in this app). Both effects key off
    `submissions` and check `!(id in cache)` before fetching, so they don't re-fetch on every
    snapshot tick, only for ids not yet resolved — same "one function, not duplicated per instance"
    economy `ActivitiesPage.tsx` already applies elsewhere.
  - **Month grouping**: entries are grouped and ordered by `activityDate` (falls back to an
    "Undated" bucket if somehow missing — shouldn't happen since `ActivitiesPage.tsx` always
    defaults it to today, but the field is still a plain string, not guaranteed), not by
    `createdAt`/`updatedAt` — grouping by when the activity was actually *performed* reads more
    naturally than when the Firestore doc happened to last change.
  - **Underlined filter tabs** replaced the old plain pill-filter row: a horizontal tab strip with
    a gold underline on the active tab and a live count per tab, mirroring the reference's tab bar
    but built from this app's own tokens, not copied styling.
  - **Summary numbers went through two rounds before landing on the admin panel's own "stat
    strip" pattern.** First pass used four bordered `StatTile`s (Activities logged / Approved /
    Awaiting review / Needs your action, the last folding `draft + revisionRequested + rejected`
    together since all three need the student to look at or act on something). A follow-up ("don't
    use the cards, make them show in the background merged") tried plain numerals with no border at
    all, floating directly on the page background. A second follow-up ("design those count number
    things... like [Primary Admin's] departments page, logs page") corrected this again to match a
    *specific existing pattern* rather than inventing a new one: `DepartmentsPage.tsx`'s and
    `LogTemplatesPage.tsx`'s own stat strip — one shared bordered container
    (`grid ... border rounded-[6px] overflow-hidden divide-x divide-y sm:divide-y-0`) with each
    stat as a `px-5 py-4` cell divided by hairlines, rather than either separate cards or fully
    unbounded numerals. **Landed on**: a local `SummaryStat` cell — `font-display text-[28px]
    leading-none tabular-nums` numeral (gold reserved for the one headline stat — here, "Needs your
    action" — char for the rest, the same "one accent, sparingly" rule those admin pages already
    follow) above a `text-[10.5px] uppercase tracking-[0.08em]` label, `useCountUp`-animated same
    as `StatTile` was — copied from those two pages' own inline cell markup (duplicated there too,
    not a shared component in this codebase, so duplicating it a third time here follows the
    existing convention rather than breaking it to introduce a new shared component).
  - **`StudentShell`'s `eyebrow`** now shows the student's own roll number + MBBS year (`{roll} ·
    Year {N}`) instead of a static "Track your submissions" string — a small real-data upgrade
    matching the reference's kicker line, falling back to the old static string only if
    `rollNumber` isn't set.
- **Faculty review flow completion** — a later pass closing the gap CLAUDE.md had flagged since the
  original student/faculty build: "faculty need to have the page... when they click a student they
  can see the activity... the faculty can approve, reject, and fill the DOPS form... prefilled with
  the student data." Three real gaps existed, not just a visual one:
  1. `ReviewSubmissionPage.tsx` rendered the checklist `mode="review"` — permanently read-only,
     showing the permanently-empty `answers` the reversal above had left behind. Faculty had no way
     to actually fill it.
  2. Even in `mode="fill"`, `DopsChecklistPreview` only rendered the step checklist — the Global
     Rating/Outcome and Feedback & Sign-off sections (the overall result, feedback text, and the two
     signature lines) were gated to preview-only and, in preview, weren't even wired to any state —
     see the `DopsChecklistPreview.tsx` entry above.
  3. `firestore.rules`' `submissions` update rule's faculty branch still had
     `request.resource.data.answers == resource.data.answers`, blocking the write outright even
     once the UI could produce one.
  **Fixed, in order**:
  - `firestore.rules`: that equality check was removed from the faculty branch (the `studentId`
    immutability check stays). Needs `firebase deploy --only firestore:rules` to take effect on the
    live project — ask before running it, same as every other `firebase deploy` in this project.
  - `DopsChecklistPreview.tsx`: the three previously preview-only sections now render in every mode
    (see that entry above for the wiring details).
  - `submissions.ts`: `facultyDecideSubmission()`'s `decision` param gained an optional `answers?:
    Record<string, FieldAnswerValue>`, spread into the same `updateDoc` call as the existing
    feedback/remarks/rating/competencyLevel fields — one write, not two.
  - `ReviewSubmissionPage.tsx` was rebuilt around this: the checklist sits behind a dashed-border
    **"Fill DOPS Form"** button while the submission is `'submitted'` (pending) — clicking it sets
    `fillOpen` and reveals `DopsChecklistPreview mode="fill"` bound to local `answers` state,
    seeded once from `submission.answers` on load (same hydrate-once pattern the feedback/remarks/
    rating/level fields already used). For an already-decided submission (`approved` /
    `revisionRequested` / `rejected`), `fillOpen` is set automatically and the checklist renders
    `mode="review"` — read-only, showing exactly what was recorded, with the decision panel below
    it disabled and a "this review was already sent" note instead of the action buttons.
  - **Auto-populated signatures**: the moment the form opens to fill, a one-time effect
    (`signaturesPrefilled` guard, so it never re-runs or clobbers an edit) fills the schema's two
    known signature fields — `student-ack` → the student's own name, `assessor-sign` → the
    signed-in faculty's own name (`useAuth()`'s `appUser.name`) — but only if those fields are
    still empty, so resuming a partially-filled form never overwrites something already typed.
    This is the "prefilled with the student name as signature, faculty signature... using your
    intelligence" ask, mapped onto the two real, already-established signature-field ids
    `parseDops()` recognizes — not invented new field ids that don't exist in the schema model.
    "Skill details and log details" being prefilled maps onto what the checklist header already
    displays: `DopsChecklistPreview` now also receives `department` (fetched via a new
    `watchTemplate()` call on the submission's `templateId`) and `code`/`setting`/`level`/`domains`
    straight from the loaded `FormSchema` — all of which existed on the schema already but weren't
    being passed through before this pass.
  - **Decision panel restructured**: was a `lg:sticky` 320px sidebar next to a constrained `1fr`
    main column; moved to a full-width card stacked below the checklist instead, because the
    checklist's own internal layout (a main column *plus its own* 300px live-score sidebar) needs
    real width to not feel cramped once it's actually doing work (interactive fill), not just
    showing a short read-only summary. The whole page now reads top-to-bottom — student summary →
    their note/attachments → the checklist → your decision — rather than two side-by-side columns.
  - **Student's "View checklist"**: `MyActivityPage.tsx`'s `EntryCard` no longer always renders the
    checklist inline — it's now a `checklistOpen` toggle button (only shown once
    `isReviewed`, since a pending/draft submission has nothing filled yet), matching the explicit
    "they can see the checklist... by clicking view checklist button" ask.
  - **Faculty shell/kit unification**: alongside this, `faculty/shell/ui.tsx` was re-pointed at
    `primary-admin/shell/ui.tsx` the same way `student/shell/ui.tsx` already was (see the Design
    system note earlier in this section, which had flagged Faculty's own kit as "still unfinished,
    not a deliberate difference") — `Card`/`StatTile`/`PrimaryButton`/`GhostButton`/`Badge`/
    `Skeleton`/`Modal`/`Field`/`inputClass` now come from the shared kit; only `StatusPill`/
    `statusRailColor` (genuinely `SubmissionStatus`-specific) stay local, and the local `StatCard`
    was dropped in favor of the shared `StatTile` (`Dashboard.tsx` updated accordingly). The shared
    `GhostButton`'s `tone` union gained `'gold'` (additive) to keep supporting Faculty's existing
    "Request revision" button styling. `InboxPage.tsx` was re-skinned to match (gold accent instead
    of teal, `elevated` cards, `fade-up` stagger) and renamed — both its page title and its
    `FacultyShell` nav label — from "Inbox" to **"Student Activities"**, matching the "page named
    like student activities page" ask; the route (`/faculty/inbox`) is unchanged.
  - **Bug fix, immediate follow-up**: the checklist's "Live score" sidebar (`position: sticky; top:
    0`, inside `DopsChecklistPreview`) wasn't sticking on either `ReviewSubmissionPage.tsx` or
    `MyActivityPage.tsx` — it just scrolled away with the page like a plain block. Root cause: a
    `position: sticky` element's containing block is its nearest ancestor with a scroll mechanism
    (`overflow` != `visible`) — including `overflow: hidden`, even on an element with no fixed
    height and nothing actually clipped. Both new embeddings wrapped `<DopsChecklistPreview>` in a
    `rounded-[10px] border overflow-hidden` div (for rounded corners) that was nearer in the
    ancestor chain than the shell's own scrolling `<main>` — so the sidebar was sticking relative to
    that tiny, non-scrolling wrapper instead, which has no room to stick within, and MyActivityPage's
    `EntryCard` had a *second*, outer `overflow-hidden` (on the whole accordion card, originally
    there to clip the toggle button's square corners to the card's rounded ones) compounding it.
    Fixed by dropping `overflow-hidden` from both — the original working case
    (`CompetencyEditorPage.tsx`'s preview modal) never had this problem because it wraps the
    component in its own `overflowY: 'auto'` div instead, which doesn't break sticky the way
    `hidden` does; here, once the blocking `overflow-hidden`s are gone, the shell's own `<main
    className="overflow-y-auto">` becomes the containing block instead, the same role that div
    played there. Checked for any lost corner-rounding from removing it: the accordion card's own
    background/border still self-clip to its own `border-radius` regardless (that's basic box
    rendering, not dependent on `overflow`), and no child in either component paints a full-bleed
    background that would've visibly poked out past the rounded corners — so this was a safe
    removal, not a trade-off.
  - **`ReviewSubmissionPage.tsx` composition redesigned**, adapted from a further design reference
    the user pointed at, `attaching references/DOPS Assessment.dc.html` (same adapt-not-copy
    treatment as every other `.dc.html` reference here). The reference showed the *whole* faculty
    review page as one continuous, unboxed page — a plain header (avatar ring, name, meta, status
    pill, no card), then "Description" and "Attachments" as hairline-divided label|content rows,
    then the checklist full-width with no extra frame around it. The page had been a stack of
    separately bordered `Card`s; rebuilt around a small local `Band` component (a 160px
    kicker+subtext label column beside a content column, `border-t` hairline above) reused for
    Description, Attachments, and — new — **Evaluation** (the feedback/remarks/rating/competency-
    level fields and the decision buttons, previously their own separate "Your evaluation" card, are
    now the last `Band`). The checklist itself lost its wrapping `rounded-[10px] border` box
    entirely — it now sits directly in the page flow, exactly matching the reference, since
    `DopsChecklistPreview` already renders its own header/section chrome and doesn't need a second
    frame around it. The student header lost its `Card` too, becoming a plain flex row with a
    `border-bottom` hairline instead of a bordered box. This is a pure layout/chrome change — none
    of the underlying state, the Fill DOPS Form gating, the prefill, or the decision logic described
    above changed.
  - **Checklist show/hide, both directions**: `fillOpen` used to be driven by an effect that forced
    it `true` the moment a submission wasn't `'submitted'`, with no way back — fine for auto-opening
    an already-decided review, but it meant faculty could never collapse a *pending* one back down
    after clicking "Fill DOPS Form" either, since nothing ever set it false again. Changed to an
    `openInitialized` guard: the effect now only sets `fillOpen`'s *initial* value once (open for an
    already-decided submission, closed for a pending one), and a real toggle button takes over after
    that — "Fill DOPS Form" (pending) / "View checklist" (already decided) to open it, "Hide
    checklist" (small gold text link above the form) to close it again, on both sides. Hiding never
    loses anything: the in-progress `answers` live in their own state, independent of whether the
    form is currently shown.
  - **`FacultyShell.tsx`'s collapsed (76px icon-only) sidebar tightened**, on the user pointing at
    the same `DOPS Assessment.dc.html` reference again — its own `<nav>` sidebar (which is always
    the narrow icon rail, no labelled/expanded state in that reference) uses a short, centered
    32px-ish hairline sitting right under the brand mark with tight `margin: 8px 0`, not a full-
    bleed divider with the more generous padding a labelled nav needs. Our shared shell has both
    states (collapsed and expanded, toggle-driven), so only the **collapsed** rendering changed to
    match: the brand block's bottom padding tightened (`pb-4`→`pb-3`), the `<nav>`'s own full-width
    `border-t` (was used in both states) is now conditional — collapsed gets a new short centered
    `h-px w-9` hairline directly below the brand block instead (no separate divider on `<nav>`
    itself, avoiding a doubled line), expanded keeps the original full-width `border-t` exactly as
    before. The footer divider (nav items → avatar/sign-out) was deliberately left alone — the
    reference has no line there either, but flagged as a possible further match, not done, since it
    wasn't the specific complaint and every other shell (`PrimaryAdminShell`/`InstitutionAdminShell`/
    `StudentShell`) shares that same footer-divider pattern; touching it here alone would be a new,
    unrequested inconsistency across roles. This change is scoped to `FacultyShell.tsx` only, per
    the user's explicit "for faculty" — the other three shells still use the original full-bleed
    divider in both states; ask before porting this same collapsed-state treatment to them.
- **Routes**: `/student`, `/student/activities` (also accepts `?submissionId=` to resume/edit an
  existing draft or revision-requested submission in place — no separate per-leaf route),
  `/student/my-activity`, `/student/videos`; `/faculty`, `/faculty/inbox`,
  `/faculty/inbox/:submissionId`, `/faculty/videos` — all in `AppRouter.tsx`, `RequireRole`-guarded
  same as every other role.

## Principal & HOD panels

Per the base build spec, `/principal` and `/hod` were bare Foundation-phase shells (plain `AppShell`
+ a raw-field `ScopeSummary` debug dump, no real pages) until this pass. Both now get the same
design treatment Student/Faculty did — own `*Shell.tsx` structurally identical to
`PrimaryAdminShell`/`FacultyShell` (272px/76px ink sidebar, gold accent, collapsed-rail hairline
tightened the same way `FacultyShell` was), own `shell/ui.tsx` re-exporting the admin kit rather
than a parallel one. `ScopeSummary.tsx` and the generic `AppShell.tsx` usage for these two roles are
gone — `AppShell.tsx` itself stays, since `TemplateDetailPage.tsx` still uses it.

- **Scope, from the build spec, not invented**: **Principal** is explicitly "read-only against
  operational data (logs, forms, reviews) — no write/approval actions... build it as a
  reporting/analytics-only interface," institution-wide. **HOD** gets "Full Faculty-level
  capabilities, plus department-wide scope" — same Fill DOPS Form / Approve / Request Revision /
  Reject flow Faculty has, except across every submission in their department, not just ones sent
  to them personally ("oversee all faculty reviews... within the department"). PDF export (spec's
  "Generate and export institutional/departmental performance reports as PDF") is **not built** —
  no export capability exists anywhere in this app yet; flagged here rather than faked.
- **Shared `SubmissionReviewPage`** (`src/components/SubmissionReviewPage.tsx`) — HOD's review page
  needed to be *identical* to Faculty's (same Fill DOPS Form, prefilled signatures, decision panel —
  see the Student & Faculty section above for the full history of that flow), since the spec frames
  HOD as a superset of Faculty, not a different reviewing experience. Rather than duplicating
  ~350 lines a second time, the whole page was extracted into one shared component taking
  `Shell: ComponentType<{eyebrow?, title, actions?, children}>` plus `backTo`/`backLabel` props —
  same "role-agnostic shared component" pattern CLAUDE.md already documents for
  `TemplateDetailPage`. `faculty/ReviewSubmissionPage.tsx` was rewritten down to a 9-line wrapper
  (`<SubmissionReviewPage Shell={FacultyShell} backTo="/faculty/inbox" .../>`);
  `hod/ReviewSubmissionPage.tsx` is the same shape pointed at `HodShell`. The component doesn't
  know or care which role is using it — `firestore.rules` is what actually authorizes a department-
  wide HOD write vs. a facultyId-scoped Faculty write, not anything in this component.
- **`StatusPill`/`statusRailColor` consolidated** (`src/components/StatusPill.tsx`) — these had been
  defined three times over as Student, then Faculty, then (now) HOD each needed the exact same
  `SubmissionStatus → label/tone/icon` mapping. Pulled out once a third copy would've been created;
  `student/shell/ui.tsx` and `faculty/shell/ui.tsx` now both just re-export from here instead of
  keeping their own copy (Faculty's old copy used direct hex-ish color/bg values instead of the
  tone-indirection table Student's used — same visible colors either way, now unified on Student's
  shape). `hod/shell/ui.tsx` and `principal/shell/ui.tsx` re-export the same thing.
- **New data-access functions**, filtering on exactly the fields the new rule branches below read
  (same list-query-filter-completeness discipline as everywhere else in this codebase):
  `watchDepartmentSubmissions(institutionId, departmentId, ...)` and
  `watchInstitutionSubmissions(institutionId, ...)` in `submissions.ts`; `watchDepartmentUsers
  (institutionId, departmentId, ...)` in `users.ts` (HOD's own department roster — students +
  faculty headcounts, and the name lookups Department Activities needs).
- **`firestore.rules` additions** — two new branches on `submissions`' `read` (HOD:
  `sameInstitution && sameDepartment`; Principal: `sameInstitution` only, and Principal gets no
  `update`/`delete` branch at all, enforcing the read-only spec requirement at the data layer, not
  just by omitting UI buttons) and one new `update` branch (HOD only, same department-scoped check,
  `studentId` still immutable) via a new `isHodForSubmission(data)` helper. Also widened `users/
  {uid}` read with a Principal branch (`sameInstitution` only, no department check) — the existing
  cross-department branch only covers reading *within* one's own department, which doesn't help a
  principal (who has no `departmentId` of their own) read students/faculty across every department
  for the dashboard's institution-wide headcounts. Needs `firebase deploy --only firestore:rules`
  to take effect on the live project — ask before running it, same as every other `firebase deploy`.
- **HOD pages** (`src/roles/hod/`): `Dashboard.tsx` (department headcounts, pending/approved-this-
  month stat tiles, a "Next up" pending list and a conditional "Needs attention" list for revision-
  requested/rejected items — mirrors Faculty's dashboard shape but department-wide instead of
  facultyId-scoped); `DepartmentActivitiesPage.tsx` (Faculty's `InboxPage` shape, but shows every
  department submission regardless of which faculty member it's assigned to, with the assigned
  faculty's name in the subtitle, plus a student/skill search box Faculty's inbox doesn't have);
  `ReviewSubmissionPage.tsx` (thin wrapper, see above); `VideosPage.tsx` (thin copy of Faculty's,
  reusing `watchFacultyVideos()` unchanged — HOD gets the same faculty-audience catalog since the
  `audience` tag is role-scoped, not uid-scoped).
- **Principal pages** (`src/roles/principal/`): `Dashboard.tsx` (institution-wide stat tiles —
  students, faculty+HOD headcount, awaiting-review count, approval rate — plus a per-department
  performance table: students/activities/approved/pending per department, derived client-side by
  grouping `watchInstitutionUsers`/`watchInstitutionSubmissions` by `departmentId`, departments
  resolved via the same `[...watchCatalogDepartments(), ...watchInstitutionDepartments()]` combine
  `ActivitiesPage.tsx` already uses); `ActivityPage.tsx` (institution-wide, read-only accordion
  browser — status tabs + a department `<select>` filter, expand-in-place to show feedback/
  checklist(`mode="review"`)/description/attachments, **no** Fill-DOPS-Form prompt and no decide
  buttons anywhere on the page, since Principal can't write to submissions at all).
- **Underlined filter tabs on Principal's `ActivityPage.tsx`** — status filters use the same gold-
  underline-on-active-tab treatment `MyActivityPage.tsx` established (merges into the page
  background rather than a bordered/filled pill row), per explicit direction to follow that pattern
  rather than reintroducing pills.
- **HOD grew two more tabs — Students and Faculty** (`HodStudentsPage.tsx`/`HodFacultyPage.tsx`).
  `HodShell`'s nav grew to Dashboard / Students / Faculty / Activities / Videos (`users`/`cap`
  icons for Students/Faculty, matching the icon convention `StatTile`s already use for headcounts
  elsewhere in this pass) — "Department Activities" shortened to just "Activities" in the nav
  label now that it's one of several tabs rather than the single activity-ish entry point. First
  pass was a plain card-grid roster with no cross-referenced data, deliberately kept minimal; a
  follow-up request ("show the students as [a] list how we are showing the users in the admin
  panel... a table with... registration id, activities count... and the email... add the sorting
  filter") replaced both with the **exact table-list treatment `PrimaryAdminUsersPage.tsx` uses**:
  a bordered container sitting directly on the page's own `--color-paper` background (not the
  white `--color-paper-raised` `Card`), a header row, and hover rows — copied structurally
  (avatar-circle + name/email stack, column widths, hover tint) rather than reinvented, per the
  explicit "like how we are showing the users in the admin panel" ask. Each table now also fetches
  `watchDepartmentSubmissions()` to compute a real per-person activity count client-side (grouped
  by `studentId`/`facultyId`) — Students show "`N` logged" (+ "`· M` pending" in gold if any are
  still awaiting review); Faculty show "`N` reviewed" (+ pending the same way). Both pages gained
  search + a sort `<select>` (Name A–Z/Z–A, plus Students: Year asc/desc and most/fewest
  activities; Faculty: most/fewest reviewed, most pending) — same `SORT_LABELS` record + plain
  `<select>` pattern `DepartmentsPage.tsx` already established, not a new control shape. Students
  additionally kept a year `<option>` filter alongside the sort, since year is a meaningful facet
  for a student roster the way it isn't for faculty.
- **HOD's Activities status filter rebuilt as a custom dropdown, not tabs** — a direct follow-up
  request ("the dropdown is more suitable and looking perfect") specifically for this page (left
  Principal's `ActivityPage.tsx` on the underlined-tab treatment above — not asked to change). Built
  as a local `StatusFilterDropdown` in `DepartmentActivitiesPage.tsx` rather than a native
  `<select>`, since a native select can't render a colored status dot per option; the trigger pill
  and popover panel both show each status's own color (via `statusRailColor()` — the same mapping
  `StatusPill` uses) next to its label and live count, closing on an outside click or a pick.
- **Principal grew a third tab — Institution Directory** (`DirectoryPage.tsx`, nav label
  "Directory") — a follow-up request ("the institution directory for the principal... all the
  users list across the institution just like how we are showing to the institution admin")
  asking for `InstitutionAdminUsersPage.tsx`'s exact table-list treatment, scoped institution-wide
  and made read-only. Structurally copied rather than reinvented: same bordered-on-paper table,
  same avatar+name/email/phone stack, same role-badge styling — the only real differences are (1)
  **no row actions and no `UserFormModal`** — Principal can't edit/pause/reject/create accounts,
  per the spec's read-only framing extending to account management too, not just operational data;
  and (2) a new **Activities** column, computed client-side from `watchInstitutionSubmissions()`
  grouped by `studentId` (shown as "`N` logged") or `facultyId` (shown as "`N` reviewed" — a HOD's
  own activity reads as reviewing, same as faculty) with a gold "`· M` pending" suffix when
  applicable, same convention HOD's Students/Faculty tables already established. Filters: search
  (name/email/phone), role, status, and — the explicit ask — a **department filter scoped to what's
  actually enabled for the institution**: `availableDepartments` filters the shared catalog down to
  departments *not* excluded via `institutionDepartmentOverrides` (`isEnabled(id) = override?.
  enabled ?? true`, the same "absence of an override means included" rule
  `institution-admin/DepartmentsPage.tsx` already uses) unioned with the institution's own
  exclusive departments (which have no override concept — always included) — so a department
  Primary Admin or the Institution Admin has switched off for this institution never shows up as a
  filterable option here, matching "the department list... that is added by the admin or the
  institution admin based on they selected or deselected." Plus a sort `<select>` (Name A–Z/Z–A,
  most/least activity), same plain-select sort pattern used throughout this pass.
- **Routes**: `/principal`, `/principal/directory`, `/principal/activity`; `/hod`,
  `/hod/students`, `/hod/faculty`, `/hod/activities`, `/hod/activities/:submissionId`,
  `/hod/videos` — all in `AppRouter.tsx`, `RequireRole`-guarded same as every other role.
  `RequireRole.tsx`'s `roleHomePath()` already mapped `principal`→`/principal` and `hod`→`/hod`
  from the original Foundation-phase scaffolding, so no change needed there.

## Resubmission-after-revision labeling

A gap surfaced by direct testing: once a student resubmits a `revisionRequested` activity,
`submitSubmission()` always set `status: 'submitted'` — correct for re-entering every existing
pending-queue filter/count unchanged, but it meant a resubmitted item looked *identical* to a
brand-new first-time submission to whoever reviews it next. The user's expectation: a reviewer
should keep seeing it labeled "Revision requested" — not plain "Submitted" — all the way until
they actually decide on it again, specifically so Faculty/HOD/Principal aren't confused into
thinking it's a fresh case. This is a **display-only** distinction, not a new review state: the
underlying `status` genuinely is `'submitted'` the whole time (so it's actionable, counted, and
query-visible exactly like any other pending item) — only the *label shown* changes.

- **`Submission.resubmittedAfterRevision: boolean`** (new field, `types/index.ts`) — true from the
  moment a student resubmits a submission that was `revisionRequested`, until the next decision.
  `createDraftSubmission()` sets it `false` at creation. `submitSubmission(id, wasRevisionRequested)`
  gained a required second parameter — the caller already has the pre-edit status in hand (it just
  loaded the doc to populate the resume form), so this is a plain boolean the caller computes,
  not an extra read inside the function. `facultyDecideSubmission()` always resets it to `false`
  as part of every decision (approve, reject, *or* request revision again) — whichever decision is
  made resolves the "just came back" state, so the cycle can repeat indefinitely: request revision
  → resubmit (flag true) → request revision again → resubmit (flag true) → ... → eventually
  approved (flag false, and now moot since status leaves 'submitted' entirely).
- **`ActivitiesPage.tsx`'s `handleSubmit()`** computes `wasRevisionRequested = existing?.status ===
  'revisionRequested'` *before* calling `saveDraft()`/`submitSubmission()` — reading the existing
  submission's status as it was when "Send for review" was clicked, not after any mutation.
- **`StatusPill` (`src/components/StatusPill.tsx`) gained an optional `resubmitted` prop**: while
  `status === 'submitted' && resubmitted`, it renders the exact same look
  `status === 'revisionRequested'` gets (clay, flag icon, "Revision requested" label) instead of
  the plain gold "Submitted" look — a pure rendering override, `statusRailColor()` and every
  counting/filtering function elsewhere are untouched and still key off the real `status` field.
- **Wired on the reviewer-facing surfaces only** — Faculty's `InboxPage.tsx`, HOD's `Dashboard.tsx`
  and `DepartmentActivitiesPage.tsx`, Principal's `ActivityPage.tsx`, and the shared
  `SubmissionReviewPage.tsx` (used by both Faculty and HOD to actually decide) all now pass
  `resubmitted={s.resubmittedAfterRevision}` into their `StatusPill`. **Deliberately not wired on
  the student's own `Dashboard.tsx`/`MyActivityPage.tsx`** — from the student's own point of view,
  once they've just resubmitted, seeing "Revision requested" again would read as "my fix didn't go
  through," the opposite confusion from the one being solved; they see the plain "Submitted" pill,
  confirming their resubmission landed back with the reviewer.
- Submissions created by `scripts/seedTestInstitution.mjs` before this field existed don't have it
  set — reads back as `undefined`, which is falsy, so they safely render as whatever their real
  `status` is with no special treatment (no backfill needed, same as any other boolean added to an
  existing collection in this codebase).

## Forms Management (Module 05 — faculty-initiated path)

A brand-new module, not previously started (CLAUDE.md's own "What this is" section had flagged
this entire phase as not-yet-built). Per the build spec's Module 5: "Independent of the log-review
flow — this is a second way for a Form to be created" — a faculty member picks a student directly
(no prior `Submission` involved at all) and fills out a standardized workplace-based-assessment
form themselves, as the record. Explicitly scoped to **Faculty only** this round (no HOD path,
unlike the Submission review flow where HOD got full faculty-level capability) — the user's own
words: "majorly these are for the faculty only."

- **Three real reference forms analyzed and transcribed**, not invented: `attaching references/
  CBD_Form.html`, `MINI_CEX_Form.html`, `OSCE_Form.html` — NMC CBME workplace-based-assessment
  forms the user supplied. `src/lib/facultyFormPresets.ts` transcribes each one's exact field
  structure into this app's existing `FormField[]` shape (same type DOPS checklists already use),
  with a few literal UI mechanics adapted rather than copied pixel-for-pixel (documented in that
  file's own header comment): every "DD/MM/YYYY" triplet becomes one `type: 'date'` field; the
  reference's "tick one box, click again to clear" single-choice checkbox groups become
  `type: 'dropdown'`; genuine multi-select groups (Areas Discussed / Clinical Task Observed /
  Checklist Compliance) stay `type: 'checkbox'`; a "Setting: ... Other: ___" combo flattens to a
  plain `'Other'` dropdown option instead of a nested free-text box; OSCE's live-recalculating
  station-marks-to-percentage totals aren't computed in the UI (plain number fields the faculty
  fills in themselves) — a print-sheet convenience, not data this app needs to derive.
- **`FormField` gained an optional `section?: string | null`** (`types/index.ts`) — these three
  forms have genuine section headers ("Student Details," "Performance Assessment," "Feedback," …)
  unlike DOPS's flat step-N id convention, so a new generic renderer groups fields by this property.
  Optional and ignored by `DopsChecklistPreview`'s own parsing, so every existing DOPS `FormSchema`
  is unaffected — this is purely additive.
- **New types, a new pair of collections — deliberately not reusing `FormSchema`/`Submission`**:
  `FacultyFormTemplate` (Primary-Admin-authored: `formType: 'CBD'|'MiniCEX'|'OSCE'`, `fields:
  FormField[]`, `enabledInstitutionIds: string[]`) and `FacultyForm` (one filled-and-sent instance:
  `formTemplateId`, denormalized `formType`/`title`, `institutionId`/`departmentId`, `facultyId`,
  `studentId`, `answers`). `enabledInstitutionIds` is a plain array *on the template doc itself*
  rather than a parallel per-institution override collection the way Department/LogTemplate toggles
  work (`institutionTemplateOverrides` etc.) — there's no "shared catalog vs. institution-exclusive"
  split to reconcile here, just a flat on/off per institution, so the simpler shape is enough.
  `FacultyForm` is one-shot by design: sending **is** creating the doc — no draft state, no edit-
  after-send, no decision/status transition (unlike `Submission`'s approve/reject/revision cycle),
  matching the explicit "these are for the faculty only" scope with nothing further requested.
- **`src/lib/firestore/facultyForms.ts`** — `watchAllFormTemplates` (Primary Admin, unfiltered),
  `watchActiveFormTemplates(institutionId, ...)` (Faculty's own institution, `array-contains`
  query — safe without an extra filter since `facultyFormTemplates`' read rule is plain
  `isActive()`, not `resource.data`-dependent), `watchFormTemplate`, `createFormTemplate`,
  `updateFormTemplate`, `deleteFormTemplate`; `watchFacultySentForms(facultyId, ...)`,
  `watchStudentForms(studentId, ...)`, `createFacultyForm`.
- **`firestore.rules` additions**: `facultyFormTemplates` read is `isActive()` (any active user —
  same "a form's title/structure isn't sensitive, and a cross-document scope check can't satisfy
  an array-contains list query anyway" reasoning `logTemplates`/`videoTutorials` already use),
  write is `isPrimaryAdmin()` only. `facultyForms` read is Primary Admin, the sending `facultyId`,
  or the receiving `studentId`; create is `isActive() && hasRole('faculty') && request.resource.
  data.facultyId == request.auth.uid` — no update/delete rule at all (default-deny), matching the
  one-shot-by-design data model. Both new list queries (sent history: `facultyId==uid`; Student's
  Forms section: `studentId==uid`) filter on exactly the field their branch reads. **Not yet
  deployed to the live project** — needs `firebase deploy --only firestore:rules`; ask before
  running it, same as every other `firebase deploy` in this project.
- **`StandardFormPreview`** (`src/components/formEngine/StandardFormPreview.tsx`) — a new generic
  renderer, deliberately *not* `DopsChecklistPreview`: that component's whole design is built
  around DOPS's specific id conventions (`step-N`/`remark-N`/`rating-`/`feedback`/`student-ack`/
  `assessor-sign`) and a Done/Not-done/N/A step checklist with a live-score sidebar — none of which
  applies here. `StandardFormPreview` just groups a flat `FormField[]` by `section` and renders the
  appropriate input per `FormFieldType` (dropdown → pill-button single-select matching this app's
  existing `RatingOptionPicker`/`StepResponseCell` visual language, not a native `<select>`;
  checkbox → a checklist of toggle rows; text/textarea/number/date/rating → the same plain inputs
  `DopsOtherField` already uses for "Additional Fields"). Two modes only — `'fill'` (controlled,
  `value`/`onChange`) and `'review'` (same layout, read-only) — no `'preview'` mode, since Primary
  Admin edits structure via the reused `FormSchemaEditor` (see below) rather than previewing a fill
  experience the way `CompetencyEditorPage` does for DOPS.
- **Primary Admin — new "Forms" page** (`/admin/forms`, nav added to the existing `'Content'` group
  alongside Log templates/Video tutorials) — card grid of templates (type badge, field count,
  enabled-college count), a "+ New form" modal that picks one of the three presets (`getPresetFields`)
  and a title, and a per-card checklist of every institution to toggle it on/off for (the first
  "pick multiple institutions" UI pattern in this codebase — nothing like it existed before, built
  as a plain scrollable checkbox list rather than a dedicated multi-select component, since this is
  the only place that needs one so far). **"Edit fields" reuses `FormSchemaEditor` as-is** — the
  same flat-FormField-list editor (label/type/options/required, add/remove field) already used for
  authoring a DOPS checklist's fields — rather than building a parallel field editor from scratch;
  it doesn't expose editing `section` directly, so a field added here lands in the renderer's
  "Additional Fields" fallback bucket unless the admin is comfortable leaving section-editing out of
  scope for this pass (flagged here, not silently glossed over). A new `'forms'` icon (a clipboard
  glyph, same 24×24/1.6-stroke/square-cap convention as every other icon in `Icon.tsx`) was added
  since nothing existing fit.
- **Faculty — new "Forms" page** (`/faculty/forms`, nav added between Student Activities and
  Videos) — a card per active template ("click to send"), opening a wide `Modal` with a student
  picker (scoped to the faculty's own department via the existing `watchDepartmentUsers()`, same
  function HOD's Students/Faculty tables use) and the `StandardFormPreview` in `'fill'` mode once a
  student is chosen, then "Send to student" calling `createFacultyForm()`. **Auto-populated identity
  fields** — the moment a student is picked, `student_name`/`roll_number`/`student_signature`
  (student's name) and `department` (resolved via the same `[...watchCatalogDepartments(),
  ...watchInstitutionDepartments()]` combine pattern used everywhere else department names are
  needed) fill in from the student's profile, and `faculty_name`/`faculty_signature` fill in from
  the signed-in faculty's own profile — same "auto-populated identity fields" idea the DOPS review
  flow's signature prefill already established, mapped onto the field ids these three presets
  actually use (`STUDENT_AUTOFILL_IDS`/`FACULTY_AUTOFILL_IDS` in `facultyFormPresets.ts`). Only
  fills fields still empty, so it never clobbers something already typed. A "Recently sent" list
  below shows the faculty's own send history (`watchFacultySentForms`) — not explicitly asked for,
  but a natural and expected part of a "send a form" flow (confirmation/history), low scope-creep
  risk.
- **Student — new "Forms" page** (`/student/forms`, nav added between My Activity and Videos) —
  same month-less expand-in-place accordion shape `MyActivityPage.tsx` established (one card per
  received form, click to expand), lazily fetching the template's `fields` only once a card is
  opened (`watchFormTemplate`) rather than for every form up front, then rendering
  `StandardFormPreview mode="review"` with the form's own `answers`.

### Forms Management — structural editor + Custom form type

A direct follow-up: `FormSchemaEditor` (reused for the Forms page in the initial build above) edits
a flat `FormField[]` with no concept of `section` at all — so CBD/Mini-CEX/OSCE's actual section
structure was effectively uneditable through it, and there was no way to author a form that wasn't
one of those three fixed presets. Two things fixed this directly, per the user's own framing
("the three forms are fixated we can't edit those forms and if we want to add a new form that's
not available too"):

- **`FacultyFormType` gained `'Custom'`** (`types/index.ts`) — picking it at creation starts from a
  blank canvas (`getPresetFields('Custom')` in `facultyFormPresets.ts` returns `[]`, deliberately
  not a faked starter section) rather than one of the three preset structures.
- **New `src/components/formEngine/SectionedFormEditor.tsx`** replaces `FormSchemaEditor` on the
  Primary Admin Forms page entirely (`FormSchemaEditor` itself is untouched — still used as-is for
  DOPS checklist authoring everywhere else). Sections are derived purely from the distinct
  `field.section` values currently present, in first-seen order — there's no separate "section"
  record, so a section only exists while it has at least one field; removing a section's last field
  removes the section itself (a deliberate simplification, not an oversight). Each section renders
  as its own gold-lined block: an editable title input (renaming it bulk-updates every field
  currently in that section), its fields (same label/type/options/required/remove row
  `FormSchemaEditor` already used, copied rather than shared since the two are structurally
  different editors now), an "+ Add field" link, and a remove-section control using this
  codebase's usual inline-confirm pattern (not a native `confirm()`). A text input + "+ Add
  section" button at the bottom creates a new section seeded with one blank field (a section can't
  be created genuinely empty, since nothing would anchor it in the flat `FormField[]` until a field
  exists) — the admin edits that field or adds more. This editor now applies uniformly to every
  template, so editing a CBD/Mini-CEX/OSCE template's structure (not just a Custom one) is fully
  possible through the same UI, closing the "can't edit those forms" gap directly.
- The "New form" modal's type `<select>` and its "Starts from…" hint text both special-case
  `'Custom'` (blank-canvas wording instead of naming a preset); no other part of the Forms page
  changed. No `firestore.rules`/data-model change was needed beyond the type union widening —
  `facultyFormTemplates`' existing `isPrimaryAdmin()`-only write rule already covers a `'Custom'`
  `formType` value the same as any other.

### Forms Management — dedicated editor page, matching the Competencies design

A direct follow-up to the structural-editor fix above: the modal-based `SectionedFormEditor` was
itself still cramped and visually inconsistent with the rest of the admin panel's content-editing
pages — explicit ask: "design it like how we design the competencies page... create an edit page
also for those." `SectionedFormEditor.tsx` was deleted outright (not left unused) and replaced with
a genuine full page, mirroring `PrimaryAdminCompetencyEditorPage.tsx` structurally rather than just
visually:

- **New `src/roles/primary-admin/FormEditorPage.tsx`**, route `/admin/forms/:templateId` — same
  `StepHeader` kicker pattern ("Step 01 — Identity," "Step 02 — Sections & Fields"), same bordered-
  on-`--color-paper` card treatment (not raised-white `Card`) via the same `BORDER` color-mix
  token, same lettered `SectionBox` blocks (A/B/C… circles, inline rename, a field count, a plain
  trash-icon remove — no inline-confirm on *sections* specifically, since removing one is easy to
  undo by just re-adding it, unlike removing the whole form), same `FieldCard` rows (up/down reorder
  arrows, label + type `<select>` + `RequiredToggle`, the same ledger-style `OptionsEditor` for
  dropdown/checkbox options, a max-rating input for rating fields), and the same Preview overlay
  chrome (dark backdrop, Esc-to-close pill) — just rendering `StandardFormPreview mode="review"`
  instead of `DopsChecklistPreview`, since these forms have no DOPS-specific full-screen/live-score
  sidebar to accommodate. `OptionsEditor`/`RequiredToggle`/`FieldCard`/`SectionBox` are local,
  duplicated rather than imported from `CompetencyEditorPage.tsx` (nothing there is exported for
  reuse, and the two editors' underlying data shapes differ enough — ordered `EditorSection[]` with
  a synthetic `key` decoupled from the display `name`, vs. that page's own `EditorSection`/
  `EditorQuestion` — that forking was lower-risk than trying to share) — same "small view helper,
  copied per page rather than extracted prematurely" convention already used elsewhere.
- **Identity step** now holds the form's type badge (read-only — changing type after creation isn't
  supported, since it would invalidate the structure already built), the title, and the enabled-
  colleges picker — moved here from the old per-card checkbox list on the catalog page, styled as
  pill toggles matching the Competencies editor's own "Domains assessed" control, not a scrolling
  checkbox list.
- **Local editor state loads once per template** via the same `loaded` guard
  `CompetencyEditorPage.tsx` uses (hydrate `title`/`enabledInstitutionIds`/`sections` from the first
  real snapshot, then stop re-hydrating on every subsequent tick) — so a background Firestore
  update mid-edit can't silently discard unsaved changes.
- **`PrimaryAdminFormsPage.tsx` (the catalog list) simplified to match** — same role
  `CompetenciesPage.tsx` plays for its own editor: a card grid that *links into* the dedicated
  editor rather than editing anything itself. Dropped the per-card institution checklist entirely
  (now lives in the editor's Identity step) and the old delete-with-no-confirmation button gained a
  proper inline Remove/Cancel confirm (this codebase's established pattern, never a native
  `confirm()`) — it had shipped without one in the very first pass, an oversight caught while
  rebuilding this page, not something the user flagged separately. Creating a form now navigates
  straight into its new editor page afterward, rather than staying on the list.
- No `firestore.rules`/data-model change was needed — this is purely a UI/editor rework on top of
  the same `facultyFormTemplates` read/write rules and `FacultyFormTemplate` shape from the
  sections above.

### Forms catalog — quick "Edit colleges" per card

A direct follow-up to the editor redesign above: the enabled-colleges picker had moved into the
dedicated editor's Identity step, so toggling a form on/off for a college now required opening the
full editor — the user wanted a faster path back on the catalog list itself, plus bulk controls.
`PrimaryAdminFormsPage.tsx` gained a second icon button per card (an `institutions` icon, next to
the existing delete control) opening a small `Modal` scoped to that one template: a scrollable
checkbox list of every institution (checked = enabled), a live "`N` of `M` enabled" count, and
**Select all** / **Deselect all** buttons that write the full `enabledInstitutionIds` array in one
`updateFormTemplate` call rather than toggling one at a time. Each row's own checkbox still writes
immediately on click too — there's no local draft/Save step here (unlike the Institution Admin
toggle pages' `SaveChangesBar` pattern), since a single template's enabled-list is a small, low-risk
write and the explicit ask was for a quick in-place toggle, not a staged review. The modal reads
`collegesTarget` live off the existing `watchAllFormTemplates()` list (looked up by id each render,
not a frozen copy captured on open) so its checkbox states always reflect the latest write even if
another admin session changes it while the modal is open. No `firestore.rules` change — same
`facultyFormTemplates` write rule (`isPrimaryAdmin()`) already covers this.

## Video Batches — scheduled per-cohort video grants

A new panel on the Primary Admin Video Tutorials page (`/admin/video-tutorials`), independent of
that page's shared catalog. The ask: club a hand-picked set of students (or faculty) together by
college/department/course, and grant that exact group one specific video for a scheduled start→end
window — access opens automatically at the start time and closes automatically at the end time,
with no admin action needed either side, and the batch record itself is never deleted when it
expires (it just stops granting access and shows an "Expired" status badge).

- **No stored status, no cron** — this project has no Cloud Functions/scheduler (see the Firebase
  section at the top of this file), so nothing can flip a field at the exact expiry instant.
  `videoBatchStatus(batch, now)` (`src/lib/firestore/videoBatches.ts`) derives `'scheduled' |
  'active' | 'expired'` purely from `startAt`/`endAt` vs. the current time, recomputed on every
  read — both on the admin panel's list (a 30s `setInterval` keeps status badges fresh without a
  manual refresh, same convention the shell topbar clock already uses) and on the student/faculty
  side (same 30s re-check, so a batch that just opened or closed appears/disappears within 30s with
  no page reload).
- **`VideoBatch` type** (`src/types/index.ts`): `videoId`, `title` (admin-facing label),
  `institutionId`, `departmentId`, `mbbsYear`, `audience: VideoAudience` ('student'|'faculty', same
  union `VideoTutorial` already uses), `memberIds: string[]` (the exact uids clubbed in — not a
  department/year query re-run live, so removing someone from the department later doesn't silently
  add/drop them from an already-created batch), `startAt`/`endAt` (epoch ms), `createdBy`,
  `createdAt`. Deliberately **not** reusing `VideoTutorial`/`institutionVideoOverrides` — a batch
  grants one specific video to one specific hand-picked list of people, independent of that video's
  own department/year/audience tags (the whole point is overriding normal catalog visibility for a
  cohort, not repeating it).
- **`src/lib/firestore/videoBatches.ts`**: `watchAllVideoBatches` (Primary Admin, unfiltered),
  `watchMyVideoBatches(uid, ...)` (`array-contains` on `memberIds`, used by Student/Faculty),
  `createVideoBatch`, `updateVideoBatch`, `deleteVideoBatch`, and `videoBatchStatus` itself.
  `videoTutorials.ts` gained `getVideoTutorial(id)` (one-shot `getDoc`) — a batch's `videoId` can
  point at a video outside the reader's own department/year, so the existing `watch*` query
  functions (which filter by department/year) can't resolve it; a plain get-by-id is unaffected by
  the list-query-filter-completeness gotcha (that only bites list/query reads), and
  `videoTutorials`' read rule is already a flat `isActive()` with no `resource.data` dependency, so
  no rules change was needed for this specific addition.
- **`firestore.rules` — new `videoBatches` block**: Primary Admin has full read/write; a member
  (`request.auth.uid in resource.data.memberIds`) can only read, never write. The one list query a
  member needs (`watchMyVideoBatches`) filters on `memberIds` via `array-contains` for their own
  uid — exactly the field/value the read rule's member branch checks — so it satisfies the
  list-query-filter-completeness gotcha the same way `submissions`' `studentId`/`facultyId`
  branches already do. No update/delete branch for members — expiry is purely computed client-side,
  nothing needs writing when a batch ends. **Needs `firebase deploy --only firestore:rules`** to
  take effect on the live project — not deployed yet as part of this change; ask before running it,
  same as every other `firebase deploy` in this project.
- **Primary Admin UI**: the Video Tutorials page gained a `Catalog | Batches` top-level tab (same
  ink-pill toggle style as the page's existing Student/Faculty audience toggle), with the page's
  `actions` slot switching between "By institution"/"New video" (Catalog) and "New batch" (Batches)
  depending on which tab is active. `VideoBatchesSection.tsx` (new file) owns the Batches tab:
  batches grouped into Active/Scheduled/Expired sections (status-colored `Badge`, same `teal`=
  active/`clay`=expired/`neutral`=scheduled convention used everywhere else in this panel), each
  card showing the granted video's title, college/department/year/audience badges, member count,
  and the start→end window, with the usual inline Remove/Cancel delete confirm.
- **Batch creation** (`BatchFormModal` inside the same file) is one `wide` `Modal`, not a dedicated
  page — closer in shape to `UserFormModal`'s "several fields, still just a creation form" than to
  the structural, many-sections editors that earned their own route (Competencies/Forms). Fields:
  batch name; a video picker (any video platform-wide, not filtered by the institution/department/
  year chosen below — those filters only narrow the *roster*, not which video can be sent);
  College → Department → Course/Year cascading selects (Department options follow the same
  shared-catalog-∪-institution-exclusive filter `ActivitiesPage.tsx`/others already use); a
  Student/Faculty audience toggle; a **Members** picker — once College/Department/Year/Audience are
  all chosen, candidates are computed by filtering the platform-wide user list
  (`role === audience && institutionId/departmentId match && active`, plus `mbbsYear` for students
  or `associatedMbbsYears` for faculty) client-side (Primary Admin already loads `watchUsers()`
  elsewhere; no new rules needed since Primary Admin's read branch isn't `resource.data`-scoped) —
  rendered with the same search + Select all/Deselect all + scrollable-checkbox-list treatment just
  built for the Forms catalog's "Edit colleges" modal; changing any of the four roster filters
  clears the current member selection, since the old picks almost certainly don't apply to the new
  roster. Two `datetime-local` inputs (Starts/Closes) cover both date and time in one control each,
  validated so Closes must be after Starts before the batch can be created.
- **Student/Faculty consumption** (`student/VideosPage.tsx`, `faculty/VideosPage.tsx`): both now
  also call `watchMyVideoBatches(uid, ...)`, keep only batches currently `'active'`, lazily resolve
  each one's video via `getVideoTutorial` (cached in local state so it's fetched once per distinct
  `videoId`), and merge those into the page's existing catalog grid — deduped against the catalog
  list by video id, so a video that's *also* independently in the normal catalog doesn't render
  twice. A batch-granted thumbnail gets a small gold "Batch · expires in Nh/Nd" corner badge
  (`formatBatchExpiry()`, duplicated in each file rather than shared — a one-line helper, same
  "small view helper, copied per page" convention used elsewhere) so it reads as temporary, distinct
  from the student/faculty's normal permanent catalog. Both pages extracted their per-video card
  markup into a small local `VideoGridItem` component to avoid duplicating it across the catalog and
  batch render passes.
- **New `clock` icon** added to the shared `IconName` union (`primary-admin/shell/Icon.tsx`), same
  24×24/1.6-stroke/square-cap convention as every other icon — used for the batch window display.
- **Bug fix, caught on direct testing**: the "Video to grant" picker originally listed every video
  platform-wide with no institution scoping at all — so a batch being built for one college could
  offer another college's exclusive videos, and the catalog-count the admin saw on the main Video
  Tutorials page (1) didn't match the picker's count (4). Fixed in two steps: (1) the field was
  moved below College/Department/Year/Audience and scoped to `audience === chosen && (global ||
  institutionId === this college)`, clearing the pick if it falls outside the new scope; (2) a
  second gap surfaced right after — the picker still ignored `institutionVideoOverrides`, so a
  *global* video this specific college had explicitly toggled **off** (via the Institution Admin's
  own Video Tutorials page or Primary Admin's per-institution Videos tab) still showed up here as
  grantable, which real students/faculty at that college would never actually see. Now fetches that
  college's own `watchInstitutionVideoOverrides(institutionId, ...)` the moment a college is picked
  and applies the same "absence of an override means included" rule `student/VideosPage.tsx`'s own
  `visible` filter already uses, so the batch picker's options now exactly match what that college's
  catalog page would show (global catalog minus anything toggled off, plus that college's own
  exclusive videos) — not a fresh, parallel notion of "available video."
- **Batch creation rebuilt as a full page, not a Modal** — direct follow-up asking for real
  thumbnail previews aligned with each video's title (a plain `<select>` can't render an image) and
  more room overall. `BatchFormModal` was deleted outright from `VideoBatchesSection.tsx` (which is
  now list-only — same "delete the superseded thing, don't leave it unused" convention this file
  already followed once for `SectionedFormEditor.tsx`); the whole flow moved to a new dedicated
  route, `src/roles/primary-admin/VideoBatchCreatePage.tsx` at
  `/admin/video-tutorials/batches/new`, structured exactly like `FormEditorPage.tsx`/
  `CompetencyEditorPage.tsx` (the same `StepHeader` kicker, bordered-on-`--color-paper` cards via
  the shared `BORDER` color-mix token, a `max-w-3xl` centered column, a "All batches" back link) —
  same "complex multi-field flow earns its own page" convention as those two editors, now extended
  to batch creation too. Four numbered steps: 01 batch name + College/Department/Year/Audience;
  02 the video pick — each option is now a full-width row (`VideoThumbnail` on the left, title +
  department/year + "this college's own" note on the right, a gold ring + check badge when
  selected) instead of a `<select>` option string, so the thumbnail and its text read as one
  aligned unit; 03 the same search + Select all/Deselect all + checkbox member picker as before;
  04 the Starts/Closes `datetime-local` pair. The page's own actions slot and a bottom action row
  both carry Cancel/Create buttons (mirroring the long-page-needs-the-button-at-both-ends pattern
  other editor pages already use). Canceling or finishing navigates back to
  `/admin/video-tutorials?tab=batches` — `VideoTutorialsPage.tsx` now reads a `tab` query param
  (`useSearchParams`) to seed its Catalog/Batches toggle's initial state, so returning from the
  create page lands back on Batches instead of resetting to the default Catalog tab, the same
  `?tab=videos` convention `InstitutionDetailPage.tsx` already uses for its own sub-tabs.
- **"Still showing after expiry" investigated and found to be a test-setup collision, not a batch
  bug** — a diagnostic script run directly against the live project (reading the one real batch,
  its video, and its member's profile) confirmed `videoBatchStatus()` was correctly computing
  `'expired'` once `endAt` passed; the video kept showing because it was *also* a normal catalog
  video (`department`/`mbbsYear`/`audience`/global `institutionId` all matching that exact student)
  — so they already saw it all the time via `student/VideosPage.tsx`'s ordinary `visible` list,
  completely independent of the batch. The batch mechanism never had anything to gate for that
  student/video pair; suppressing their normal catalog access to make the demo "work" would have
  been the actual bug (it would've wrongly hidden a video every other student in that department/
  year is still entitled to see). Fixed by surfacing this clearly instead of silently: once a video,
  college, department, year and audience are all picked on the batch creation page, an inline
  warning banner (clay-toned, below the video picker) appears whenever the selected video is
  already part of that exact department/year/audience's normal catalog, explaining that the
  schedule won't visibly gate anything for the chosen members and suggesting a different video or
  scope to actually test/use a temporary exclusive grant.
- **Root-caused further and fixed at the model level, per direct user suggestion**: rather than
  just warning when a picked catalog video collides with the target cohort's own department/year,
  the user asked whether batches should just carry their own uploaded/linked video directly instead
  of referencing the shared catalog at all — exactly right, and adopted. `VideoBatch` was reshaped:
  `videoId: string` is gone; the batch now owns `videoTitle`, `videoDescription`, `videoSource`,
  `videoUrl`, `videoStoragePath`, `videoThumbnailUrl`, `videoThumbnailStoragePath` directly (same
  field shape `VideoTutorial` itself uses, just embedded rather than referenced). This video is
  **never** a `videoTutorials` document — it can't be returned by `watchStudentVideos`/
  `watchFacultyVideos` no matter what department/year/audience it's tagged with, so the collision
  this whole investigation traced is now structurally impossible, not just flagged. The
  "already in catalog" warning banner and the whole existing-video picker/`institutionVideoOverrides`
  lookup were removed from `VideoBatchCreatePage.tsx` entirely — there's nothing left to collide with.
  - **`VideoPreviewable`** (`types/index.ts`) — a new `Pick<VideoTutorial, 'title' | 'description' |
    'department' | 'mbbsYear' | 'audience' | 'source' | 'url' | 'thumbnailUrl'>` type.
    `VideoThumbnail`/`VideoPreviewModal` (`shell/VideoShared.tsx`) now take this narrower type
    instead of a full `VideoTutorial` — a real `VideoTutorial` already satisfies it trivially
    (structural typing), and `videoBatches.ts`'s new `batchVideoView(batch, departmentName)` builds
    one of these on the fly from a batch's embedded fields, purely for display, without it ever
    being or needing a real catalog document. `departmentName` is resolved by the caller (both
    consumer pages already have the student's/a department list's name on hand) since `VideoBatch`
    only stores a `departmentId`.
  - **Step 02 of the create page** is now an upload/link form instead of a picker — same fields and
    mechanics as `VideoFormModal`'s own create flow (source toggle, `FileAttachControl`,
    `recognizedSourceLabel`, upload progress bar), reusing those exported helpers from
    `VideoShared.tsx` rather than re-implementing them. Create-then-patch two-step, same as
    `VideoFormModal`: the batch doc is created first (with `videoUrl: ''`/`videoStoragePath: null`
    for an upload), then the file uploads to `videoBatches/{batchId}/{fileName}` and the doc is
    patched with the real URL/path once that resolves. A live local preview (title + thumbnail +
    "Preview" button opening the real `VideoPreviewModal`) appears as soon as a title and either a
    link or a picked file exist — for an upload, it's a `URL.createObjectURL()` object-URL preview
    of the as-yet-unsaved file (revoked on change/unmount, same pattern `VideoFormModal` uses for its
    thumbnail picker), so `VideoThumbnail`'s own first-frame-capture logic works on it immediately,
    before anything's actually been uploaded.
  - **`storage.rules`** gained a `videoBatches/{batchId}/{fileName}` block, identical in shape and
    reasoning to the existing `videoTutorials/{videoId}/{fileName}` one (signed-in-only; real access
    control is the Firestore doc's own `isPrimaryAdmin()` write rule plus the UI only exposing batch
    creation to Primary Admin). **Not yet deployed** — needs `firebase storage:rules` deploy; ask
    before running it.
  - **`deleteVideoBatchAndFiles(batch)`** (new, `videoBatches.ts`) cleans up the batch's own Storage
    files before deleting the Firestore doc, same cleanup order `deleteVideoAndFiles()` uses for a
    catalog video — `VideoBatchesSection.tsx`'s delete button now calls this instead of the plain
    Firestore-only `deleteVideoBatch`.
  - `getVideoTutorial()` (added to `videoTutorials.ts` specifically to resolve a batch's `videoId`)
    was removed outright once nothing called it anymore, rather than left as unused dead code.
  - **One pre-existing test batch created under the old `videoId` schema was left in place** —
    deleting it was blocked by this environment's own auto-mode safety classifier (an
    "unverifiable deletion scope" denial on a script-driven Firestore delete), and intentionally
    not retried through a workaround. It will render with a blank title/placeholder thumbnail on
    the Batches list; use that card's own "Remove" button in the UI (a single, precisely-scoped
    delete, unaffected by the missing fields) to clear it.
- **Batches now carry multiple videos, not just one** — direct follow-up: the same cohort/schedule/
  member list usually applies to a small set of videos together, not just one. `VideoBatch.videos:
  BatchVideoItem[]` replaces the earlier singular `videoTitle`/`videoSource`/... fields.
  `BatchVideoItem` (`types/index.ts`) holds the same per-video shape (`id` — a client-generated
  `crypto.randomUUID()`, same convention `FormEditorPage.tsx`/`CompetencyEditorPage.tsx` already use
  for their own locally-keyed list items — `title`, `description`, `source`, `url`, `storagePath`,
  `thumbnailUrl`, `thumbnailStoragePath`), namespaced in Storage as
  `videoBatches/{batchId}/{videoItemId}/{fileName}` so each item's file can be removed independently.
  - `batchVideoView()` now takes `(batch, item, departmentName)` instead of just `(batch,
    departmentName)` — one call per video, not per batch.
  - `deleteVideoBatchAndFiles()` loops over `batch.videos`, cleaning up every item's Storage files
    before deleting the Firestore doc.
  - `VideoBatchCreatePage.tsx`'s Step 02 ("The videos," plural) is now a repeatable list of video
    drafts (`DraftVideoItem`, keyed by the same uuid that becomes the persisted item's `id`) — each
    with its own source toggle/file-or-link/title/description/live-preview, a trash-icon remove
    (hidden when it's the only one left), and a dashed "+ Add another video" row at the bottom.
    Submission creates the batch with placeholder `videos` entries, uploads every `source: 'upload'`
    item in parallel (`Promise.all`, each tracked in a `Record<itemKey, progress>` so every file
    shows its own progress bar), then patches the batch once with the fully-resolved array.
  - **Student/Faculty consumption**: `batchEntries` is now built with `flatMap` over
    `activeBatches × batch.videos` instead of one entry per batch — an active batch with 3 videos
    shows as 3 separate cards/tiles, each still carrying its own "Batch · expires in …" badge off
    the *batch's* shared `endAt` (the schedule is still batch-level, only the videos themselves are
    per-item). Render keys are `` `${batch.id}-${item.id}` `` so same-batch videos don't collide.
  - **Admin list** (`VideoBatchesSection.tsx`): each batch card now shows a horizontal strip of small
    thumbnails (one per video, each independently clickable to preview that specific video) instead
    of one thumbnail+title row, plus a "`N` videos" count line (naming the single video when there's
    only one, for parity with how a single-video batch used to read).
- **Custom thumbnail upload added per video** — each `DraftVideoItem` on the batch creation page
  gained `thumbnailFile`/`thumbnailPreviewUrl` (same object-URL-preview pattern as the video file
  itself), rendered as the same "small preview box + `FileAttachControl` + Remove thumbnail" field
  `VideoFormModal` already uses for catalog videos — independent of whether the video itself is an
  upload or a link, same as there. The live per-item preview (`draftPreview()`) now passes the
  chosen thumbnail through so it overrides the automatic one immediately, before anything's saved.
  On create, any item with a thumbnail file is included in the same parallel per-item Storage pass
  as video uploads (`itemsNeedingUpload` now matches `sourceType === 'upload' || thumbnailFile`,
  not just uploads) — the thumbnail always goes to a fixed `videoBatches/{batchId}/{videoItemId}/
  thumbnail` path (plain `uploadBytes`, no progress bar needed for an image-sized file), and both
  the video and thumbnail results for an item land in the same final `updateVideoBatch` patch.

## Video Batches — "not showing to students" root cause, and an Edit page

Two more follow-ups on the Video Batches feature (see all the sections above this one for its full
history): the just-granted video wasn't actually reaching students, and there was no way to edit a
batch once created (only delete-and-recreate via the "Remove" button).

- **Root cause of "not showing," found by reading the live data directly** (a one-off diagnostic
  script, signed in as Primary Admin, since the Chrome extension wasn't connected this session):
  an existing test batch's uploaded video had persisted with `url: ""` — the upload had silently
  failed — while its link-sourced sibling video in the same batch was completely fine. That pointed
  straight at Storage, not Firestore. The bug: when multi-video support was added, the upload path
  changed to `videoBatches/{batchId}/{videoItemId}/{fileName}` (three segments — one batch can hold
  several videos, each namespaced under its own item id), but `storage.rules`' matching block was
  never updated to match — it still only had `match /videoBatches/{batchId}/{fileName}` (two
  segments). Storage `match` wildcards are **never recursive**: a `{fileName}` segment captures
  exactly one path level, so a three-segment path silently never matched that rule at all, and every
  batch video/thumbnail upload was permission-denied. The batch *document* still got created fine
  (that's a separate, correctly-scoped Firestore write), which is why the batch existed with a
  broken, empty-url video instead of the whole creation failing loudly. Fixed by widening the match
  to `match /videoBatches/{batchId}/{videoItemId}/{fileName}`, then deployed via
  `firebase deploy --only storage`. The pre-existing broken test batch's video couldn't be repaired
  in place (the original File object is long gone from memory) — remove that one video item (or the
  whole batch) from the new Edit page and re-add it now that uploads actually work.
- **Separately, a likely admin-side mix-up worth flagging**: the same test batch's `startAt` had
  persisted as `23:32` (11:32 PM) rather than the `11:32 AM` the admin described intending, pushing
  the whole window to a different day than expected — almost certainly an AM/PM mis-click on the
  native `datetime-local` picker's segmented UI, not a code bug (the component just stores
  `e.target.value` as-is; there's no custom AM/PM handling to get wrong). Addressed by adding a
  plain-language "Opens {date, time}" / "Closes {date, time}" line directly under each Starts/
  Closes input on the batch form, so a misread AM/PM is visible immediately rather than only
  discovered after saving.
- **Edit added, not just Create** — the batch form page (`VideoBatchCreatePage.tsx`) now serves
  both `/admin/video-tutorials/batches/new` and a new
  `/admin/video-tutorials/batches/:batchId/edit` route, one component branching on whether
  `useParams().batchId` is present (`isEditing`) — same "one form, driven by whether a target
  already exists" convention `VideoFormModal` already uses for the regular catalog, just as a full
  page here instead of a Modal.
  - `videoBatches.ts` gained `watchVideoBatch(batchId, onChange)` (real-time single-doc watch, same
    convention every other admin editor page uses — `watchFormTemplate`, etc.) and
    `deleteVideoItemFiles(video)` (Storage cleanup for one video item, factored out of
    `deleteVideoBatchAndFiles` so a single item removed *during an edit* can be cleaned up the same
    way a whole deleted batch's videos are).
  - Existing data hydrates into local state exactly once (the `loaded` guard, same pattern
    `CompetencyEditorPage.tsx`/`FormEditorPage.tsx` use), so a background snapshot update mid-edit
    never clobbers unsaved changes. A `skipResetRef` absorbs the one expected member-list "reset"
    the existing college/department/year/audience-change effect would otherwise fire the moment
    hydration sets those fields for the first time — without it, the just-loaded `memberIds` would
    be wiped out by that same safety-net effect on the very next render.
  - **An existing video's underlying file/link is immutable in place** — same restriction
    `VideoFormModal`'s own edit mode applies ("to change the video itself, delete this and add a new
    one"): only its title, description, and thumbnail stay editable, plus a *link* item's URL
    itself (no Storage involved, so safe to edit directly). To swap an uploaded file, remove that
    video item and add a fresh one. `DraftVideoItem` gained `existingVideo: BatchVideoItem | null`
    (null for any brand-new item, whether creating a batch or adding one more video to an existing
    one) and `thumbnailRemoved: boolean`; removing an existing video item queues its Storage files
    for cleanup in `removedExistingVideos`, settled on save.
  - The create/edit save paths were unified into one `buildBaseVideo()`/upload pass rather than two
    parallel implementations — an existing item's `key` always equals its persisted
    `BatchVideoItem.id`, so the same "which items need a Storage round-trip" filter
    (`(!existingVideo && sourceType === 'upload') || thumbnailFile`) and the same key-matching
    afterward work identically whether the batch is brand new or already existed.
  - `VideoBatchesSection.tsx`'s list cards gained an **Edit** button (next to the existing
    inline-confirm delete) navigating to that batch's edit route.
- **The "Batch" expiry label wasn't actually blue by design — it was riding the platform's own
  color theme**, which is exactly what caused it to look wrong. It used `backgroundColor:
  'var(--color-gold)'` as a solid chip over the thumbnail, same token every other gold accent in
  this app uses — but `--color-gold` isn't a fixed brass color; it's redefined per theme by Primary
  Admin's Platform Configuration (`src/index.css`'s theme blocks), and one of the selectable themes
  resolves it to a blue (`#2e5fa3`). A colored chip reading "Batch · Expires in 3h" in whatever
  shade the platform's active theme happens to use read as a loud, out-of-place label rather than
  quiet metadata. Fixed on both `student/VideosPage.tsx` and `faculty/VideosPage.tsx`: the colored
  overlay chip is gone entirely, replaced with a small `clock` icon + plain text caption
  ("Expires in 3h"/"Expires in 2d"/"Expires soon") sitting under the video's title, in the same
  muted `--color-char-soft` every other secondary caption in this app already uses — same treatment
  the admin Batches list's own schedule line already has, just extended to the student/faculty side.

## Students are bound by year — departments are derived, never assigned

A student has **no department field**. Their departments are every department enabled for their
college in their MBBS year, derived live by `lib/enabledDepartments.ts`
(`enabledDepartmentsForYear()` / `useStudentDepartments()`): shared-catalog departments plus the
college's own, minus anything switched off in `institutionDepartmentOverrides` (absent override =
on — the toggle Primary Admin sets on the institution page and Institution Admin sets on
Departments, for catalog *and* own departments). Because it's derived, switching a department off
removes it from every student of that year immediately — nothing to re-save. Faculty and HOD keep
their single `departmentId`, unchanged.

- **Admin user form** (`UserFormModal.tsx`): for a student the admin picks only college + year; the
  form shows the resulting departments as read-only badges. The faculty/HOD department picker also
  hides departments switched off for that college.
- **Activities** (`student/ActivitiesPage.tsx`): Step 01 picks one of those departments for this
  activity; that choice drives the SSL log/skill tree, the faculty picker
  (`watchFacultyForDepartment`) and the `Submission.departmentId` stamped on save. Faculty then
  fill the DOPS form and decide as before (`SubmissionReviewPage`). A resumed draft resolves its
  department against *all* college departments, so one switched off later still loads.
- **HOD isolation** comes for free: `isHodForSubmission` compares the HOD's `departmentId` with the
  submission's own `departmentId`, so an Anatomy HOD never sees that student's Dermatology activity.
- **Rosters** (`watchDepartmentUsers`): a department's students = the college's students in that
  department's own year (watches the department doc for its year, then queries
  `institutionId + role=='student' + mbbsYear`), merged with its faculty/HOD. Every HOD page and
  Faculty's Forms page call it unchanged.
- **Rules** (`users/{uid}` read): `studentReadsCollegeStaff` lets a student read faculty/HOD
  profiles in their own college; `staffSeesStudentYear` lets faculty (via `associatedMbbsYears`) or
  an HOD (via their department's year, one `get()`) read students of that year. Both are matched
  by the query filters above, so the list-query-filter-completeness rule holds.
- **Elsewhere**: My Portfolio and Videos loop over the derived departments; Principal's dashboard
  counts a student toward every enabled department of their year; user lists show "All Year N" for
  a student instead of a department name.

## Skill Lab Director & certificates

New platform-wide role `skillLabDirector` (`institutionId: null`, like Primary Admin; created from
`/admin/users`). Primary Admin authors, per department, which SSL skills count toward a certificate
(`certificateSkillPresets`, keyed `institutionId` ('' = catalog) + department name + year) on
`/admin/certificates`. On `/student/portfolio` a skill counts once faculty has **approved** at least
one submission against it; when all are done the student requests a certificate. A request
(`certificateRequests`, id `${studentId}_${departmentId}` — one per student per department) needs
**both** Skill Lab Director and Primary Admin approval; its status is derived
(`certificateRequestStatus()`), never stored. A rejection lets the student request again, which
resets both decisions. Both approvers share `CertificateRequestsList` / `CertificateRequestReviewPage`
(`src/components/`). The issued certificate is an on-screen card only — no PDF export yet.

## Video Tutorials — department reach & enable/disable

- **Reach**: `VideoTutorial.department` is a `Department.name` or `''` (`ALL_DEPARTMENTS`) = every
  department. The video form (`VideoFormModal`) asks Audience → Departments (All / Specific) → MBBS
  year (students only — faculty videos aren't year-scoped) and shows a plain "who will see this"
  line. Students: `watchStudentVideos` queries `department in ['', name]` per derived department.
  Faculty/HOD: `watchFacultyVideos(institutionId, departmentName)` keeps all-department videos plus
  their own department's (`videoReachesDepartment`).
- **Enable/disable**: `VideoTutorial.active` — the author's publish switch (Primary Admin for
  catalog videos, the college for its own). Read via `isVideoActive()` (`active !== false`).
  Disabled videos are dropped inside both watch functions, show a clay "Disabled" badge in admin
  lists, and disabled catalog videos are hidden from the college's include/exclude list. This is
  separate from `institutionVideoOverrides` (a college's include/exclude of a catalog video).
  Primary Admin catalog page: toggle on every card + a status filter; the college's own videos
  tab: same toggle (immediate write); its catalog tab: the include/exclude switch only, with no
  edit/delete (the rules never allowed a college to edit a global video).
- **Full-page editor, not a modal**: `VideoFormModal` was deleted (it overflowed the viewport).
  `src/components/VideoEditorPage.tsx` is the shared create/edit page (Shell-parametrized, same
  pattern as `SubmissionReviewPage`), laid out like the batch page: Step 01 The video, Step 02 Who
  it's for (radio-card All/Specific department; student department options filtered to the chosen
  year and to departments enabled for that college), Step 03 Visibility, plus a sticky right-hand
  live preview card + "Who will see it" line. Routes: `/admin/video-tutorials/new`,
  `/admin/video-tutorials/:videoId/edit`, `/admin/institutions/:institutionId/videos/new|:videoId/edit`,
  `/institution-admin/video-tutorials/new|:videoId/edit`. A linked video's URL is editable; an
  uploaded file isn't (delete and re-add).
- **Batches got the same All / Specific department choice**: `VideoBatch.departmentId === ''`
  means every department. Step 01 order is College → Year → Audience → Departments (radio cards +
  a department select for "Specific"; the select lists only departments enabled for that college,
  and for students only that year's). Member candidates: students = the college's students of that
  year either way (students are year-bound); faculty = all of the college's faculty for that year,
  or only that department's. Consumers already render `''` as "All departments" via
  `videoScopeLabel`; the Batches list badge does the same.
- **Certificate Management page redesign** (after `attaching references/Certificate Management -
  Admin.dc.html`): intro + "Awaiting you"/"Presets set" headline numbers, underlined display-font
  tabs — **Requests first** (default), Skill presets second (`?tab=presets`). The shared
  `CertificateRequestsList` (also Skill Lab Director's Requests page) is now a table: ink-filled
  status filter buttons with counts, student/college search, columns Student · College · Department
  · Requested · Approvals (`SLD · …` / `ADMIN · …` chips) · Status. Presets tab: year segmented
  filter + department search, one card per department doc (big gold skill count, `Not set` /
  `Global` / `Global + N colleges` / college-name badge). The editor is a portal overlay: catalog
  departments get a Global / College-specific scope toggle (college picker, "inherits global"
  note, "Use global instead" deletes the override via `deleteCertificateSkillPreset`); presets are
  only created on Save now (no more empty docs on open). `watchCertificateSkillPreset` treats an
  empty college preset as no override. Skill Lab Director can read `institutions` (rules) for
  college names.
  - **Restyled again to match the rest of the admin panel** (user: make it like Departments / Log
    Templates / Competencies): no headline numbers in the header — each tab opens with the
    Departments-style hairline stat strip (Requests: Awaiting you / Pending / Issued / Rejected;
    Presets: Presets set / Departments / Not set yet / College overrides). Requests table now uses
    the Log Templates table treatment (paper ground, flex columns, display-font names, gold-ring
    monogram, outline decision pills, `SegGroup` status filter). Presets tab: Log-Templates
    search + `SegGroup` year filter + Departments grid/list toggle, grouped under "Year N" badges;
    cards copy `CompetencyCard` (monogram ring, meta line, `ChecklistBadge`-style "N skills
    required" pill), rows copy `DepartmentListRow`.
- **Skill Lab Director + student certificate pages redesigned** (after `attaching references/
  Certificate Management - Skill Lab Director.dc.html` / `... - Student.dc.html`):
  - SLD dashboard: greeting title, four chamfered stat tiles ("Pending my decision" in ink = SLD
    side pending and admin not rejected; Issued; Rejected; Total) deep-linking to
    `/skill-lab-director/requests?filter=…` (the shared list reads `?filter=`), then an
    oldest-first "Next up" list.
  - Shared `CertificateRequestReviewPage` (both approvers): identity header (ink avatar, request
    code, roll · college, status/department/requested on the right), "Required skills" with
    evidence per skill (the student's first faculty-approved submission in that department →
    "Approved by <faculty> · ACT-xxxxx" + date), a Decisions timeline, and a "Your decision"
    panel (remarks, Reject / Approve). Stays on the page after deciding (toast) instead of
    navigating back. Needs the SLD `submissions` read rule (added).
  - Approver names are now saved on the request with each decision (`skillLabDirectorName` /
    `primaryAdminName`) so the student's certificate can show them — students can't read admin
    profiles. `certificateNumber(req)` derives a stable `USOP-C-<year>-NNNN` from the request id.
  - Student My Portfolio: per-department card — progress ring + state kicker, required skills with
    first-approval dates, a state band (not set up / locked / ready / in review / rejected with
    remarks + Request again / issued), and a formal certificate document (fixed paper/gold tones,
    double frame, seal, both signatures, number) behind "View certificate". PDF download is shown
    disabled ("Soon").
- **Preset editor skills now match what that college's students actually see**: the skill list is
  resolved like `ActivitiesPage.tsx` — every global SSL log for the department + year, plus (for a
  college-specific preset, or a college's own department) that college's own SSL logs for it,
  minus skills switched off for the college in `institutionCompetencyOverrides` (a leaf counts only
  if it and every ancestor is on). Grouped by log with a "Global log" / "College log" tag and a
  per-log selected count; a note says how many skills are hidden as switched off. Each saved
  skill keeps its own `templateId`. The global preset view lists global logs only.
  - **Revised on direct request**: a college-specific preset lists ONLY that college's own SSL logs
    for the department (minus its switched-off skills) — no global logs mixed in; the global
    preset lists only global logs. The college picker opens on a college that already has a
    preset and marks those with "● … — has its own preset"; a teal status line shows the saved
    preset (skill count, last saved) vs. a gold "no college preset yet" line. No more seeding a
    college draft from the global preset.
  - **Preset editor is now a full page** (`CertificatePresetEditorPage.tsx`, route
    `/admin/certificates/presets/:departmentId`, `?college=<id>` for a college preset) — the overlay
    was removed. Step 01 "Whose preset" (catalog departments only): Global card vs College-specific
    with a searchable college list showing "Own preset · N" / "Uses global" (colleges with a preset
    sorted first). Step 02 "Required skills": search, "Only selected", Select all / Clear, one
    bordered section per log with a log-level tri-state checkbox and a two-column skill grid. Sticky
    right summary: big selected count, scope, unsaved-changes dot, removable list of chosen skills,
    Save / Discard / "Remove college preset — use global instead". Stays on the page after saving
    (toast). Preset cards on Certificate Management navigate here.
  - **Reversed again on direct request — a college preset now mirrors the student's SSL logs**:
    the college view lists the global SSL logs for the department + the college's own SSL logs
    (each tagged "Global log" / "College log"), minus skills the college switched off, so the
    admin can require any mix of global and college skills. A college with no preset yet starts
    with the global preset's skills pre-ticked (Save is enabled straight away). Each saved
    required skill also stores `templateTitle`, and the student's My Portfolio shows the log name
    under every skill (older presets without it look the template up via `watchTemplate`); the
    approvers' review page shows it next to the skill too.
- **Certificate PDF download (students)**: My Portfolio's "Download PDF" (issued certificates)
  captures the on-screen `CertificateDocument` with `html2canvas-pro` and saves a single-page A4
  PDF via `jspdf` — `src/lib/certificatePdf.ts` (`downloadElementAsPdf`, `certificateFileName` →
  `USOP-Certificate-<Dept>-Year-N-<roll>.pdf`). Both are **dynamically imported**, so they're
  separate lazy chunks, not in the main bundle. These are a deliberate, user-requested exception
  to the no-new-npm-deps habit (a real file download isn't feasible hand-built);
  `html2canvas-pro` rather than `html2canvas` because the latter can't parse modern colour
  functions. The capture lays the clone out at desktop width (`windowWidth: 1280`, 860px wide) and
  strips the fade-up animation/shadow, so phones get the full-size certificate too. If the
  certificate isn't open, clicking Download opens it first, then captures.
- **Skill Lab Director manages skill presets too** (same full feature set as Primary Admin):
  `/skill-lab-director/presets` (nav "Skill presets") renders the exported `PresetsTab` from
  `CertificateManagementPage.tsx` (now takes `editorBasePath`), and
  `/skill-lab-director/presets/:departmentId` the shared editor. The editor moved to
  `src/components/CertificatePresetEditorPage.tsx` (Shell + `backTo` props);
  `primary-admin/CertificatePresetEditorPage.tsx` is a thin wrapper. Rules: Skill Lab Director
  can write `certificateSkillPresets`, and read all `departments`, every college's
  institution-scope `logTemplates` (`canReadTemplateData`) and `institutionCompetencyOverrides`
  — all role-only branches, so the existing list queries still pass.
- **College filter on Skill presets** (`PresetsTab`, both roles): a "All colleges" / college
  `<select>` beside search. With a college picked, the list shows that college's departments
  (catalog ones not switched off in its `institutionDepartmentOverrides` + its own), each card
  shows the preset its students actually follow ("<College> preset" or "Uses the global preset"
  with the effective skill count), the stat strip switches to that college's numbers, and clicking
  a catalog department opens the editor straight on `?college=<id>`. "Clear filters" resets
  college/search/year. Skill Lab Director can now read `institutionDepartmentOverrides` (rules).
  - (A compact switch + dropdown version of Step 01 was tried and reverted on request — keep the
    Global / College-specific cards + searchable college list.)

## Voice typing (speech-to-text)

`src/lib/useSpeechToText.ts` wraps the browser Web Speech API (`SpeechRecognition` /
`webkitSpeechRecognition` — Chrome, Edge, Safari; no npm dependency, nothing stored or sent by us),
continuous + interim results, `en-IN` by default, auto-restarts after the browser's pause timeout
until the user stops, and only one dictation runs per page. `appendDictation(prev, text)` joins
phrases with a space and capitalises a new sentence. `src/components/VoiceInputButton.tsx` is the
round mic button (pulses red while listening, shows the live words / permission errors in a bubble
above it; renders nothing in unsupported browsers like Firefox; `onMouseDown` preventDefault keeps
the field's cursor). Wired into: the student's New Activity description (`RichTextEditor` — inserts
at the Quill cursor via a ref), the Faculty/HOD review page's Feedback + Remarks
(`SubmissionReviewPage`, only while pending), and the DOPS form's Faculty Feedback + per-step
Remark boxes (`DopsChecklistPreview`, not in read-only mode). Add it to any new free-text field by
wrapping the input in `relative` and placing `<VoiceInputButton className="absolute right-2
bottom-2" onText={(t) => setX((p) => appendDictation(p, t))} />`.
- **Batch Members step — bulk selection by register number** (`BatchMemberPicker.tsx`, used by
  `VideoBatchCreatePage.tsx`): three tabs over one selection — *Pick from list* (sorted by
  register number, search, "Show selected only", Select shown / Clear all), *Paste register
  numbers* (any separators; matches register no. or email ignoring case/spaces, or just the
  trailing digits when unique in the cohort; reports matched / not found / ambiguous; Add to or
  Replace selection), and *Register range* (full numbers compared naturally, or trailing-digit
  range like 101–150). After a paste/range action it flips to the list with "Show selected only"
  on so the result can be reviewed.

## Student activity export (PDF)

My Activity's **Export activities** button (`student/ExportActivities.tsx`) opens a small dialog —
include *Approved only* (default) or *Everything sent* (drafts never), and All departments or one
— then renders `student/ActivityExportDocument.tsx` into a hidden portal (`data-pdf-root`) and
saves it via `downloadPagesAsPdf()` (`lib/certificatePdf.ts`, same lazy `html2canvas-pro` +
`jspdf` as the certificate). Layout: fixed 794px A4 pages with fixed print colours (theme-proof):
a cover page (college masthead, student details incl. register no., summary strip, contents
table with page numbers — continued on extra pages past 12 rows), then **exactly one page per
activity** in date order (skill, log, department, category path, status, activity date, attempt
type, submitted/reviewed dates, the reviewer + role, competency/rating, feedback/remarks, the
rich-text description, photos grid, the sketch, typed name sign-off lines). A page taller than A4
is scaled down to fit, never split. **Who decided** is now saved on every decision —
`Submission.reviewedById/reviewedByName/reviewedByRole` ('faculty' | 'hod', written by
`SubmissionReviewPage`) — so an HOD approval prints as "Head of Department" with "Originally
sent to <faculty>"; older submissions without it fall back to the assigned faculty.

## Demo activity seed (`scripts/seedDemoActivities.mjs`)

Fills several students of one college (default Kasuburu, 6 students spread across years) with
10–20 SSL activities each, rotated over their departments, against real skills (global + college
SSL logs, minus switched-off skills, with the effective DOPS form). Mix of approved (filled DOPS
answers, feedback, rating, level; ~25% decided by the HOD → `reviewedByRole: 'hod'`), revision
requested, resubmitted, rejected, awaiting review and drafts; attempt type follows each student's
history (repeat / remedial after a rejection). Attachments come from `scripts/lib/demoImages.mjs`
— a dependency-free rasteriser + PNG encoder that draws labelled hand-drawn sketches (PNG, the
app's sketch-pad colours) and clinical-style photos (converted to JPEG with macOS `sips`), plus
the repo's interface screenshots as occasional photos. Creates a faculty/HOD (`fac1@kl.com`,
`hod1@kl.com`, password 123456) for any department missing one. Every doc carries
`seedTag: 'demo-activities'`; `--reset` replaces only those. Run `--plan` first.

## Activity images live in Firebase Storage (supersedes the inline base64 notes above)

Everything above that describes `Submission.images` as base64 data URLs, `compressImage`,
`MAX_IMAGE_DATA_URL_LENGTH`, `isDrawing()` by PNG prefix or `isSafeImageDataUrl` is **historical**.
Now (`src/lib/submissionImages.ts`):
- `Submission.images: SubmissionImage[]` — `{ id, kind: 'photo' | 'sketch', url, path }`. Files are
  at `submissions/{studentId}/{submissionId}/{imageId}.jpg|png`; the doc only holds these entries.
  Every read goes through `toSubmission()` in `lib/firestore/submissions.ts` →
  `normalizeSubmissionImages()`, which still accepts old base64 strings (legacy, read-only).
- Editing (`RichTextEditor`): images are `DraftImage`s (local Blob + object-URL preview, or an
  already-stored entry). Photos → `compressPhoto()` (1600px, JPEG, ≤ ~900 KB); sketches →
  `canvas.toBlob('image/png')`. A redrawn sketch becomes a new image (new id). Re-editing a saved
  sketch loads it via `imageObjectUrl()` (Storage `getBlob`, same-origin) so the canvas isn't tainted.
- Saving (`ActivitiesPage.saveDraft`): id is pre-generated (`newSubmissionId()`, and
  `createDraftSubmission(input, id)` uses `setDoc`) → upload new images → write the doc → only then
  delete files the student removed/replaced; on failure, delete what this attempt uploaded.
  `deleteDraftSubmission(submission)` deletes the doc, then its files.
- Display: `AttachmentGallery` takes `SubmissionImage[]`, lazy-loads, and only renders URLs passing
  `isSafeImageUrl()` (this project's bucket on firebasestorage.googleapis.com, or a legacy data URL).
- PDF export: `ExportActivities` downloads each image once via `imageAsDataUrl()` (downscaled,
  6 at a time) and passes data URLs into `ActivityExportDocument` — the capture never loads a
  remote URL.
- `storage.rules`: `submissions/{studentId}/{submissionId}/{fileName}` — read when signed in;
  create/update/delete only by that student; images only (jpeg/png/webp), < 4 MB. Browser
  `getBlob` needs the bucket CORS from `cors.json`.
- Video Storage fixes in the same pass: `VideoEditorPage` and `VideoBatchCreatePage` now delete
  removed files/thumbnails only *after* the doc is saved without them, and roll back a newly
  created video/batch (doc + uploaded files) if its upload fails, instead of leaving an
  empty-link entry behind.

## Activity export is rendered with @react-pdf/renderer (supersedes the html2canvas notes above)

The "Student activity export (PDF)" section above describes the first version (html2canvas
screenshots of hidden HTML pages + jspdf, `ActivityExportDocument.tsx`, `downloadPagesAsPdf`) —
all of that is **gone**. Now (`src/roles/student/activityPdf/`):
- `ActivityRecordPdf.tsx` — the document in react-pdf primitives: real vector text (selectable,
  searchable), cover page (college, student details, summary, contents rows that are clickable
  internal links `#act-N`), then one `<Page>` per activity that **flows onto further pages**
  when long (running header with "Activity NN of MM" + footer "Page X of Y" are `fixed`), never
  shrunk. Every activity is a PDF bookmark. `renderActivityRecordPdf(props)` → Blob; pass the
  `<Document>` element itself to `pdf()` (`ActivityRecordDocument(props)`), not a wrapper
  component. Keep this file free of browser-only APIs — the caller sanitises the description.
- `htmlToPdf.tsx` — converts the sanitised Quill HTML (p, h2/h3, nested ul/ol, blockquote,
  bold/italic/underline/strike, links, colour/highlight, ql-size/ql-align) to react-pdf nodes;
  `decodeEntities()` fixes titles saved as "&amp;".
- `pdfFonts.ts` — **Inter** (400–800 + italics) from `@fontsource/inter` `.woff` files via Vite
  `?url` (self-hosted). IBM Plex Mono is NOT used: its .woff fails to parse in fontkit and its
  .woff2 rendered no glyphs.
- **Clinical design** (redesign on request — "clinical colours"): palette `C` in
  `ActivityRecordPdf.tsx` — navy `#0E2A47` headings, clinical teal `#0F766E` accent, aqua tints
  (`#E6F4F2`/`#F3FAF9`), sky `#0369A1` for department chips, standard status colours (green
  approved / amber awaiting / orange revision / red rejected) as dot-pills. Cover: navy→teal
  gradient band (react-pdf `Svg` `LinearGradient`) with an ECG polyline motif and a medical-cross
  emblem, student card with initials avatar, four summary tiles with coloured top bars, zebra
  contents table. Activity pages: gradient hairline + running header, title card with a
  status-coloured left edge, aqua fact tiles, "Clinical review" card (reviewer initials,
  competency letter badge O/A/P/I, 5-dot global rating, feedback/remarks notes), "Clinical
  photographs" as Fig. 1…n, "Student's sketch", Logged by / Verified by sign-off. The app's own
  gold/ink theme is deliberately not used in this PDF.
- react-pdf gotchas hit here: a `fixed` element anchored with `bottom` never rendered (footer is
  pinned with `top: 800`); large text needs an explicit `lineHeight` (an inherited one is
  resolved from the 9.5pt body and overlaps); keep headings with what follows by putting them in
  the same `wrap={false}` View as the first row (`minPresenceAhead` alone didn't hold).
- `ExportActivities.tsx` — dialog (Approved only / Everything sent, department, optional
  From–To activity dates), downloads images via `imageAsDataUrl()`, sanitises descriptions,
  lazy-imports the PDF module (its own ~1.2 MB chunk, loaded only on export) and saves the Blob.
- The certificate download (`MyPortfolioPage`) still uses `html2canvas-pro` + `jspdf`
  (`downloadElementAsPdf`); jspdf has open security advisories (`npm audit`) — move the
  certificate to react-pdf too, or upgrade jspdf.

- **One page per activity (typical case)**: sized so a normal activity (title, facts, review
  with feedback + remarks, a ~5-step description, up to 5 photos + the sketch) fits one A4
  page. Photos and the sketch share ONE row (photos ~⅔, sketch ~⅓; with 4–5 photos the split is
  2.4 : 1). All photos sit side by side in that row: stacking 4–5 in two rows made them tiny
  (found by a stress test with 5 photos, a sketch and a ~1,000-word description). List items
  are `wrap={false}`, so a number is never left at the bottom of one page with its text on the next. Signatures were briefly removed to make room and then **restored on
  request**: a compact "Logged by <student> / Verified by <reviewer>" row (italic name over a
  teal signature line, role + review date below) closes every activity — keep it. Space was won
  back elsewhere (`ROW_H = 100`, tighter section/card padding). Only an unusually long description
  continues onto a second page (by design; it is never shrunk). Re-check with a real render if
  you add anything to the activity page — there is only ~40pt of slack.

### Quick summary export (second format)

The Export dialog has a **Format** choice: *Full record* (`ActivityRecordPdf.tsx`, one page per
activity) or *Quick summary* (`ActivitySummaryPdf.tsx`) — the whole logbook at a glance, **no
descriptions or images** (and the dialog skips image downloads, so it's fast). **A4 portrait** (switched
from landscape on request), in **three sections, each its own `<Page>`** (so each starts on a fresh page with its own running
header naming the section, and its own bookmark):
- **01 Overview**: gradient band, title with clickable section chips (`Link src="#skills"`), six
  KPI tiles in a 3 × 2 grid, a full-width "By department" card (logged / approved / pending /
  action / skills / approval bar), then three small cards in a row: "Status mix" (stacked bar +
  legend), "Competency" (I/P/A/O over approved activities) and "Attempts".
- **02 Skills by department**: one group per department (heading with counts + approval bar),
  skill rows with the log name as a sub-line.
- **03 Activity log**: grouped by month, numbered continuously. To fit portrait width, the
  department sits under the skill name and the reviewer's role under their name. Rows show only
  the day and month ("04 Jan"), because the month heading carries the year.

`GroupedTable` glues each group heading to its first row (`wrap={false}`), and its column header
is `fixed`, so it repeats on every continuation page. This was restructured on request: the
earlier version was one flowing page whose tables split across pages without their section
titles.
Shared palette/labels/building blocks live in `pdfTheme.tsx` (both PDFs import it). File name:
`USOP-Activity-Summary-<roll>-….pdf`.

## Year promotion (Year N → Year N+1)

Students are bound by year, so moving up a year changes which departments, skills, faculty and
HOD apply to them. **Activities never change**: every `Submission` keeps the `mbbsYear` it was
logged in, so Year N work stays with Year N reviewers and in the student's Year N history.

- **Promote students page** (`src/components/PromoteStudentsPage.tsx`, Shell-parametrised like
  `SubmissionReviewPage`): `/institution-admin/promote-students` (locked to the admin's college) and
  `/admin/promote-students` (Primary Admin picks a college). Step 01 picks the move (Year 1→2,
  2→3, 3→4; Year 4 doesn't move). Step 02 lists that year's students, all ticked; untick anyone
  repeating the year (later roster changes never re-tick them). Step 03 shows unfinished Year N
  work for the chosen students (waiting / revision / drafts), which is informational only, and
  then an inline confirm. "Recent promotions" lists batches with **Undo**.
- **Data**: `promoteStudents()` / `undoPromotion()` in `lib/firestore/users.ts` (batched writes,
  450 per batch). Each student gets a `YearChange` (`batchId, from, to, at, byId, byName`) appended
  to `AppUser.yearHistory`. Undo moves back only students whose *latest* change is that batch and
  who are still in its `to` year, and removes that entry. No approval step: Principal is
  read-only per the spec, and admins already hold the exam results. The users write rule already
  allowed both admins; no rules change was needed for the promotion itself.
- **Why reviewers needed a fallback**: profile reads for staff are year-scoped
  (`staffSeesStudentYear`), so a promoted student's profile is unreadable to their old Year N
  faculty and HOD. Fixes:
  - `Submission.studentName` / `studentRollNumber` are copied on every student save.
    `scripts/backfillSubmissionStudentNames.mjs` fills in older activities.
  - `getAppUserOrNull()` returns null instead of throwing. Before this, `SubmissionReviewPage`
    stayed on "Loading…" forever, and one failed lookup in Faculty's inbox blocked every name.
  - `lib/submissionStudent.ts` gives the profile first, then the copied name.
  - HOD Students page has a **Past students** list, derived from the department's activities by
    students no longer in its roster.
- **Student side**:
  - `ActivitiesPage` resumes an activity in the activity's **own** year (`existing.mbbsYear`), so a
    Year 1 revision still loads Year 1 departments and skills; it shows a "This is a Year 1
    activity" note. New activities use the current year.
  - My Activity has a year switcher (shown only once there are 2+ years; opens on the current
    year).
  - My Portfolio shows the current year, then a "Year N · completed" section per earlier year
    (from `yearHistory` and the activities). Presets and certificate requests use
    `department.mbbsYear`, not the student's current year.
  - Export has a Year choice. The PDF prints the exported year, and each Full-record activity
    page shows "Activity date · Year N".
- **Rules**: `submissions` read gained a read-only Institution Admin branch (same institution), so
  the Promote page can count unfinished work. Until it's deployed the page says it couldn't check,
  and promoting still works.
- Built on git branch `year-promotion`; the pre-feature code is tagged `v1-before-promotion`.

## Resources (study material: PDF, Word, PowerPoint, Excel, images)

A file library on the same publishing model as Video Tutorials.

- **Data**: `resources/{id}` (`Resource` in `types/index.ts`, `lib/firestore/resources.ts`).
  - Scope: `institutionId` is `''` for the catalog (every college) or a college id (that college only).
  - `department` is `''` for all departments, otherwise one department name.
  - `mbbsYear` is `0` for all years, else 1–4. Faculty resources are always `0`.
  - Also carries `audience` (student / faculty), `active` (the author's publish switch, read via
    `isResourceActive`), and the file fields (`kind`, `fileName`, `contentType`, `size`, `url`,
    `storagePath`).
  - `institutionResourceOverrides/{inst}_{resId}` is a college's include/exclude switch for a catalog
    resource (absent = included), same as `institutionVideoOverrides`.
- **Files**: Storage `resources/{id}/{timestamp}-{name}`.
  - Uploaded with an explicit `contentType` derived from the extension (`resourceFileType`),
    because browsers sometimes leave `file.type` empty for Office files.
  - Accepted: pdf, doc/docx, ppt/pptx, xls/xlsx, png/jpg/webp, max 50 MB, enforced both in the
    editor and in `storage.rules`.
  - The id is pre-generated: upload first, then write the doc, so the doc never points at a
    missing file.
  - Replacing a file uploads the new one, updates the doc, then deletes the old file. Delete
    removes the doc, then the file.
- **Pages** (all shared components in `src/components/resources/`; per-role wrappers are in
  `rolePages.tsx`):
  - `ResourcesManagePage`:
    - Primary Admin (`/admin/resources`) sees everything, with a college filter, publish switch,
      edit, and delete with inline confirm.
    - Institution Admin (`/institution-admin/resources`) gets an **Our college** tab (full
      management) and a **Catalog** tab (include/exclude switches staged behind
      `SaveChangesBar`).
  - `ResourceEditorPage` (`…/resources/new`, `…/resources/:resourceId/edit`):
    - Step 01 is the file (the title is pre-filled from the file name).
    - Step 02 is who it's for: Primary Admin chooses All colleges / One college, then audience,
      year (incl. All years), and All departments / one department.
    - Step 03 is visibility.
    - A sticky live preview shows the result. An Institution Admin can't open another college's
      resource there.
  - `ResourceLibraryPage` (`/student/resources`, `/faculty/resources`, `/hod/resources`):
    - Students see catalog + own-college student resources for their year or all years, in their
      derived departments.
    - Faculty and HOD see faculty resources for all departments or their own.
    - Catalog items the college switched off are hidden.
    - Grouped "General" first, then by department. Type chips, search, a "New" badge (14 days),
      Open (PDF/images preview in a new tab) and Download (`getBlob`, keeps the original file
      name; falls back to opening the URL).
- **Rules**: `resources` read is `isActive()`; create/update/delete is Primary Admin or the
  college's own admin. The overrides rules are the same as video overrides. Storage restricts size
  and type. **Both `firestore.rules` and `storage.rules` need deploying.**
- Icon `resources` was added to `Icon.tsx`. Every role's sidebar has a Resources link.

## Mobile number + OTP login

`src/auth/LoginPage.tsx` has two tabs: **Email & password** and **Mobile & OTP** (+91 only).
Phone provider is enabled in the console, the project is on Blaze, SMS region policy = India,
test number `+91 99999 00001` / `123456` (no real SMS).
- Accounts are created by admins with an email, so a phone only works once it's **linked** to
  that same Auth account. "Set up mobile login" on the Mobile tab: email + password + number →
  OTP → `linkWithCredential` (or `updatePhoneNumber` if a number was already linked). No admin
  side — linking another user's phone needs the Admin SDK / Cloud Functions, which this project
  doesn't have.
- Signing in with an unlinked number makes Firebase create an empty account;
  `getAdditionalUserInfo().isNewUser` catches it, the account is deleted at once and the user is
  told the number isn't registered.
- `hold` state stops `/login` from redirecting while a multi-step flow is mid-way (the user is
  signed in during setup). Each send gets a fresh invisible `RecaptchaVerifier` in a new child
  element (a used verifier can't be reused).
- The linked Auth phone is separate from `AppUser.phone` (the admin-entered contact number);
  nothing syncs them.
