import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore'
import { db } from '../firebase'
import type {
  LogTemplate,
  MbbsYear,
  TreeNode,
  SdlCategory,
  InstitutionTemplateOverride,
  InstitutionCompetencyOverride,
  InstitutionCompetencyFormOverride,
} from '../../types'

const templatesRef = collection(db, 'logTemplates')

// Firestore denies a list query outright unless it filters on every field
// the security rule reads (here: scope + institutionId) — it can't prove
// the query is safe otherwise, even though get-by-id works fine regardless.
// So global and institution templates are always queried separately rather
// than as one combined query with optional filters.

export function watchGlobalTemplates(
  filters: { department?: string; mbbsYear?: MbbsYear },
  onChange: (templates: LogTemplate[]) => void,
): Unsubscribe {
  const clauses = [where('scope', '==', 'global'), where('institutionId', '==', '')]
  if (filters.department) clauses.push(where('department', '==', filters.department))
  if (filters.mbbsYear) clauses.push(where('mbbsYear', '==', filters.mbbsYear))
  return onSnapshot(query(templatesRef, ...clauses), (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LogTemplate))
  })
}

export function watchInstitutionTemplates(
  institutionId: string,
  filters: { department?: string; mbbsYear?: MbbsYear },
  onChange: (templates: LogTemplate[]) => void,
): Unsubscribe {
  const clauses = [where('scope', '==', 'institution'), where('institutionId', '==', institutionId)]
  if (filters.department) clauses.push(where('department', '==', filters.department))
  if (filters.mbbsYear) clauses.push(where('mbbsYear', '==', filters.mbbsYear))
  return onSnapshot(query(templatesRef, ...clauses), (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as LogTemplate))
  })
}

export function watchTemplate(
  templateId: string,
  onChange: (template: LogTemplate | null) => void,
): Unsubscribe {
  return onSnapshot(doc(templatesRef, templateId), (snap) => {
    onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as LogTemplate) : null)
  })
}

export async function createTemplate(
  input: Omit<LogTemplate, 'id' | 'createdAt'>,
): Promise<string> {
  const docRef = await addDoc(templatesRef, { ...input, createdAt: Date.now() })
  return docRef.id
}

// Finds the existing global SSL template for a department/year, or creates
// one — used anywhere a competency needs "the log template for department
// X" without caring whether that template already exists yet (moving a
// competency to a new department, creating a brand new one, etc.).
export async function getOrCreateGlobalSslTemplate(
  department: string,
  mbbsYear: MbbsYear,
  createdBy: string,
): Promise<string> {
  const q = query(
    templatesRef,
    where('scope', '==', 'global'),
    where('institutionId', '==', ''),
    where('logType', '==', 'SSL'),
    where('department', '==', department),
    where('mbbsYear', '==', mbbsYear),
  )
  const snap = await getDocs(q)
  if (!snap.empty) return snap.docs[0].id
  return createTemplate({
    logType: 'SSL',
    scope: 'global',
    institutionId: '',
    department,
    mbbsYear,
    title: `${department} — Competency Checklists`,
    createdBy,
  })
}

export async function updateTemplate(
  templateId: string,
  patch: Partial<Pick<LogTemplate, 'title' | 'department' | 'mbbsYear' | 'logType'>>,
): Promise<void> {
  await updateDoc(doc(templatesRef, templateId), patch)
}

export async function deleteTemplate(templateId: string): Promise<void> {
  await deleteDoc(doc(templatesRef, templateId))
}

// One-shot subcollection size, used by the template library list — cheaper
// than subscribing to every template's nodes/categories just to show a count.
export async function countTemplateFields(template: LogTemplate): Promise<number> {
  const ref = template.logType === 'SSL' ? nodesRef(template.id) : categoriesRef(template.id)
  const snap = await getCountFromServer(query(ref))
  return snap.data().count
}

