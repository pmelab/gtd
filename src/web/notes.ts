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

/**
 * The note-save handler every screen wires into its sheet: shows the text
 * immediately, closes the sheet, then REVERTS that optimistic override if
 * the write is refused — a note that stays on screen after the file rejected
 * it is the one outcome worse than a visible refusal, since the reader
 * believes it landed.
 */
export const optimisticNoteSave =
  ({
    setOverrides,
    close,
    write,
    onRefusal,
  }: {
    readonly setOverrides: (update: (prev: NoteOverrides) => NoteOverrides) => void
    readonly close: () => void
    readonly write?: (anchor: SteeringAnchor, text: string) => Promise<unknown>
    readonly onRefusal?: (error: unknown, retry?: () => Promise<unknown>) => void
  }) =>
  (anchor: SteeringAnchor, text: string): void => {
    if (anchor.kind === "paragraph") {
      setOverrides((prev) => ({ ...prev, [anchor.line]: text }))
    }
    close()
    if (write === undefined) return
    write(anchor, text).catch((error: unknown) => {
      onRefusal?.(error, () => write(anchor, text))
      if (anchor.kind !== "paragraph") return
      setOverrides((prev) => {
        const next = { ...prev }
        delete next[anchor.line]
        return next
      })
    })
  }
