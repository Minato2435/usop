// Same interface configuration as the admin panels and Student — reuse
// their exact primitives rather than a parallel Faculty-only kit, per the
// explicit direction (already applied to Student) that every role should
// look and feel like the same product. Faculty's own `Card`/`PrimaryButton`/
// `GhostButton`/`StatCard` local kit (flatter, denser, teal-accented
// "Review Bench" identity) is retired in favor of this.
export { Card, StatTile, PrimaryButton, GhostButton, Badge, Skeleton, Modal, Field, inputClass } from '../../primary-admin/shell/ui'
// StatusPill/statusRailColor used to be defined locally here, duplicating
// Student's own copy (and, since, HOD's) — consolidated into one shared
// definition once three roles needed the exact same mapping.
export { StatusPill, statusRailColor } from '../../../components/StatusPill'
