/**
 * One committed (or about-to-be-committed) tree, read synchronously: flow code
 * calls helpers between two awaits and cannot wait on IO. A git-backed view
 * reads objects on demand; `id` is optional and lets `diffTrees` compare blob
 * ids instead of contents.
 */
export interface TreeView {
  readonly paths: () => readonly string[]
  readonly read: (path: string) => string | undefined
  readonly id?: (path: string) => string | undefined
}

export const treeFromRecord = (files: Readonly<Record<string, string>>): TreeView => ({
  paths: () => Object.keys(files).sort(),
  read: (path) => (Object.hasOwn(files, path) ? files[path] : undefined),
})

export interface TreeDiff {
  readonly added: readonly string[]
  readonly modified: readonly string[]
  readonly deleted: readonly string[]
}

const fingerprint = (tree: TreeView, path: string): string | undefined =>
  tree.id !== undefined ? tree.id(path) : tree.read(path)

export const diffTrees = (before: TreeView, after: TreeView): TreeDiff => {
  const beforePaths = new Set(before.paths())
  const afterPaths = new Set(after.paths())
  const added: string[] = []
  const modified: string[] = []
  const deleted: string[] = []
  for (const path of afterPaths) {
    if (!beforePaths.has(path)) added.push(path)
    else if (fingerprint(before, path) !== fingerprint(after, path)) modified.push(path)
  }
  for (const path of beforePaths) if (!afterPaths.has(path)) deleted.push(path)
  return { added: added.sort(), modified: modified.sort(), deleted: deleted.sort() }
}

export const isEmptyDiff = (diff: TreeDiff): boolean =>
  diff.added.length === 0 && diff.modified.length === 0 && diff.deleted.length === 0