// Clones an entire template — its own doc plus its full node tree (SSL) or
// category list (SDL) — as a new template. Evaluation forms attached to SSL
// leaves are not copied, same reasoning as duplicateTreeSubtree: sharing one
// formSchemaId between two templates would let editing one silently edit
// the other.
export async function duplicateTemplate(source: LogTemplate): Promise<string> {
  const newId = await createTemplate({
    logType: source.logType,
    scope: source.scope,
    institutionId: source.institutionId,
    department: source.department,
    mbbsYear: source.mbbsYear,
    title: `${source.title} (copy)`,
    createdBy: source.createdBy,
  })

  if (source.logType === 'SSL') {
    const snap = await getDocs(nodesRef(source.id))
    const nodes = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TreeNode)
    async function cloneChildren(srcParentId: string | null, destParentId: string | null) {
      const children = nodes
        .filter((n) => n.parentId === srcParentId)
        .sort((a, b) => a.order - b.order)
      for (let i = 0; i < children.length; i++) {
        const child = children[i]
        const childId = await createTreeNode(newId, {
          parentId: destParentId,
          title: child.title,
          order: i,
          type: child.type,
          required: child.required,
          formSchemaId: null,
        })
        await cloneChildren(child.id, childId)
      }
    }
    await cloneChildren(null, null)
  } else {
    const snap = await getDocs(categoriesRef(source.id))
    const cats = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SdlCategory)
    await Promise.all(cats.map((c, i) => createSdlCategory(newId, { title: c.title, order: i })))
  }

  return newId
}

// --- SSL tree nodes ---

function nodesRef(templateId: string) {
  return collection(db, 'logTemplates', templateId, 'nodes')
}

export function watchTreeNodes(
  templateId: string,
  onChange: (nodes: TreeNode[]) => void,
): Unsubscribe {
  const q = query(nodesRef(templateId), orderBy('order'))
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as TreeNode))
  })
}

export function watchTreeNode(
  templateId: string,
  nodeId: string,
  onChange: (node: TreeNode | null) => void,
): Unsubscribe {
  return onSnapshot(doc(nodesRef(templateId), nodeId), (snap) => {
    onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as TreeNode) : null)
  })
}

export async function createTreeNode(
  templateId: string,
  input: Omit<TreeNode, 'id' | 'templateId'>,
): Promise<string> {
  const docRef = await addDoc(nodesRef(templateId), { ...input, templateId })
  return docRef.id
}

export async function updateTreeNode(
  templateId: string,
  nodeId: string,
  patch: Partial<Omit<TreeNode, 'id' | 'templateId'>>,
): Promise<void> {
  await updateDoc(doc(nodesRef(templateId), nodeId), patch)
}

export async function deleteTreeNode(templateId: string, nodeId: string): Promise<void> {
  await deleteDoc(doc(nodesRef(templateId), nodeId))
}

// Inserts a new blank sibling directly above/below a reference node, shifting
// later siblings' `order` down by one to make room. `allNodes` only needs to
// contain the reference node's siblings (a full-tree list works fine too).
export async function insertTreeNode(
  templateId: string,
  allNodes: TreeNode[],
  referenceNodeId: string,
  position: 'above' | 'below',
): Promise<string> {
  const reference = allNodes.find((n) => n.id === referenceNodeId)
  if (!reference) throw new Error('Reference node not found')
  const siblings = allNodes
    .filter((n) => n.parentId === reference.parentId)
    .sort((a, b) => a.order - b.order)
  const refIndex = siblings.findIndex((n) => n.id === referenceNodeId)
  const insertIndex = position === 'above' ? refIndex : refIndex + 1

  await Promise.all(
    siblings
      .filter((_, i) => i >= insertIndex)
      .map((n, i) => updateTreeNode(templateId, n.id, { order: insertIndex + i + 1 })),
  )
  return createTreeNode(templateId, {
    parentId: reference.parentId,
    title: '',
    order: insertIndex,
    type: 'Short text',
    required: false,
    formSchemaId: null,
  })
}

// Duplicates a node and its full descendant subtree, placed directly below
// the original. Attached evaluation forms are not copied — a duplicate
// starts unattached, since sharing one formSchemaId between two nodes would
// let editing one silently change the other.
export async function duplicateTreeSubtree(
  templateId: string,
  allNodes: TreeNode[],
  nodeId: string,
): Promise<void> {
  const node = allNodes.find((n) => n.id === nodeId)
  if (!node) return
  const newId = await insertTreeNode(templateId, allNodes, nodeId, 'below')
  await updateTreeNode(templateId, newId, { title: node.title, type: node.type, required: node.required })

  async function cloneChildren(srcParentId: string, destParentId: string) {
    const children = allNodes
      .filter((n) => n.parentId === srcParentId)
      .sort((a, b) => a.order - b.order)
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      const childId = await createTreeNode(templateId, {
        parentId: destParentId,
        title: child.title,
        order: i,
        type: child.type,
        required: child.required,
        formSchemaId: null,
      })
      await cloneChildren(child.id, childId)
    }
  }
  await cloneChildren(nodeId, newId)
}

// --- SDL categories ---

