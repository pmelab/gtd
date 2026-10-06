import type { SteeringAnchor, SteeringViewNode, SteeringViewThread } from "../steering/index.js"

/** Locally-saved note text, keyed by the anchor line it was saved at. */
export type NoteOverrides = Readonly<Record<number, string>>

/** The thread with the human's saved reply applied the way the server applies it: appended to an open thread, replacing the last `H` entry of one waiting on the agent. Idempotent against a refetch that already carries the reply. */
export const withReply = (thread: SteeringViewThread, text: string): SteeringViewThread => {
  const entries =
    thread.waitingOn === "human"
      ? [...thread.entries, { author: "me" as const, text }]
      : [...thread.entries.slice(0, -1), { author: "me" as const, text }]
  return { ...thread, entries, waitingOn: "agent" }
}

const sameAnchor = (a: SteeringAnchor, b: SteeringAnchor): boolean =>
  JSON.stringify(a) === JSON.stringify(b)

/** Every node, its `body` blocks and its `children`, depth-first. */
const flatten = (nodes: readonly SteeringViewNode[]): readonly SteeringViewNode[] =>
  nodes.flatMap((node) => [node, ...flatten(node.body ?? []), ...flatten(node.children ?? [])])

export const nodeAt = (
  nodes: readonly SteeringViewNode[],
  anchor: SteeringAnchor,
): SteeringViewNode | undefined => flatten(nodes).find((n) => sameAnchor(n.anchor, anchor))

/**
 * The note text a sheet should open with. A `paragraph` anchor can name
 * either a top-level prose block OR a block riding in one of `body` (a
 * question's own body), so the lookup walks both — searching `nodes` alone
 * reopens a body block's note with an empty field, silently offering to
 * replace text the reader can still see behind the sheet.
 *
 * A thread opens EMPTY for a reply when the agent spoke last, and prefilled
 * with the last `H` entry when it waits on the agent (saving replaces it).
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
  if (node?.thread) {
    if (node.thread.waitingOn === "human") return ""
    return node.thread.entries.findLast((e) => e.author === "me")?.text ?? ""
  }
  return anchor.kind === "paragraph" ? node?.note : undefined
}
