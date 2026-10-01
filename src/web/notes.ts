import type { SteeringAnchor, SteeringViewNode } from "../steering/index.js"

/** Locally-saved note text, keyed by the anchor line it was saved at. */
export type NoteOverrides = Readonly<Record<number, string>>

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
  if (anchor.kind !== "paragraph") return undefined
  const saved = overrides[anchor.line]
  if (saved !== undefined) return saved
  return nodes
    .flatMap((node) => [node, ...(node.body ?? [])])
    .find((node) => node.anchor.kind === "paragraph" && node.anchor.line === anchor.line)?.note
}