function categoriesRef(templateId: string) {
  return collection(db, 'logTemplates', templateId, 'categories')
}

export function watchSdlCategories(
  templateId: string,
  onChange: (categories: SdlCategory[]) => void,
): Unsubscribe {
  const q = query(categoriesRef(templateId), orderBy('order'))
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as SdlCategory))
  })
}

export async function createSdlCategory(
  templateId: string,
  input: Omit<SdlCategory, 'id' | 'templateId'>,
): Promise<string> {
  const docRef = await addDoc(categoriesRef(templateId), { ...input, templateId })
  return docRef.id
}

export async function deleteSdlCategory(templateId: string, categoryId: string): Promise<void> {
  await deleteDoc(doc(categoriesRef(templateId), categoryId))
}

// --- Institution enable/disable toggle for global templates ---

const overridesRef = collection(db, 'institutionTemplateOverrides')

function overrideId(institutionId: string, templateId: string) {
  return `${institutionId}_${templateId}`
}

export function watchInstitutionOverrides(
  institutionId: string,
  onChange: (overrides: InstitutionTemplateOverride[]) => void,
): Unsubscribe {
  const q = query(overridesRef, where('institutionId', '==', institutionId))
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as InstitutionTemplateOverride))
  })
}

export async function setTemplateEnabledForInstitution(
  institutionId: string,
  templateId: string,
  enabled: boolean,
): Promise<void> {
  await setDoc(doc(overridesRef, overrideId(institutionId, templateId)), {
    institutionId,
    templateId,
    enabled,
  })
}

// --- Institution enable/disable toggle for individual SSL competencies ---
// One level more granular than the whole-template toggle above: lets an
// institution hide a single procedure within an otherwise-enabled global
// SSL template, independent of the template-level and department-level
// toggles.

const competencyOverridesRef = collection(db, 'institutionCompetencyOverrides')

function competencyOverrideId(institutionId: string, nodeId: string) {
  return `${institutionId}_${nodeId}`
}

export function watchInstitutionCompetencyOverrides(
  institutionId: string,
  onChange: (overrides: InstitutionCompetencyOverride[]) => void,
): Unsubscribe {
  const q = query(competencyOverridesRef, where('institutionId', '==', institutionId))
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as InstitutionCompetencyOverride))
  })
}

export async function setCompetencyEnabledForInstitution(
  institutionId: string,
  nodeId: string,
  enabled: boolean,
): Promise<void> {
  await setDoc(doc(competencyOverridesRef, competencyOverrideId(institutionId, nodeId)), {
    institutionId,
    nodeId,
    enabled,
  })
}

// --- Institution-specific fork of a global competency's evaluation form --
// Separate from the enable/disable toggle above: this doesn't hide or show
// anything, it points at a private FormSchema copy so one institution can
// have its own edited checklist for a competency without touching the
// global form every other institution (and the global Competencies page)
// still uses.

const competencyFormOverridesRef = collection(db, 'institutionCompetencyFormOverrides')

function competencyFormOverrideId(institutionId: string, nodeId: string) {
  return `${institutionId}_${nodeId}`
}

export function watchInstitutionCompetencyFormOverrides(
  institutionId: string,
  onChange: (overrides: InstitutionCompetencyFormOverride[]) => void,
): Unsubscribe {
  const q = query(competencyFormOverridesRef, where('institutionId', '==', institutionId))
  return onSnapshot(q, (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as InstitutionCompetencyFormOverride))
  })
}

export function watchInstitutionCompetencyFormOverride(
  institutionId: string,
  nodeId: string,
  onChange: (override: InstitutionCompetencyFormOverride | null) => void,
): Unsubscribe {
  return onSnapshot(doc(competencyFormOverridesRef, competencyFormOverrideId(institutionId, nodeId)), (snap) => {
    onChange(snap.exists() ? ({ id: snap.id, ...snap.data() } as InstitutionCompetencyFormOverride) : null)
  })
}

export async function setInstitutionCompetencyFormOverride(
  institutionId: string,
  nodeId: string,
  formSchemaId: string,
): Promise<void> {
  await setDoc(doc(competencyFormOverridesRef, competencyFormOverrideId(institutionId, nodeId)), {
    institutionId,
    nodeId,
    formSchemaId,
  })
}

export async function deleteInstitutionCompetencyFormOverride(institutionId: string, nodeId: string): Promise<void> {
  await deleteDoc(doc(competencyFormOverridesRef, competencyFormOverrideId(institutionId, nodeId)))
}
