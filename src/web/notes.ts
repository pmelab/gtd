import type { SteeringAnchor, SteeringViewNode } from "../steering/index.js"

/** Locally-saved note text, keyed by the anchor line it was saved at. */
export type NoteOverrides = Readonly<Record<number, string>>

const sameAnchor = (a: SteeringAnchor, b: SteeringAnchor): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

/** Every node, its `body` blocks and its `children`, depth-first. */
const flatten = (nodes: readonly SteeringViewNode[]): readonly SteeringViewNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.body ?? []), ...flatten(node.children ?? [])])

const nodeAt = (
  nodes: readonly SteeringViewNode[],
  anchor: SteeringAnchor,
): SteeringViewNode | undefined => flatten(nodes).find((n) => sameAnchor(n.anchor, anchor))

/**
 * The note text a sheet should open with. A `paragraph` anchor can name
 * either a top-level prose block OR a block riding in one of `body` (a
 * question's own body), so the lookup walks both — searching `nodes` alone
 * reopens a body block's note with an empty field, silently offering to
 * replace text the reader can still see behind the sheet.
 */
export const existingNoteFor = (
  nodes: readonly SteeringViewNode[],
  anchor: SteeringAnchor,
  overrides: NoteOverrides,
): string | undefined => {
  const node = nodeAt(nodes, anchor)
  if (anchor.kind === "paragraph") {
    const saved = overrides[anchor.line]
    if (saved !== undefined) return saved
  }
  return anchor.kind === "paragraph" ? node?.note : undefined
}
